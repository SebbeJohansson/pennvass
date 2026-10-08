// Every request to my-agent goes through here. A content script runs with the
// page's origin, so its own fetch to 127.0.0.1 would need CORS that my-agent
// deliberately never answers; the service worker has host_permissions instead.

const DEFAULT_BASE_URL = 'http://127.0.0.1:8787'

async function baseUrl() {
  const { baseUrl } = await chrome.storage.local.get({ baseUrl: DEFAULT_BASE_URL })
  return baseUrl.replace(/\/+$/, '')
}

async function write(route, body) {
  let response
  try {
    response = await fetch(`${await baseUrl()}/v1/write/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }
  catch {
    return { ok: false, offline: true, error: 'my-agent is not running' }
  }
  const data = await response.json().catch(() => ({}))
  return response.ok ? { ok: true, data } : { ok: false, error: data.error ?? `my-agent answered ${response.status}` }
}

async function health() {
  try {
    const response = await fetch(`${await baseUrl()}/health`, { signal: AbortSignal.timeout(3000) })
    return { ok: response.ok }
  }
  catch {
    return { ok: false }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'write') {
    write(message.route, message.body).then(sendResponse)
    return true
  }
  if (message?.type === 'health') {
    health().then(sendResponse)
    return true
  }
  // A rewrite takes up to two minutes; the page pings while it waits so this
  // worker is not stopped for being idle mid-request.
  if (message?.type === 'keepalive') {
    sendResponse({ ok: true })
  }
  return false
})
