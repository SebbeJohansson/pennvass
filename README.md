# Pennvass

*Pennvass*: Swedish for "sharp with the pen".

A Chrome extension for spelling, grammar and clearer writing in any textbox,
backed by language tools and models running on your own machine. It
underlines mistakes as you type, suggests clearer versions of wordy sentences,
reads the tone of what you wrote, and can have Claude rewrite a selection on
request.

It is a personal stand-in for a paid writing assistant. The extension talks
to engines on your own machine, directly or through a backend server:

```
Chrome ── content.js: finds the focused textbox, draws underlines, cards and a badge
       └─ background.js ─┬─ direct ──▶ LanguageTool  127.0.0.1:8010   spelling and grammar, ~100 ms
                         │          ├─▶ Ollama        127.0.0.1:11434  clearer sentences, 2–8 s each
                         │          └─▶ Laya          127.0.0.1:8000   tone (optional)
                         └─ backend ─▶ a server on 127.0.0.1:8787 with the same checks, plus rewrite
```

Out of the box it uses a backend when one answers on `127.0.0.1:8787`, and
calls the engines directly when none does. Starting or stopping the backend
needs no setting changed. Only a backend can rewrite: that needs a model with
no tools, which the extension cannot set up itself.

## What you see

| Underline | Meaning |
|---|---|
| red | spelling |
| orange | grammar |
| purple | style |
| light blue, under a whole sentence | a clearer version of the sentence is available |

- **Click an underline** for a card with the fix. A sentence rewrite shows a
  word-by-word diff before you apply it. Fixes are typed in with
  `execCommand('insertText')`, so the site sees normal input and Ctrl+Z undoes them.
- **The badge** (bottom-left of the field) shows the count. Click it for the
  list of suggestions, the tone, and rewrite buttons: clearer, shorter, more
  formal, friendlier, more confident, in English, in Swedish.
- **The popup** turns Pennvass off per site, and turns the clarity and tone
  checks on or off.
- **Next to Grammarly** both can run: Pennvass's underlines sit a few pixels lower.

## Install

1. Build and start LanguageTool. The image holds only the official release zip
   (checked against a pinned hash) on Eclipse Temurin's Java, see
   [`docker/languagetool/Dockerfile`](docker/languagetool/Dockerfile):
   ```sh
   docker build -t pennvass-languagetool docker/languagetool
   docker run -d --name languagetool -p 127.0.0.1:8010:8010 pennvass-languagetool
   ```
