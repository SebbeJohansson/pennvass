// Every check goes through here. A content script runs with the page's origin,
// so its own fetch to 127.0.0.1 would need CORS that the engines deliberately
// never answer; the service worker has host_permissions instead.
//
// Two backends do the same four things (check, improve, tone, rewrite):
//
// - my-agent: one server on 127.0.0.1:8787 that runs the engines itself, and
//   can rewrite with Claude.
// - direct: this worker calls LanguageTool, Ollama and Laya itself, with the
//   same code (lib/write-core.js). No rewrite: that needs a model with no
//   tools, which only my-agent sets up.
//
// "auto" (the default) uses my-agent when its /health answers, and direct when
// it does not, so starting or stopping my-agent needs no setting changed.

import * as core from './lib/write-core.js'

const DEFAULTS = {
  backend: 'auto',
  baseUrl: 'http://127.0.0.1:8787',
  languagetoolUrl: 'http://127.0.0.1:8010',
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen2.5:7b',
  layaUrl: 'http://127.0.0.1:8000',
  layaKey: '',
}

const ROUTES = new Set(['check', 'tone', 'improve', 'rewrite'])
const URL_SETTINGS = ['baseUrl', 'languagetoolUrl', 'ollamaUrl', 'layaUrl']

/** The text of every textbox you type in goes to these, so only a loopback address is accepted. */
function loopbackUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && !url.username && !url.password
      ? url.origin
      : null
  }
  catch {
    return null
  }
}

async function settings() {
  const stored = await chrome.storage.local.get(DEFAULTS)
  for (const key of URL_SETTINGS) {
    stored[key] = loopbackUrl(stored[key]) ?? DEFAULTS[key]
  }
  return stored
}

/** Nothing answered at all: not running, or the wrong port. Distinct from an engine that answered with an error. */
class Unreachable extends Error {}

/** Runs `work`; a fetch in it that reached nothing (refused, or timed out) becomes Unreachable. */
async function reaching(work) {
  try {
    return await work()
  }
  catch (cause) {
    if (cause?.name === 'TimeoutError' || cause instanceof TypeError) {
      throw new Unreachable(String(cause))
    }
    throw cause
  }
}

// ---------------------------------------------------------------- my-agent

