// A test page for the content script without installing the extension: it
// loads extension/content.js under a stand-in `chrome` (shim.js) and proxies
// /v1/write/* to my-agent, so the page talks to it same-origin.
//
//   node dev/serve.mjs            → http://127.0.0.1:8790, my-agent at 127.0.0.1:8787
//   UPSTREAM=http://127.0.0.1:8797 PORT=8791 node dev/serve.mjs
//
// /plain is the same page without the shim, for a browser with the real extension loaded.

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const PORT = Number(process.env.PORT ?? 8790)
const UPSTREAM = process.env.UPSTREAM ?? 'http://127.0.0.1:8787'
const here = import.meta.dirname
const FILES = {
  '/': [join(here, 'harness.html'), 'text/html'],
  '/shim.js': [join(here, 'shim.js'), 'text/javascript'],
  '/content.js': [join(here, '../extension/content.js'), 'text/javascript'],
}

createServer(async (request, response) => {
  const path = (request.url ?? '/').split('?')[0]
  if (request.method === 'POST' && (path.startsWith('/v1/write/') || path === '/health')) {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    try {
      const upstream = await fetch(`${UPSTREAM}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.concat(chunks) })
      response.writeHead(upstream.status, { 'content-type': 'application/json' }).end(await upstream.text())
    }
    catch {
      response.writeHead(502, { 'content-type': 'application/json' }).end('{"error":"my-agent is not running"}')
    }
    return
  }
  // The same page without the shim, for a browser with the real extension loaded.
  if (path === '/plain') {
    const html = (await readFile(FILES['/'][0], 'utf8')).replace(/\s*<script src="\/(shim|content)\.js"><\/script>/g, '')
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(html)
    return
  }
  const file = FILES[path]
  if (!file) {
    response.writeHead(404).end()
    return
  }
  response.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-store' }).end(await readFile(file[0]))
}).listen(PORT, '127.0.0.1', () => console.log(`harness on http://127.0.0.1:${PORT}, my-agent at ${UPSTREAM}`))
