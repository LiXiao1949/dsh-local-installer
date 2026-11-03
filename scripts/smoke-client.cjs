// `node scripts/smoke-client.cjs` — load the built client bundle outside a
// browser: stub the module
// loader, react, and document, run apply(), then render every registered
// component once. Catches registration mistakes and render-time ReferenceErrors
// without needing a DOM.
const path = require('node:path')

const bundlePath = process.argv[2] || path.join(__dirname, '..', 'lib', 'client.js')

let loaded = null
global.window = {
  __ModuleLoader__: {
    load(options) {
      loaded = options
    },
  },
}

const styleStub = () => ({
  attributes: {},
  textContent: '',
  setAttribute(name, value) {
    this.attributes[name] = value
  },
  remove() {
    this.removed = true
  },
})
const appended = []
global.document = {
  createElement: styleStub,
  head: { appendChild: (node) => appended.push(node) },
}

const h = (type, props, ...children) => ({ type, props: props || {}, children })
let seed = []
let seedCursor = 0
function nextSeeded(initial) {
  if (seedCursor >= seed.length) return typeof initial === 'function' ? initial() : initial
  const value = seed[seedCursor]
  seedCursor += 1
  return value
}
function expand(node, depth) {
  if (depth > 40 || node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((one) => expand(one, depth + 1))
  const { type, props, children } = node
  if (typeof type === 'function') {
    return expand(type(Object.assign({}, props, { children: children.length === 1 ? children[0] : children })), depth + 1)
  }
  return Object.assign({}, node, { children: expand(children, depth + 1) })
}
function collectText(node, out) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (typeof node === 'object') collectText(node.children, out)
  return out
}
const React = {
  createElement: h,
  Fragment: 'fragment',
  useState: (initial) => [nextSeeded(initial), () => {}],
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
}
const requireTable = (name) => {
  if (name === 'react') return React
  throw new Error(`unexpected module request: ${name}`)
}

require(path.resolve(bundlePath))

const problems = []
if (loaded === null) problems.push('bundle never called window.__ModuleLoader__.load')
if (loaded.id !== '@local/dsh-local-install') problems.push(`unexpected module id: ${loaded.id}`)

const mod = loaded.factory(requireTable)
if (typeof mod.apply !== 'function') problems.push('missing mod.apply')
if (mod.name !== 'dsh-local-install') problems.push(`unexpected mod.name: ${mod.name}`)

const registrations = []
const injections = []
let dispose = null
const ctx = {
  slots: {
    inject(name, callback) {
      injections.push(name)
      callback()
      return () => {}
    },
    register(spec, component) {
      registrations.push({ spec, component })
      return () => {}
    },
  },
}

let threw = null
try {
  dispose = mod.apply(ctx)
} catch (error) {
  threw = error
}
if (threw !== null) problems.push(`apply() threw: ${threw && threw.stack}`)
if (typeof dispose !== 'function') problems.push('apply() did not return a disposer')

const byName = new Map()
for (const row of registrations) {
  const name = row.spec.name
  if (!byName.has(name)) byName.set(name, [])
  byName.get(name).push(row)
  // A list slot needs an id, a keyed slot needs a key; either way the spec must be identifiable.
  if (row.spec.id === undefined && row.spec.key === undefined) problems.push(`slot ${name} has neither id nor key`)
  if (name !== 'main' && typeof row.spec.order !== 'number') problems.push(`list slot ${name} has no numeric order`)
  if (typeof row.component !== 'function') problems.push(`slot ${name} has no component function`)
  if (name === 'main' && row.spec.key !== 'dsh-local-install') problems.push(`main key is ${row.spec.key}`)
  if (name === 'sidebar.panellist' && row.spec.id !== 'dsh-local-install') problems.push(`panellist id is ${row.spec.id}`)
  if (name === 'settings.section' && row.spec.id !== 'dsh-local-install') problems.push(`settings id is ${row.spec.id}`)
}

const expected = ['main', 'sidebar.panellist', 'settings.section']
for (const name of expected) if (!byName.has(name)) problems.push(`slot ${name} was not registered`)
if (injections.length !== 2) problems.push(`expected 2 slot injections, saw ${injections.length}`)

