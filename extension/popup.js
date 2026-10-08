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
    await chrome.storage.local.set({ baseUrl: baseUrl.value.trim() || DEFAULTS.baseUrl })
    checkHealth()
  })

  checkHealth()
}

async function checkHealth() {
  const { ok } = await chrome.runtime.sendMessage({ type: 'health' })
  document.getElementById('dot').className = `dot ${ok ? 'ok' : 'bad'}`
  document.getElementById('status').textContent = ok ? 'my-agent is running' : 'my-agent is not running'
}

main()
