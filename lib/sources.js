'use strict'

/**
 * Reading the two things the page needs to know about a local source: what is
 * in a directory, and what plugin (if any) a directory or zip actually holds.
 *
 * "Is a plugin" is decided by the package manifest alone: a name plus a
 * `dsh.bundle.patch` declaration. That is what the profile loader needs in
 * order to mount a row, so it is also the honest bar for offering an install.
 */

const fs = require('node:fs')
const path = require('node:path')
const zip = require('./zip.js')

const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_ZIP_INSPECT_BYTES = 64 * 1024 * 1024

/** Read `package.json` in `dir` without throwing. Returns {manifest, error}. */
function readManifest(dir) {
  const file = path.join(dir, 'package.json')
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    return { manifest: null, error: null }
  }
  if (!stat.isFile()) return { manifest: null, error: null }
  if (stat.size > MAX_MANIFEST_BYTES) return { manifest: null, error: 'package.json 过大' }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return { manifest: null, error: 'package.json 不是对象' }
    return { manifest: parsed, error: null }
  } catch (error) {
    return { manifest: null, error: `package.json 解析失败：${error.message}` }
  }
}

function hasBundlePatch(manifest) {
  const dsh = manifest && typeof manifest.dsh === 'object' && manifest.dsh !== null ? manifest.dsh : null
  const bundle = dsh && typeof dsh.bundle === 'object' && dsh.bundle !== null ? dsh.bundle : null
  const patch = bundle === null ? null : bundle.patch
  if (typeof patch === 'string' && patch.trim() !== '') return true
  return Array.isArray(patch) && patch.length > 0 && patch.every((item) => typeof item === 'string')
}

/**
 * Summarize a package manifest for the page.
 * @returns {{ name: string, version: string, description: string, hasBundle: boolean, hasClient: boolean, installable: boolean, problem: string }}
 */
function describeManifest(manifest) {
  const name = manifest && typeof manifest.name === 'string' ? manifest.name : ''
  const version = manifest && typeof manifest.version === 'string' ? manifest.version : ''
  const description = manifest && typeof manifest.description === 'string' ? manifest.description : ''
  const dsh = manifest && typeof manifest.dsh === 'object' && manifest.dsh !== null ? manifest.dsh : null
  const hasClient = Boolean(dsh && typeof dsh.client === 'object' && dsh.client !== null)
  const hasBundle = hasBundlePatch(manifest)
  let problem = ''
  if (name === '') problem = 'package.json 缺少 name 字段'
  else if (!hasBundle) problem = '这个包没有 dsh.bundle.patch 声明，不是可安装的 DSH 插件包'
  return { name, version, description, hasBundle, hasClient, installable: name !== '' && hasBundle, problem }
}

function statOf(target) {
  try {
    return fs.statSync(target)
  } catch {
    return null
  }
}

function isZipFile(target, stat) {
  return stat !== null && stat.isFile() && /\.zip$/i.test(target)
}

/**
 * List a directory for the browser: sub-folders, zip files, and whether each
 * folder or zip looks like an installable plugin.
 */
function listDirectory(target) {
  const stat = statOf(target)
  if (stat === null) throw new Error(`路径不存在：${target}`)
  if (!stat.isDirectory()) throw new Error(`不是文件夹：${target}`)

  const dirents = fs.readdirSync(target, { withFileTypes: true })
  const entries = []
  for (const dirent of dirents) {
    if (dirent.name.startsWith('.') || dirent.name === 'node_modules') continue
    const full = path.join(target, dirent.name)
    if (dirent.isDirectory()) {
      const { manifest, error } = readManifest(full)
      entries.push({
        name: dirent.name,
        path: full,
        kind: 'dir',
        plugin: manifest === null ? null : describeManifest(manifest),
        error,
      })
      continue
    }
    if (!dirent.isFile()) continue
    if (!/\.zip$/i.test(dirent.name)) continue
    const child = statOf(full)
    let plugin = null
    let zipError = null
    if (child !== null && child.size <= 8 * 1024 * 1024) {
      try {
        plugin = inspectZip(full).plugin
      } catch (error) {
        zipError = error.message
      }
    }
    entries.push({
      name: dirent.name,
      path: full,
      kind: 'zip',
      size: child === null ? 0 : child.size,
      plugin,
      error: zipError,
    })
  }
  entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1
    return left.name.localeCompare(right.name, 'zh-CN', { numeric: true })
  })
  const parent = path.dirname(target)
  const self = readManifest(target)
  return {
    path: target,
    parent: parent === target ? null : parent,
    plugin: self.manifest === null ? null : describeManifest(self.manifest),
    entries,
  }
}

/** Pick the manifest path inside a zip, tolerating one wrapper folder. */
function findManifestEntry(entries) {
  const files = entries.filter((entry) => !entry.directory)
  const byName = new Map(files.map((entry) => [entry.name.replace(/\\/g, '/'), entry]))
  const direct = byName.get('package.json')
  if (direct !== undefined) return { entry: direct, prefix: '' }

  const tops = new Set()
  for (const entry of files) {
    const normalized = entry.name.replace(/\\/g, '/')
    const slash = normalized.indexOf('/')
    if (slash <= 0) continue
    tops.add(normalized.slice(0, slash))
  }
  if (tops.size !== 1) return { entry: null, prefix: '' }
  const prefix = `${[...tops][0]}/`
  const nested = byName.get(`${prefix}package.json`)
  return { entry: nested === undefined ? null : nested, prefix: prefix }
}

/** Inspect a zip without extracting it. */
function inspectZip(target) {
  const stat = statOf(target)
  if (stat === null) throw new Error(`文件不存在：${target}`)
  if (stat.size > MAX_ZIP_INSPECT_BYTES) throw new Error('zip 文件过大，无法直接读取，请改用解压后的文件夹')
  const buffer = fs.readFileSync(target)
  const entries = zip.readEntries(buffer)
  const { entry, prefix } = findManifestEntry(entries)
  if (entry === null) {
    return { kind: 'zip', path: target, prefix: '', plugin: null, problem: 'zip 里没有找到 package.json', files: entries.length }
  }
  let manifest = null
  let error = null
  try {
    manifest = JSON.parse(zip.readTextEntry(buffer, entry))
  } catch (parseError) {
    error = `zip 内 package.json 解析失败：${parseError.message}`
  }
  if (manifest === null || typeof manifest !== 'object') manifest = null
  return {
    kind: 'zip',
    path: target,
    prefix,
    plugin: manifest === null ? null : describeManifest(manifest),
    problem: error === null ? (manifest === null ? 'zip 内 package.json 无法解析' : '') : error,
    files: entries.length,
  }
}

/** Inspect a folder or zip: what it is, and the plugin it declares. */
function inspectSource(target) {
  const stat = statOf(target)
  if (stat === null) throw new Error(`路径不存在：${target}`)
  if (stat.isDirectory()) {
    const { manifest, error } = readManifest(target)
    return {
      kind: 'dir',
      path: target,
      plugin: manifest === null ? null : describeManifest(manifest),
      problem: error === null ? (manifest === null ? '这个文件夹里没有 package.json' : '') : error,
    }
  }
  if (isZipFile(target, stat)) return inspectZip(target)
  throw new Error('请选择文件夹或 .zip 文件')
}

module.exports = { listDirectory, inspectSource, inspectZip, readManifest, describeManifest }