// Render every registered component with the props its owner would pass.
const rendered = []
for (const [name, rows] of byName) {
  for (const row of rows) {
    try {
      const tree =
        name === 'sidebar.panellist' ? row.component({ size: 16, active: false }) : row.component({})
      let nodes = 0
      deepRender(tree, 0)
      rendered.push(`${name}: ${describe(tree)} (${nodes} elements deep-rendered)`)

      function deepRender(node, depth) {
        if (depth > 40 || node === null || node === undefined) return
        if (Array.isArray(node)) {
          for (const child of node) deepRender(child, depth + 1)
          return
        }
        if (typeof node !== 'object') return
        nodes += 1
        const { type, props, children } = node
        if (typeof type === 'function') {
          const produced = type(Object.assign({}, props, { children: children.length === 1 ? children[0] : children }))
          deepRender(produced, depth + 1)
          return
        }
        deepRender(children, depth + 1)
      }
    } catch (error) {
      problems.push(`rendering ${name} threw: ${error && error.stack}`)
    }
  }
}

function describe(node, depth = 0) {
  if (node === null || node === undefined) return String(node)
  if (typeof node === 'string') return JSON.stringify(node.slice(0, 40))
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (Array.isArray(node)) return `[${node.length} children]`
  if (typeof node === 'object') {
    const tag = typeof node.type === 'string' ? node.type : String(node.type && node.type.name)
    const marker = node.props && node.props['data-dsh-local-install']
    return `<${tag}${marker !== undefined ? ` data-dsh-local-install=${marker}` : ''}>`
  }
  return typeof node
}

// Second phase: populate every Page state the way the real fetches would, so
// the list/installed/job branches render too.
const sampleInfo = {
  profileDir: '/p',
  sourcesDir: '/p/local-plugins',
  home: '/root',
  roots: ['/root/share'],
  initialDir: '/root/share/mcp',
}
const sampleListing = {
  path: '/root/share/mcp',
  parent: '/root/share',
  plugin: null,
  entries: [
    {
      name: 'dsh-local-install',
      path: '/root/share/mcp/dsh-local-install',
      kind: 'dir',
      plugin: { name: '@local/dsh-local-install', version: '1.0.0', description: 'd', hasBundle: true, hasClient: true, installable: true, problem: '' },
      error: null,
    },
    { name: '写小说专用.zip', path: '/root/share/mcp/写小说专用.zip', kind: 'zip', plugin: null, error: null, size: 227431 },
  ],
}
const sampleInstalled = { entries: [{ name: '@local/dsh-local-install', version: '1.0.0', enabled: true }] }
const sampleJob = {
  id: 'job-1',
  state: 'done',
  step: 'done',
  message: '安装完成',
  log: [{ stream: 'stdout', text: 'added 1 package' }],
  plugin: { name: '@local/dsh-local-install', version: '1.0.0' },
}
seed = [sampleInfo, sampleListing, '/root/share/mcp', null, false, 'job-1', sampleJob, sampleInstalled.entries]
seedCursor = 0
const mainRow = (byName.get('main') || [])[0]
let texts = []
if (mainRow !== undefined) {
  try {
    texts = collectText(expand(mainRow.component({}), 0), [])
    console.log('populated branch text:', texts.join(' | ').slice(0, 600))
    if (!texts.join(' ').includes('dsh-local-install')) problems.push('populated branch never mentions the installed package')
    if (!texts.join(' ').includes('写小说专用.zip')) problems.push('populated branch never lists the zip entry')
  } catch (error) {
    problems.push(`populated branch threw: ${error && error.stack}`)
  }
}
seed = []
seedCursor = 0

console.log('module id      :', loaded.id)
console.log('mod.name   :', mod.name)
console.log('injections     :', injections.join(', '))
console.log('registrations  :', registrations.map((row) => `${row.spec.name}#${row.spec.id || row.spec.key}@${row.spec.order}`).join(' | '))
console.log('style injected :', appended.length === 1)
console.log('rendered       :')
for (const line of rendered) console.log('  -', line)
console.log(problems.length === 0 ? 'SMOKE OK' : `SMOKE FAILED\n - ${problems.join('\n - ')}`)
process.exit(problems.length === 0 ? 0 : 1)
