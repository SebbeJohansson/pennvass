# fake-grammarly

A Chrome extension that underlines spelling, grammar and unclear sentences in
any textbox, and rewrites a selection on request. Everything runs on this
machine through [my-agent](../my-agent), except the Claude rewrite.

```
Chrome (Windows) ── content.js: watches the textbox, draws underlines and cards
                 └─ background.js ──POST──▶ my-agent 127.0.0.1:8787 /v1/write/*
                                               ├─▶ LanguageTool :8010  check     ~100 ms
                                               ├─▶ Laya         :8000  tone      ~0.3 s
                                               ├─▶ Ollama       :11434 improve   1.5–6 s per sentence
                                               └─▶ runner       :8788  rewrite   5–30 s, Claude
```

| Underline | Meaning | From |
|---|---|---|
| red | spelling | LanguageTool |
| orange | grammar | LanguageTool |
| purple | style | LanguageTool |
| blue dashed, under the sentence | a clearer version of the sentence | qwen2.5:7b |

The badge at the field's bottom-right corner shows the count. Click it to see the
tone (Laya), or to have Claude rewrite the selection (or the whole text) to be
clearer, shorter, more formal, friendlier, more confident, or in English or Swedish.

## Install

1. In `~/projects/my-agent`: `docker compose up -d --build`. That starts
   LanguageTool next to the agent. `LAYA_KEY` in its `.env` turns tone on.
2. `./scripts/install-windows.sh` copies the extension to `C:\Users\<you>\fake-grammarly`.
3. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click
   **Load unpacked**, and pick that folder.

After a change, run step 2 again and click the reload arrow on the extension's card.

## What it reads, and where it goes

- The text of the focused textbox goes to my-agent on loopback, and from there to
  LanguageTool, Laya and Ollama, all on this machine.
- Only a **rewrite** leaves the machine: it goes to Claude, and only when you click one.
- Skipped: password and other non-text inputs, `spellcheck="false"` fields (code
  editors), and anything marked `data-fake-grammarly="off"`. The popup turns it off per site.
- Next to Grammarly, the badge moves left of Grammarly's badge and the underlines
  sit 3 px lower, so both show. `/compare` on the test page puts them side by side.

## Limits

- **Google Docs** draws its text on a canvas, so no extension can underline it.
- **Swedish** is weak: LanguageTool's Swedish rules are thin, and qwen2.5:7b
  passed "se dem" (for "se den") and "jätte kul" in testing.
- **Laya only reads tone.** Untrained, it could not tell a bad sentence from a
  good one, so qwen2.5:7b reads every sentence of 6+ words, at most 3 new
  sentences per request. Results are cached by sentence, so retyping elsewhere
  costs nothing.
- Sites with heavy custom editors (Teams, Slack) may underline correctly but not
  accept a fix, depending on how they handle `execCommand('insertText')`.

## Developing

`dev/serve.mjs` serves a test page with a textarea, an input and two
contenteditables, and proxies `/v1/write/*` to my-agent:

```sh
node dev/serve.mjs                 # http://127.0.0.1:8790 runs content.js under a stand-in `chrome`
                                   # http://127.0.0.1:8790/plain is the bare page, for the real extension
```
