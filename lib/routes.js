'use strict'

/**
 * The page's only channel to the host: a handful of JSON routes under
 * /dsh-local-install/api, mounted on the same webserver that serves the GUI.
 *
 * No Typert/remote plumbing is involved — the market's own page talks to the
 * host over plain routes for the same reason: they are observable, they work
 * from a browser, and nothing here needs a generated client.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { isAdmitted, sendJson, readJsonBody } = require('./http.js')
const { listDirectory, inspectSource } = require('./sources.js')
const { createInstaller } = require('./install.js')

const ROUTE_PREFIX = '/dsh-local-install/api'

/**
 * Author card data. Served by /info so the browser half never hard-codes it
 * and the same values live next to the routes that expose them.
 */
const AUTHOR = {
  name: 'LiXiao1949',
  github: 'https://github.com/LiXiao1949',
  repo: 'https://github.com/LiXiao1949/dsh-local-installer',
  qq: '1640444672',
}

const CANDIDATE_ROOTS = [
  path.join(os.homedir(), 'share'),
  path.join(os.homedir(), 'Download'),
  path.join(os.homedir(), 'Downloads'),
  os.homedir(),
  '/sdcard/Download',
  '/storage/emulated/0/Download',
  '/sdcard',
  '/storage/emulated/0',
]

