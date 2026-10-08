// The part of `chrome` content.js uses, backed by this page: storage in
// memory, and messages answered by fetching the dev server's proxy.
(() => {
  const store = {}
  const listeners = []
  window.chrome = {
    runtime: {
      async sendMessage(message) {
        if (message.type === 'keepalive') return { ok: true }
        try {
          const response = await fetch(`/v1/write/${message.route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message.body) })
          const data = await response.json().catch(() => ({}))
          if (response.status === 502 && data.error === 'my-agent is not running') return { ok: false, offline: true, error: data.error }
          return response.ok ? { ok: true, data } : { ok: false, error: data.error }
        }
        catch {
          return { ok: false, offline: true, error: 'my-agent is not running' }
        }
      },
    },
    storage: {
      local: {
        async get(defaults) { return { ...defaults, ...store } },
        async set(values) { Object.assign(store, values); listeners.forEach(fn => fn()) },
      },
      onChanged: { addListener: fn => listeners.push(fn) },
    },
  }
})()
