'use strict'

/**
 * The install pipeline behind the page.
 *
 * A local source is copied (or unzipped) into `<profile>/local-plugins/<name>@<version>`
 * first, then handed to the profile's own `pluginManager`. Two consequences are
 * deliberate:
 *
 *  - the installed package is a `link:` dependency, so the profile keeps working
 *    after the user's original folder (a download, a temp dir) disappears;
 *  - nothing here talks to a registry. `pnpm add <dir>` resolves a local path
 *    offline; only a plugin that still needs its own dependencies would ever
 *    reach the network, and that is pnpm's business, not this page's.
 */

const fs = require('node:fs')
const path = require('node:path')

const zip = require('./zip.js')
const { inspectSource } = require('./sources.js')

const MAX_COPY_BYTES = 200 * 1024 * 1024
const MAX_COPY_FILES = 20000
const MAX_WALK_DEPTH = 24
const MAX_LOG_LINES = 600
const SKIP_NAMES = new Set(['.git', '.hg', '.svn', '.DS_Store', '.idea', '.vscode'])
const SKIP_SUFFIXES = ['.log']

const STEP_LABELS = {
  resolving: '读取来源',
  staging: '复制/解压到本地插件目录',
  inspecting: '校验包信息',
  installing: '安装中',
  done: '完成',
  error: '失败',
  cancelled: '已取消',
}

function sanitizeSegment(value) {
  const cleaned = String(value).replace(/[^a-zA-Z0-9._@-]+/g, '-').replace(/^[-.@]+/, '')
  return cleaned === '' ? 'plugin' : cleaned.slice(0, 96)
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '?'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}

function isInside(child, parent) {
  const target = path.resolve(parent)
  const resolved = path.resolve(child)
  return resolved === target || resolved.startsWith(target + path.sep)
}

function shouldSkip(name) {
  if (SKIP_NAMES.has(name)) return true
  return SKIP_SUFFIXES.some((suffix) => name.endsWith(suffix))
}

/**
 * Measure a tree before copying it, so an accidental huge folder (a repo with
 * its own node_modules) is refused instead of copied.
 */
function measureTree(root) {
  const visited = new Set()
  let files = 0
  let bytes = 0
  const walk = (dir, depth) => {
    if (depth > MAX_WALK_DEPTH) throw new Error('文件夹层级过深，可能包含符号链接环')
    let real
    try {
      real = fs.realpathSync(dir)
    } catch {
      return
    }
    if (visited.has(real)) return
    visited.add(real)
    const dirents = fs.readdirSync(dir, { withFileTypes: true })
    for (const dirent of dirents) {
      if (shouldSkip(dirent.name)) continue
      const full = path.join(dir, dirent.name)
      let stat
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (!stat.isFile()) continue
      files += 1
      bytes += stat.size
      if (files > MAX_COPY_FILES) throw new Error(`文件夹内文件过多（超过 ${MAX_COPY_FILES} 个），建议先打包成 zip`)
      if (bytes > MAX_COPY_BYTES) throw new Error(`文件夹过大（超过 ${formatBytes(MAX_COPY_BYTES)}），建议先打包成 zip 再安装`)
    }
  }
  walk(root, 0)
  return { files, bytes }
}

function copyTree(source, destination) {
  const measured = measureTree(source)
  fs.cpSync(source, destination, {
    recursive: true,
    force: true,
    dereference: true,
    filter: (from) => !shouldSkip(path.basename(from)),
  })
  return measured
}

/** Human summary of a ChangeResult, plus the diagnostics worth showing. */
function summarizeChange(change) {
  const summary = {
    changed: change.changed === true,
    application: change.application,
    stage: change.stage,
    target: change.target,
    enabled: change.enabled,
    warnings: Array.isArray(change.warnings) ? change.warnings : [],
    error: change.error
      ? {
          code: change.error.code,
          diagnostic: change.error.diagnostic,
          incompatible: Array.isArray(change.error.incompatible) ? change.error.incompatible : [],
        }
      : null,
    output: change.packageResult && typeof change.packageResult.output === 'string' ? change.packageResult.output : '',
    exitCode: change.packageResult ? change.packageResult.exitCode : null,
    timedOut: change.packageResult ? change.packageResult.timedOut === true : false,
    pendingBuilds: Array.isArray(change.pendingBuilds) ? change.pendingBuilds : [],
  }
  if (change.bundle && typeof change.bundle === 'object') {
    summary.bundle = {
      name: change.bundle.name,
      version: change.bundle.version,
      enabled: change.bundle.enabled,
      rows: Array.isArray(change.bundle.rows) ? change.bundle.rows.map((row) => ({ id: row.id, name: row.name })) : [],
    }
  }
  return summary
}

