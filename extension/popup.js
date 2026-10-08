const DEFAULTS = { disabledHosts: [], improve: true, tone: true, baseUrl: 'http://127.0.0.1:8787' }

async function main() {
  const stored = await chrome.storage.local.get(DEFAULTS)
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  let hostname = ''
  try {
    hostname = new URL(tab?.url ?? '').hostname
  }
  catch {}

  const site = document.getElementById('site')
  document.getElementById('host').textContent = hostname || 'this page'
  site.checked = !stored.disabledHosts.includes(hostname)
  site.disabled = !hostname
  site.addEventListener('change', async () => {
    const { disabledHosts } = await chrome.storage.local.get({ disabledHosts: [] })
    const next = site.checked ? disabledHosts.filter(h => h !== hostname) : [...new Set([...disabledHosts, hostname])]
    await chrome.storage.local.set({ disabledHosts: next })
  })

  for (const key of ['improve', 'tone']) {
    const box = document.getElementById(key)
    box.checked = stored[key]
    box.addEventListener('change', () => chrome.storage.local.set({ [key]: box.checked }))
  }

  const baseUrl = document.getElementById('baseUrl')
  baseUrl.value = stored.baseUrl
  baseUrl.addEventListener('change', async () => {
    // background.js only ever calls a loopback address; say so here instead of failing quietly.
    let url = null
    try {
      const parsed = new URL(baseUrl.value.trim() || DEFAULTS.baseUrl)
      url = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) ? parsed.origin : null
    }
    catch {}
    if (!url) {
      document.getElementById('status').textContent = 'Only http://127.0.0.1, localhost or [::1] addresses'
      baseUrl.value = (await chrome.storage.local.get(DEFAULTS)).baseUrl
      return
    }
    baseUrl.value = url
    await chrome.storage.local.set({ baseUrl: url })
    checkHealth()
  })

  checkHealth()
}

async function checkHealth() {
  const { ok } = await chrome.runtime.sendMessage({ type: 'health' })
  document.getElementById('dot').className = `dot ${ok ? 'ok' : 'bad'}`
  document.getElementById('status').textContent = ok ? 'The backend is running' : 'The backend is not running'
}

main()