function existingRoots(extra) {
  const seen = new Set()
  const roots = []
  for (const candidate of [...CANDIDATE_ROOTS, ...extra]) {
    if (typeof candidate !== 'string' || candidate === '') continue
    const resolved = path.resolve(candidate)
    if (seen.has(resolved)) continue
    let stat
    try {
      stat = fs.statSync(resolved)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue
    seen.add(resolved)
    roots.push(resolved)
  }
  return roots
}

/** Expand `~`, resolve, and require an absolute path. */
function resolveRequestPath(input) {
  if (typeof input !== 'string' || input.trim() === '') throw new Error('缺少 path 参数')
  let value = input.trim()
  if (value === '~') value = os.homedir()
  else if (value.startsWith('~/')) value = path.join(os.homedir(), value.slice(2))
  if (!path.isAbsolute(value)) throw new Error('请填写绝对路径')
  return path.resolve(value)
}

function createRoutes(host) {
  const profileDir = resolveProfileDir()
  if (profileDir === null) {
    throw new Error('找不到 profile 目录，无法确定插件安装位置')
  }
  const sourcesDir = path.join(profileDir, 'local-plugins')
  const stateDir = path.join(profileDir, '.local-install')
  const stateFile = path.join(stateDir, 'state.json')

  const readState = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
      return parsed !== null && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  const writeState = (next) => {
    try {
      fs.mkdirSync(stateDir, { recursive: true })
      fs.writeFileSync(stateFile, JSON.stringify(next, null, 2) + '\n')
    } catch {
      /* remembering the last folder is a convenience, never a failure */
    }
  }

  const roots = existingRoots([profileDir, sourcesDir])
  const remember = (dir) => {
    const state = readState()
    state.lastDir = dir
    writeState(state)
  }
  const initialDir = () => {
    const state = readState()
    if (typeof state.lastDir === 'string') {
      try {
        if (fs.statSync(state.lastDir).isDirectory()) return state.lastDir
      } catch {
        /* fall through to the first root */
      }
    }
    return roots.length > 0 ? roots[0] : os.homedir()
  }

  const installer = createInstaller({
    ctx: host,
    profileDir,
    sourcesDir,
    pluginManagerOf: () => host.get('pluginManager'),
  })

  const handleInfo = () => ({
    profileDir,
    sourcesDir,
    home: os.homedir(),
    roots,
    initialDir: initialDir(),
    author: AUTHOR,
    plugin: {
      name: '@local/dsh-local-install',
      version: '1.0.0',
      title: '本地安装插件',
    },
  })

  const handleList = (url) => {
    const target = resolveRequestPath(url.searchParams.get('path') ?? initialDir())
    const listing = listDirectory(target)
    remember(listing.path)
    return listing
  }

  const handleInspect = (url) => {
    const target = resolveRequestPath(url.searchParams.get('path'))
    return inspectSource(target)
  }

  const handleInstall = async (request) => {
    const body = await readJsonBody(request)
    const target = resolveRequestPath(body.path)
    const job = installer.start(target)
    return { id: job.id, state: job.state, step: job.step, message: job.message }
  }

  const handleJob = (url) => {
    const id = url.searchParams.get('id')
    if (typeof id !== 'string' || id === '') throw new Error('缺少 id 参数')
    const job = installer.get(id)
    if (job === null) throw new Error('安装任务不存在或已过期')
    return {
      id: job.id,
      source: job.source,
      state: job.state,
      step: job.step,
      message: job.message,
      plugin: job.plugin,
      stagedPath: job.stagedPath,
      inspection: job.inspection,
      change: job.change,
      error: job.error,
      log: job.log.slice(-220),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }
  }

  const handleCancel = async (request) => {
    const body = await readJsonBody(request)
    const id = typeof body.id === 'string' ? body.id : ''
    if (id === '') throw new Error('缺少 id 参数')
    return installer.cancel(id)
  }

  /**
   * The host's own fence: its rebinding/authority check plus its browser login.
   * The market's routes sit on the same webserver and consult it for the same
   * reason — an `exact`/`prefix` registration is reached before the app's /api
   * gate, so a route that does not ask would be a hole in the app's login.
   * @returns true when the request was refused and answered here.
   */
  const refuseByHostGate = (request, response) => {
    const connection = host.get('connection')
    const gate = connection === undefined ? undefined : connection.requestRejection
    if (typeof gate !== 'function') return false
    let status
    try {
      status = gate.call(connection, request)
    } catch {
      status = 403
    }
    if (status === undefined || status === null) return false
    sendJson(response, status, {
      error:
        status === 401
          ? '需要先登录 DSH：请重新打开 dsh web 启动时打印的网址。 / DSH login required.'
          : '这个请求来自不受信任的地址，已拒绝。 / This request came from an untrusted origin and was refused.',
    })
    return true
  }

  const declareTrustedHosts = () => {
    const connection = host.get('connection')
    return connection !== undefined && Array.isArray(connection.trustedHosts)
      ? connection.trustedHosts.filter((entry) => typeof entry === 'string')
      : []
  }

  const handler = async function handler(request, response) {
    if (refuseByHostGate(request, response)) return
    if (!isAdmitted(request, declareTrustedHosts())) {
      sendJson(response, 403, { error: '这个请求来自不受信任的地址，已拒绝。' })
      return
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const route = url.pathname.slice(ROUTE_PREFIX.length) || '/'
    const method = request.method ?? 'GET'

    try {
      if (route === '/info' && method === 'GET') {
        sendJson(response, 200, handleInfo())
        return
      }
      if (route === '/list' && method === 'GET') {
        sendJson(response, 200, handleList(url))
        return
      }
      if (route === '/inspect' && method === 'GET') {
        sendJson(response, 200, handleInspect(url))
        return
      }
      if (route === '/installed' && method === 'GET') {
        sendJson(response, 200, { entries: await installer.installed() })
        return
      }
      if (route === '/install' && method === 'POST') {
        sendJson(response, 200, await handleInstall(request))
        return
      }
      if (route === '/job' && method === 'GET') {
        sendJson(response, 200, handleJob(url))
        return
      }
      if (route === '/cancel' && method === 'POST') {
        sendJson(response, 200, await handleCancel(request))
        return
      }
      sendJson(response, 404, { error: `未知接口：${method} ${url.pathname}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(response, 400, { error: message })
    }
  }

  return { handler, installer }
}

/**
 * The profile this plugin runs inside. DSH_PROFILE_DIR is authoritative; the
 * env fallbacks cover a launcher that only exports DSH_HOME/DSH_PROFILE.
 */
function resolveProfileDir() {
  const candidates = []
  if (typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR !== '') {
    candidates.push(process.env.DSH_PROFILE_DIR)
  }
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : path.join(os.homedir(), '.dsh')
  const name = typeof process.env.DSH_PROFILE === 'string' && process.env.DSH_PROFILE !== ''
    ? process.env.DSH_PROFILE
    : 'web'
  candidates.push(path.join(home, 'profiles', name))
  candidates.push(process.cwd())
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(path.join(candidate, 'package.json'))
      if (stat.isFile()) return path.resolve(candidate)
    } catch {
      continue
    }
  }
  return null
}

/** Register the route prefix and the plugin-manager listeners it needs. */
function mountRoutes(host) {
  if (host.webServer === undefined || host.webServer === null) {
    throw new Error('当前环境没有 webServer 服务，本地安装页无法注册路由')
  }
  const { handler, installer } = createRoutes(host)

  // install-log/install-state are re-emitted into the job map so a long pnpm run
  // streams into the page instead of arriving only when the promise settles.
  const offLog = host.on('plugin-manager/install-log', (chunk) => installer.onInstallLog(chunk))
  const offState = host.on('plugin-manager/install-state', (progress) => installer.onInstallState(progress))

  const disposeRoute = host.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler,
  })

  return () => {
    if (typeof disposeRoute === 'function') disposeRoute()
    if (typeof offLog === 'function') offLog()
    if (typeof offState === 'function') offState()
  }
}

module.exports = { mountRoutes, ROUTE_PREFIX }