const myAgent = {
  name: 'my-agent',
  async call(route, body, s) {
    const response = await reaching(() => fetch(`${s.baseUrl}/v1/write/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
    const data = await response.json().catch(() => ({}))
    return response.ok ? { ok: true, data } : { ok: false, error: data.error ?? `my-agent answered ${response.status}` }
  },
}

// ---------------------------------------------------------------- direct

/** Each sentence's answer, kept while the browser runs: this worker is stopped often, a Map would not last. */
function sessionCache(model) {
  const key = sentence => `improve:${model}:${sentence}`
  return {
    async get(sentence) {
      const found = await chrome.storage.session.get(key(sentence))
      return key(sentence) in found ? found[key(sentence)] : undefined
    },
    set: (sentence, suggestion) => chrome.storage.session.set({ [key(sentence)]: suggestion }),
  }
}

const direct = {
  name: 'direct',
  async call(route, body, s) {
    if (route === 'check') {
      // The browser's accepted languages are the writer's: mixed text is checked in them.
      const languages = await chrome.i18n.getAcceptLanguages()
      return { ok: true, data: await reaching(() => core.check(body.text, { languagetoolUrl: s.languagetoolUrl, languages })) }
    }
    if (route === 'improve') {
      return {
        ok: true,
        data: await reaching(() => core.improve(body.text, {
          complete: core.ollamaComplete({ ollamaUrl: s.ollamaUrl, model: s.ollamaModel }),
          cache: sessionCache(s.ollamaModel),
        })),
      }
    }
    if (route === 'tone') {
      if (!s.layaKey) {
        return { ok: false, error: 'tone needs a Laya key (Pennvass popup)' }
      }
      return { ok: true, data: await reaching(() => core.tone(body.text, { layaUrl: s.layaUrl, layaKey: s.layaKey })) }
    }
    return { ok: false, error: 'Rewrite needs my-agent' }
  },
}

/** Where each engine of direct mode is, for error messages. */
function engineName(route, s) {
  return {
    check: `LanguageTool on ${s.languagetoolUrl}`,
    improve: `Ollama on ${s.ollamaUrl}`,
    tone: `Laya on ${s.layaUrl}`,
  }[route] ?? 'the engine'
}

// ---------------------------------------------------------------- choosing

const PROBE_TTL = 30_000
/** A direct engine failing asks my-agent again, but not more than this often. */
const REPROBE_AFTER_FAILURE = 5_000
let probe = { url: '', up: false, at: 0 }

async function myAgentUp(url, { maxAge = PROBE_TTL } = {}) {
  if (probe.url === url && Date.now() - probe.at < maxAge) {
    return probe.up
  }
  let up = false
  try {
    up = (await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) })).ok
  }
  catch {}
  probe = { url, up, at: Date.now() }
  return up
}

async function run(backend, route, body, s) {
  try {
    return { ...await backend.call(route, body, s), backend: backend.name }
  }
  catch (cause) {
    if (cause instanceof Unreachable) {
      throw cause
    }
    return { ok: false, error: String(cause?.message ?? cause), backend: backend.name }
  }
}

function unreachable(backend, route, s) {
  const where = backend === myAgent ? `my-agent on ${s.baseUrl}` : engineName(route, s)
  return { ok: false, offline: true, error: `${where} is not running`, backend: backend.name }
}

async function write(route, body) {
  if (!ROUTES.has(route) || typeof body?.text !== 'string' || body.text.length > core.MAX_TEXT
    || (route === 'rewrite' && !(body.style in core.STYLES))) {
    return { ok: false, error: `bad request for ${route}` }
  }
  const s = await settings()
  const pinned = { 'my-agent': myAgent, 'direct': direct }[s.backend]
  if (pinned) {
    return run(pinned, route, body, s).catch(() => unreachable(pinned, route, s))
  }

  // auto: my-agent while it answers; direct otherwise.
  if (await myAgentUp(s.baseUrl)) {
    try {
      return await run(myAgent, route, body, s)
    }
    catch {
      probe = { url: s.baseUrl, up: false, at: Date.now() }
    }
  }
  try {
    return await run(direct, route, body, s)
  }
  catch {
    // A direct engine is down: maybe my-agent has come up meanwhile.
    if (await myAgentUp(s.baseUrl, { maxAge: REPROBE_AFTER_FAILURE })) {
      return run(myAgent, route, body, s).catch(() => unreachable(myAgent, route, s))
    }
    return unreachable(direct, route, s)
  }
}

// ---------------------------------------------------------------- status

async function answers(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return response.status === 403 ? 'blocked' : 'up'
  }
  catch {
    return 'down'
  }
}

/** For the popup: which backend is in use, and how each engine of direct mode is doing. */
async function status() {
  const s = await settings()
  const agentUp = await myAgentUp(s.baseUrl, { maxAge: 0 })
  const active = s.backend === 'auto' ? (agentUp ? 'my-agent' : 'direct') : s.backend
  const [languagetool, ollama, laya] = await Promise.all([
    answers(`${s.languagetoolUrl}/v2/languages`),
    answers(`${s.ollamaUrl}/api/tags`),
    s.layaKey ? answers(`${s.layaUrl}/`) : Promise.resolve('no key'),
  ])
  return { mode: s.backend, active, myAgent: agentUp ? 'up' : 'down', engines: { languagetool, ollama, laya } }
}

// ---------------------------------------------------------------- Ollama's origin check

// Ollama refuses requests whose Origin is a chrome-extension:// one (403)
// unless OLLAMA_ORIGINS says otherwise. This rule removes the Origin header,
// only from this extension's own requests, only to the configured Ollama:
// the same request curl makes. Session rules go when the browser closes, so it
// is set again whenever the worker starts.
const OLLAMA_RULE = 1

async function syncOllamaRule() {
  const { ollamaUrl } = await settings()
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [OLLAMA_RULE],
    addRules: [{
      id: OLLAMA_RULE,
      priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'remove' }] },
      condition: { urlFilter: `|${ollamaUrl}/`, initiatorDomains: [chrome.runtime.id], resourceTypes: ['xmlhttprequest', 'other'] },
    }],
  })
}

syncOllamaRule()
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') {
    return
  }
  if (changes.ollamaUrl) {
    syncOllamaRule()
  }
  if (changes.baseUrl || changes.backend) {
    probe = { url: '', up: false, at: 0 }
  }
})

// ---------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's own content scripts and popup; no externally_connectable is declared, but say so.
  if (sender.id !== chrome.runtime.id) {
    return false
  }
  if (message?.type === 'write') {
    write(message.route, message.body).then(sendResponse)
    return true
  }
  if (message?.type === 'status') {
    status().then(sendResponse)
    return true
  }
  // A rewrite takes up to two minutes; the page pings while it waits so this
  // worker is not stopped for being idle mid-request.
  if (message?.type === 'keepalive') {
    sendResponse({ ok: true })
  }
  return false
})