2. For clarity suggestions, install [Ollama](https://ollama.com) and run
   `ollama pull qwen2.5:7b`. It needs no other setup: the extension removes the
   `Origin` header from its own requests to Ollama, which Ollama would otherwise refuse.
3. In Chrome, open `chrome://extensions` and turn on **Developer mode**.
4. Click **Load unpacked** and pick the `extension/` folder.

The popup shows what it found, for example *Direct: LanguageTool ✓ Ollama ✓ Laya no key*.
Under **Addresses and keys** you can change the engines' addresses, the Ollama
model, and add a [Laya](https://github.com/NandhaKishorM/laya) key for tone.

| Backend setting | Uses |
|---|---|
| **Auto** (default) | the backend on `127.0.0.1:8787` while its `/health` answers (checked every 30 s, and at once when a call fails), the engines directly otherwise |
| **my-agent** | only the backend |
| **Direct** | only the engines |

On WSL, Chrome on Windows loads unpacked extensions unreliably from `\\wsl$`.
`./scripts/install-windows.sh` copies `extension/` to `%USERPROFILE%\pennvass`
and stamps the copy with its commit, shown on the extension's card. Load that
folder instead, and run the script again after each change.

## Your own backend (optional)

A backend is a server on `127.0.0.1:8787` that runs the engines for the
extension, and can add a rewrite. The checks themselves are in
`extension/lib/write-core.js`, a plain ES module with no browser APIs, so a
Node backend can import the same file (types in `write-core.d.ts`).

It has four `POST` routes, JSON in and out. Only `check` is required: if the others
fail, their part of the UI stays empty.

| Route | Request | Response |
|---|---|---|
| `/v1/write/check` | `{ text }` | `{ language, issues: Issue[] }` |
| `/v1/write/improve` | `{ text }` | `{ issues: Issue[], pending }` |
| `/v1/write/tone` | `{ text }` | `{ tone, probabilities }` |
| `/v1/write/rewrite` | `{ text, style }` | `{ text }` |

```ts
interface Issue {
  offset: number          // UTF-16 code units into `text`, as JavaScript counts
  length: number
  message: string         // shown in the card
  replacements: string[]  // the first is the one-click fix
  kind: 'spelling' | 'grammar' | 'style' | 'clarity'
  source: string
}
```

- `text` is at most 20,000 characters.
- **improve** may read only part of the text per call. It returns the number of
  sentences it has not read yet as `pending`, and the extension calls again
  until `pending` is 0. Cache by sentence, since the same text arrives on every pause.
- **tone** returns one of `formal`, `friendly`, `casual`, `confident`,
  `frustrated`, plus a probability for each.
- **rewrite** `style` is one of `clearer`, `shorter`, `formal`, `friendly`,
  `confident`, `english`, `swedish`.
- `GET /health` answering 200 is how Auto finds the backend.

Errors are `{ error }` with a 4xx or 5xx status, and the message is shown in the badge menu.

### What the backend must refuse

A web page can send requests to `127.0.0.1` as well, so the backend must accept
only this extension:

- **Refuse any `POST` that is not `content-type: application/json`.** A page can
  only send that cross-origin after a CORS preflight. Never answer the preflight.
- **Refuse a `Host` header that is not `127.0.0.1`, `localhost` or `[::1]`.**
  That stops DNS rebinding.
- **Listen on loopback only.**
- **Give `rewrite` no tools.** Its text comes from web pages and can carry
  instructions. With Claude Code, start it with `--tools "" --strict-mcp-config`,
  so it has neither built-in tools nor MCP servers.

## Privacy

- **Text that is sent:** the text of the field you are typing in, to the backend
  on your machine.
- **Never read:** password fields, other non-text inputs, read-only fields, and
  code editors (CodeMirror, Monaco, Ace, and `spellcheck="false"` fields when
  Grammarly is not on the page).
- **Opting a field out:** a page can add `data-pennvass="off"` to a field.
- **Where a rewrite goes:** to whatever model the backend uses, and only when
  you click one. With a hosted model like Claude, that means the selected text
  leaves your machine.
- **What the extension stores:** your settings and the Laya key, in
  `chrome.storage.local`. The key is only ever sent to Laya. Clarity answers
  are cached by sentence in `chrome.storage.session`, which is cleared when the browser closes.

## Security

- The extension can only reach `127.0.0.1` and `localhost` (its host
  permissions), and the popup refuses any other address.
- It removes the `Origin` header only from its own requests, and only to the
  configured Ollama address. Pages' requests to Ollama are not touched, so
  Ollama's protection against web pages still holds.
- The UI lives in a closed shadow root, so page scripts cannot reach it.
  Applying a fix or starting a rewrite needs a real click; one a page script
  fakes is ignored.
- `dev/serve.mjs` (below) applies the same refusals as the backend before
  proxying, so running it does not open the backend to other sites.

## Limits

- **Google Docs** draws its text on a canvas, so no extension can underline it.
- **Custom editors** (Teams, Slack and the like) may show underlines correctly
  but not accept a fix, depending on how they handle `execCommand('insertText')`.
- **Quality depends on the backend.** With LanguageTool and qwen2.5:7b, English
  is good. Swedish relies mostly on the LLM, because LanguageTool's Swedish rules are thin.

## Developing

`dev/serve.mjs` serves test pages. The `/` page (no extension) proxies `/v1/write/*` to a backend.

```sh
node dev/serve.mjs   # UPSTREAM=http://127.0.0.1:8787 PORT=8790 by default
```

- `http://127.0.0.1:8790/` runs `content.js` under a stand-in `chrome`, with no extension needed.
- `/plain` is the same page without it, for testing the real extension.
- `/compare` puts Pennvass and Grammarly side by side, each turned off in the
  other's fields, and lists everything Pennvass found.

## License

MIT. See [LICENSE](LICENSE).