function createInstaller(options) {
  const { ctx, profileDir, sourcesDir, pluginManagerOf } = options
  const jobs = new Map()
  let sequence = 0

  function addLog(job, stream, text) {
    const value = String(text ?? '')
    const lines = value.split(/\r?\n/)
    for (const line of lines) {
      if (line === '' && lines.length > 1) continue
      job.log.push({ stream, text: line.slice(0, 4000) })
    }
    if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES)
  }

  function setStep(job, step, message) {
    job.step = step
    job.message = message ?? STEP_LABELS[step] ?? step
    job.updatedAt = Date.now()
    if (step !== 'done' && step !== 'error' && step !== 'cancelled') {
      addLog(job, 'step', job.message)
    }
  }

  function pluginManager() {
    const manager = pluginManagerOf()
    if (manager === null || manager === undefined) {
      throw new Error('当前环境没有插件管理服务（pluginManager），无法安装')
    }
    return manager
  }

  /** Feed a streamed pnpm chunk into whichever job it belongs to. */
  function onInstallLog(chunk) {
    if (chunk === null || typeof chunk !== 'object') return
    const job = typeof chunk.requestId === 'string' ? jobs.get(chunk.requestId) : undefined
    if (job === undefined) return
    if (typeof chunk.text === 'string' && chunk.text !== '') addLog(job, chunk.stream === 'stderr' ? 'stderr' : 'stdout', chunk.text)
  }

  function onInstallState(progress) {
    if (progress === null || typeof progress !== 'object') return
    const job = typeof progress.requestId === 'string' ? jobs.get(progress.requestId) : undefined
    if (job === undefined) return
    const phase = progress.phase
    if (phase === 'installing') setStep(job, 'installing', 'pnpm 正在安装…')
    else if (phase === 'applying') setStep(job, 'installing', '写入 profile 并启用…')
    else if (phase === 'cancelling') setStep(job, 'installing', '正在取消…')
  }

  async function run(job, sourcePath) {
    try {
      setStep(job, 'resolving', '读取来源信息…')
      const source = inspectSource(sourcePath)
      if (source.plugin === null) throw new Error(source.problem || '这里没有 DSH 插件')
      if (!source.plugin.installable) throw new Error(source.plugin.problem || '不是可安装的 DSH 插件包')
      job.plugin = source.plugin

      const dirName = `${sanitizeSegment(source.plugin.name)}@${sanitizeSegment(source.plugin.version || '0.0.0')}`
      const target = path.join(sourcesDir, dirName)
      const alreadyInStore = source.kind === 'dir' && isInside(sourcePath, sourcesDir) && path.resolve(sourcePath) === path.resolve(target)

      if (alreadyInStore) {
        job.stagedPath = sourcePath
        addLog(job, 'step', `来源已在本地插件目录中，直接安装：${sourcePath}`)
      } else {
        setStep(job, 'staging', source.kind === 'zip' ? '解压到本地插件目录…' : '复制到本地插件目录…')
        fs.mkdirSync(sourcesDir, { recursive: true })
        const staging = path.join(sourcesDir, `.staging-${job.id}`)
        fs.rmSync(staging, { recursive: true, force: true })
        fs.mkdirSync(staging, { recursive: true })
        let root = staging
        if (source.kind === 'zip') {
          const buffer = fs.readFileSync(sourcePath)
          const entries = zip.readEntries(buffer)
          const result = zip.extractInto(buffer, entries, staging)
          if (source.prefix) root = path.join(staging, source.prefix.replace(/[\\/]$/, ''))
          addLog(job, 'step', `解压 ${result.files} 个文件（${formatBytes(result.bytes)}）`)
        } else {
          const result = copyTree(sourcePath, staging)
          addLog(job, 'step', `复制 ${result.files} 个文件（${formatBytes(result.bytes)}）`)
        }
        const staged = path.join(root, 'package.json')
        if (!fs.existsSync(staged)) {
          fs.rmSync(staging, { recursive: true, force: true })
          throw new Error('解压/复制后没有找到 package.json，压缩包结构可能不对')
        }
        fs.rmSync(target, { recursive: true, force: true })
        fs.renameSync(root, target)
        if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true })
        job.stagedPath = target
        addLog(job, 'step', `安装源：${target}`)
      }

      setStep(job, 'inspecting', '校验包信息…')
      const manager = pluginManager()
      job.requestId = job.requestId
      const inspection = await manager.inspect(job.stagedPath)
      if (inspection.status === 'refused') {
        if (inspection.problem === 'already-installed') {
          addLog(job, 'step', '这个包已在 profile 中，将重新链接并启用')
        } else {
          throw new Error(`校验未通过：${inspection.reason || inspection.problem}`)
        }
      } else {
        job.inspection = {
          kind: inspection.kind,
          name: inspection.name ?? source.plugin.name,
          version: inspection.version ?? source.plugin.version,
          bundle: inspection.bundle,
        }
        addLog(job, 'step', `校验通过：${job.inspection.name}${job.inspection.version ? '@' + job.inspection.version : ''}`)
      }

      setStep(job, 'installing', '安装中（pnpm 写入 profile）…')
      const change = await manager.installBundle(job.stagedPath, { enabled: true, requestId: job.requestId })
      job.change = summarizeChange(change)
      if (change.application === 'failed') {
        const diagnostic = change.error && change.error.diagnostic ? change.error.diagnostic : ''
        throw new Error(diagnostic || (change.error && change.error.code) || '安装失败')
      }
      if (change.application === 'cancelled') {
        job.state = 'cancelled'
        setStep(job, 'cancelled', '安装已取消')
        return
      }
      job.state = 'done'
      setStep(job, 'done', change.application === 'restart-required'
        ? '已安装，需要重启 DSH 后生效'
        : '已安装并启用')
    } catch (error) {
      job.state = 'error'
      job.error = error instanceof Error ? error.message : String(error)
      setStep(job, 'error', job.error)
      addLog(job, 'error', job.error)
    }
  }

  function start(sourcePath) {
    const stat = (() => {
      try {
        return fs.statSync(sourcePath)
      } catch {
        return null
      }
    })()
    if (stat === null) throw new Error(`路径不存在：${sourcePath}`)

    sequence += 1
    const id = `job-${Date.now().toString(36)}-${sequence}`
    const job = {
      id,
      requestId: `local-install-${id}`,
      source: sourcePath,
      state: 'running',
      step: 'resolving',
      message: STEP_LABELS.resolving,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      log: [],
      plugin: null,
      stagedPath: null,
      inspection: null,
      change: null,
      error: null,
    }
    jobs.set(job.requestId, job)
    jobs.set(`id:${id}`, job)
    // Bound the map: a page session installs a handful of plugins, not thousands.
    if (jobs.size > 200) {
      for (const [key, value] of jobs) {
        if (jobs.size <= 100) break
        if (value.state !== 'running') jobs.delete(key)
      }
    }
    void run(job, sourcePath)
    return job
  }

  function get(id) {
    return jobs.get(id) ?? jobs.get(`id:${id}`) ?? null
  }

  async function cancel(id) {
    const job = get(id)
    if (job === null) throw new Error('没有这个安装任务')
    if (job.state !== 'running') return { status: 'too-late' }
    const manager = pluginManager()
    const result = await manager.cancelInstall(job.requestId)
    return result
  }

  /** Local (link:) dependencies of the profile, with their bundle state. */
  async function installed() {
    const manifestPath = path.join(profileDir, 'package.json')
    let manifest = null
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch {
      manifest = null
    }
    const dependencies = manifest && manifest.dependencies && typeof manifest.dependencies === 'object'
      ? manifest.dependencies
      : {}
    const local = Object.entries(dependencies)
      .filter(([, spec]) => typeof spec === 'string' && /^(link:|file:)/.test(spec))
      .map(([name, spec]) => ({ name, spec }))

    let bundles = []
    try {
      const manager = pluginManagerOf()
      if (manager !== null && manager !== undefined) bundles = await manager.listBundles()
    } catch {
      bundles = []
    }
    const byName = new Map((Array.isArray(bundles) ? bundles : []).map((bundle) => [bundle.name, bundle]))
    return local.map((entry) => {
      const bundle = byName.get(entry.name)
      return {
        name: entry.name,
        spec: entry.spec,
        version: bundle && bundle.version ? bundle.version : null,
        enabled: bundle ? bundle.enabled === true : null,
        present: bundle !== undefined,
      }
    })
  }

  return { start, get, cancel, installed, onInstallLog, onInstallState }
}

module.exports = { createInstaller, formatBytes, STEP_LABELS }
