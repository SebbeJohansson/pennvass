const DEFAULTS = {
  disabledHosts: [],
  improve: true,
  tone: true,
  ownText: false,
  backend: 'auto',
  baseUrl: 'http://127.0.0.1:8787',
  languagetoolUrl: 'http://127.0.0.1:8010',
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen2.5:7b',
  layaUrl: 'http://127.0.0.1:8000',
  layaKey: '',
  languages: [],
}

/** Languages LanguageTool spells in, as the variant it needs for a dictionary. */
const LANGUAGES = {
  'en-US': 'English (US)', 'en-GB': 'English (UK)', 'sv': 'Swedish', 'da-DK': 'Danish', 'de-DE': 'German',
  'nl-NL': 'Dutch', 'fr': 'French', 'es': 'Spanish', 'it': 'Italian', 'pt-PT': 'Portuguese', 'pl-PL': 'Polish',
}

const base = code => code.split('-')[0].toLowerCase()

/** A browser language ("sv-SE", "en") as one of LANGUAGES, or undefined. */
function known(code) {
  return code in LANGUAGES ? code : Object.keys(LANGUAGES).find(k => base(k) === base(code))
}

/** The languages picker: one primary, any others; the same base twice (US and UK English) is one choice. */
async function showLanguages(stored) {
  const chosen = stored.languages.length ? stored.languages : (await chrome.i18n.getAcceptLanguages()).map(known)
    .filter((code, i, all) => code && all.findIndex(c => c && base(c) === base(code)) === i)
  const primary = document.getElementById('primary')
  const list = document.getElementById('otherLanguages')
  for (const [code, name] of Object.entries(LANGUAGES)) {
    primary.append(new Option(name, code))
  }
  primary.value = chosen[0] ?? 'en-US'

  const draw = (others) => {
    list.replaceChildren()
    for (const [code, name] of Object.entries(LANGUAGES)) {
      if (base(code) === base(primary.value)) {
        continue
      }
      const label = document.createElement('label')
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.value = code
      box.checked = others.includes(code)
      box.addEventListener('change', () => {
        if (box.checked) {
          for (const other of list.querySelectorAll('input:checked')) {
            other.checked = other === box || base(other.value) !== base(code)
          }
        }
        save()
      })
      label.append(box, name)
      list.append(label)
    }
  }
  const save = () => chrome.storage.local.set({
    languages: [primary.value, ...[...list.querySelectorAll('input:checked')].map(box => box.value)],
  })
  primary.addEventListener('change', () => {
    draw([...list.querySelectorAll('input:checked')].map(box => box.value))
    save()
  })
  draw(chosen.slice(1))
}

/** background.js only ever calls a loopback address; refuse anything else here rather than fail quietly there. */
function loopbackUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && !url.username && !url.password ? url.origin : null
  }
  catch {
    return null
  }
}

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

  for (const key of ['improve', 'tone', 'ownText']) {
    const box = document.getElementById(key)
    box.checked = stored[key]
    box.addEventListener('change', () => chrome.storage.local.set({ [key]: box.checked }))
  }

  const backend = document.getElementById('backend')
  backend.value = stored.backend
  backend.addEventListener('change', async () => {
    await chrome.storage.local.set({ backend: backend.value })
    showStatus()
  })

  await showLanguages(stored)

  const note = document.getElementById('note')
  for (const input of document.querySelectorAll('[data-url]')) {
    const key = input.dataset.url
    input.value = stored[key]
    input.addEventListener('change', async () => {
      const url = loopbackUrl(input.value.trim() || DEFAULTS[key])
      if (!url) {
        note.textContent = 'Only http://127.0.0.1 or http://localhost addresses'
        input.value = (await chrome.storage.local.get(DEFAULTS))[key]
        return
      }
      note.textContent = ''
      input.value = url
      await chrome.storage.local.set({ [key]: url })
      showStatus()
    })
  }

  for (const key of ['ollamaModel', 'layaKey']) {
    const input = document.getElementById(key)
    input.value = stored[key]
    input.addEventListener('change', async () => {
      await chrome.storage.local.set({ [key]: input.value.trim() || DEFAULTS[key] })
      showStatus()
    })
  }

  showStatus()
}

const MARK = { up: ['✓', 'ok-text'], down: ['✗', 'bad-text'], blocked: ['403', 'bad-text'], 'no key': ['no key', 'warn-text'] }

async function showStatus() {
  const status = await chrome.runtime.sendMessage({ type: 'status' })
  const dot = document.getElementById('dot')
  const text = document.getElementById('status')
  const engines = document.getElementById('engines')
  engines.replaceChildren()
  if (status.active === 'my-agent') {
    const up = status.myAgent === 'up'
    dot.className = `dot ${up ? 'ok' : 'bad'}`
    text.textContent = up ? 'Using my-agent' : 'my-agent is not running'
    return
  }
  const { languagetool, ollama, laya } = status.engines
  dot.className = `dot ${languagetool === 'up' ? 'ok' : 'bad'}`
  text.textContent = status.mode === 'auto' ? 'Direct (my-agent is not running)' : 'Direct'
  for (const [name, state] of [['LanguageTool', languagetool], ['Ollama', ollama], ['Laya', laya]]) {
    const [mark, cls] = MARK[state]
    const item = document.createElement('span')
    item.className = cls
    item.textContent = `${name} ${mark}`
    engines.append(item, '  ')
  }
}

main()
