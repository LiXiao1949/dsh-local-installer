'use strict'

/**
 * Small HTTP helpers for the installer's own routes.
 *
 * The routes live on the same webserver the GUI is served from, so the only
 * callers are: (a) this plugin's own page, same origin, and (b) a human poking
 * the endpoints with curl on loopback. Anything else — a page on another site
 * pointed at 127.0.0.1, a DNS-rebinding name — is refused.
 */

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0'])

/** Split an authority into hostname/port without throwing on odd input. */
function parseAuthority(authority) {
  if (typeof authority !== 'string' || authority.length === 0) return null
  const at = authority.lastIndexOf('@')
  const value = at >= 0 ? authority.slice(at + 1) : authority
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end < 0) return null
    const hostname = value.slice(0, end + 1)
    const rest = value.slice(end + 1)
    const port = rest.startsWith(':') ? rest.slice(1) : ''
    return { hostname, port }
  }
  const colon = value.indexOf(':')
  if (colon < 0) return { hostname: value, port: '' }
  return { hostname: value.slice(0, colon), port: value.slice(colon + 1) }
}

function loopbackAuthority(authority) {
  const parsed = parseAuthority(authority)
  if (parsed === null) return false
  return LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase())
}

/**
 * Whether `host` is one of the authorities this deployment declared
 * (`dsh web --trusted-host`, plus the LAN literals the CLI derives). A
 * declared name must match the Host header exactly; a port-less declaration
 * matches that hostname on any port. Same rule as the market's fence, because
 * two fences that disagree about "this deployment" would be worse than one.
 */
function trustedAuthority(host, trustedHosts) {
  if (!Array.isArray(trustedHosts) || trustedHosts.length === 0) return false
  const parsed = parseAuthority(host)
  if (parsed === null) return false
  return trustedHosts.some((entry) => {
    if (typeof entry !== 'string') return false
    const declared = parseAuthority(entry)
    if (declared === null) return false
    if (declared.port === '') return declared.hostname.toLowerCase() === parsed.hostname.toLowerCase()
    return declared.host.toLowerCase() === parsed.host.toLowerCase()
  })
}

/**
 * True when the request may touch this plugin's routes.
 *
 * Mirrors the market's rule: an absent Host is not a page, so it is allowed;
 * a present Host must name loopback or a declared authority. `sec-fetch-site:
 * cross-site` is refused outright, and a present Origin must agree with Host on
 * the hostname (the port may be omitted by recent Chrome only on loopback).
 */
function isAdmitted(request, trustedHosts) {
  const host = request.headers.host
  if (host !== undefined && !loopbackAuthority(host) && !trustedAuthority(host, trustedHosts)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  let originUrl
  try {
    originUrl = new URL(origin)
  } catch {
    return false
  }
  if (originUrl.host === host) return true
  if (originUrl.port === '' && host !== undefined && loopbackAuthority(host)) {
    const hostAuthority = parseAuthority(host)
    return hostAuthority !== null && originUrl.hostname === hostAuthority.hostname
  }
  return false
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

function sendText(response, status, text) {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(text)
}

const MAX_BODY_BYTES = 128 * 1024

/** Read a JSON request body, bounded. Resolves to {} for an empty body. */
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('error', reject)
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') return resolve({})
      try {
        const parsed = JSON.parse(text)
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {})
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
  })
}

module.exports = { isAdmitted, sendJson, sendText, readJsonBody, loopbackAuthority, trustedAuthority }
