// Pennvass's page side: finds the textbox you are typing in, asks
// my-agent about its text, draws underlines over it, and applies a fix when
// you pick one.
//
// Nothing is drawn inside the page's own DOM. One host element holds a closed
// shadow root with every underline, card and badge, positioned `fixed` over
// the field, so the page's CSS cannot reach it and the field's HTML is never
// touched. Fixes are typed in with execCommand('insertText'): the site sees an
// ordinary input event, and Ctrl+Z undoes it.

(() => {
  if (window.__pennvass) {
    return
  }
  window.__pennvass = true

  const CHECK_DELAY = 600
  const AI_DELAY = 2000
  const MAX_TEXT = 20_000
  const MIN_TONE_TEXT = 30

  const COLORS = { spelling: '#e5484d', grammar: '#f5a524', style: '#8e4ec6', clarity: '#0090ff' }
  const KIND_LABEL = { spelling: 'Spelling', grammar: 'Grammar', style: 'Style', clarity: 'Rewrite sentence' }
  const TONE_LABEL = { formal: '🎩 Formal', friendly: '🙂 Friendly', casual: '👋 Casual', confident: '💪 Confident', frustrated: '😤 Frustrated' }
  const STYLES = [
    ['clearer', 'Clearer'],
    ['shorter', 'Shorter'],
    ['formal', 'More formal'],
    ['friendly', 'Friendlier'],
    ['confident', 'More confident'],
    ['english', 'In English'],
    ['swedish', 'In Swedish'],
  ]
  const INPUT_TYPES = new Set(['text', 'search'])
  const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TR', 'TABLE', 'SECTION', 'ARTICLE'])

  // ------------------------------------------------------------ settings

  const settings = { enabled: true, improve: true, tone: true }

  function applySettings(stored) {
    settings.enabled = !(stored.disabledHosts ?? []).includes(location.hostname)
    settings.improve = stored.improve ?? true
    settings.tone = stored.tone ?? true
    if (!settings.enabled) {
      setActive(null)
    }
  }

  chrome.storage.local.get({ disabledHosts: [], improve: true, tone: true }).then(applySettings)
  chrome.storage.onChanged.addListener(() => chrome.storage.local.get({ disabledHosts: [], improve: true, tone: true }).then(applySettings))

  function api(route, body) {
    return chrome.runtime.sendMessage({ type: 'write', route, body })
      .catch(() => ({ ok: false, error: 'the extension was reloaded; reload this page' }))
  }

  // ------------------------------------------------------------ the UI host

  const host = document.createElement('pennvass-ui')
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;'
  const shadow = host.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    .line { position: fixed; height: 2px; border-radius: 1px; pointer-events: none; }
    .line.clarity { opacity: .45; }
    .diff { background: #f9f9fb; border-radius: 6px; padding: 8px; margin-bottom: 10px; }
    .diff del { color: #ce2c31; text-decoration: line-through; }
    .diff ins { color: #11a36a; text-decoration: none; font-weight: 600; }
    .diff del + ins, .diff ins + del { margin-left: .3em; }
    .mirror { position: fixed; visibility: hidden; overflow: hidden; pointer-events: none; }
    .ui { pointer-events: auto; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1c2024; }
    .badge { position: fixed; min-width: 22px; height: 22px; padding: 0 7px; border-radius: 11px; border: none;
      display: flex; align-items: center; justify-content: center; gap: 4px; cursor: pointer;
      background: #11a36a; color: white; font-weight: 600; font-size: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
    .badge.issues { background: #e5484d; }
    .badge.busy { background: #0090ff; }
    .badge.offline { background: #8b8d98; }
    .card { position: fixed; width: 320px; max-width: calc(100vw - 16px); background: white; border-radius: 10px;
      box-shadow: 0 6px 24px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.06); padding: 12px; }
    .kind { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #60646c; margin-bottom: 6px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; }
    .msg { margin-bottom: 10px; }
    .reps { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    button.rep { border: none; border-radius: 6px; padding: 5px 10px; background: #11a36a; color: white; font: inherit; font-weight: 600;
      cursor: pointer; text-align: left; max-width: 100%; }
    button.rep:hover { background: #0e8a5a; }
    button.link { border: none; background: none; color: #60646c; font: inherit; cursor: pointer; padding: 2px 0; margin-right: 12px; }
    button.link:hover { color: #1c2024; text-decoration: underline; }
    .row { display: flex; align-items: center; justify-content: space-between; margin: 4px 0; }
    .muted { color: #60646c; font-size: 12px; }
    .styles { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 8px 0; }
    button.style { border: 1px solid #d9d9e0; border-radius: 6px; padding: 5px 8px; background: white; font: inherit; cursor: pointer; text-align: left; }
    button.style:hover { background: #f0f0f3; }
    .result { white-space: pre-wrap; max-height: 260px; overflow: auto; background: #f9f9fb; border-radius: 6px; padding: 8px; margin: 8px 0; }
    .err { color: #ce2c31; }
    .list { max-height: 220px; overflow: auto; margin: 8px -4px; }
    .item { display: flex; align-items: center; border-radius: 6px; }
    .item:hover { background: #f0f0f3; }
    button.pick { flex: 1; display: flex; align-items: baseline; gap: 8px; border: none; background: none; padding: 6px 4px;
      font: inherit; color: inherit; text-align: left; cursor: pointer; min-width: 0; }
    button.pick .dot { flex: none; transform: translateY(-1px); }
    .what del { color: #ce2c31; }
    .what ins { color: #11a36a; text-decoration: none; font-weight: 600; }
    button.x { border: none; background: none; color: #8b8d98; font-size: 16px; cursor: pointer; padding: 2px 8px; visibility: hidden; }
    .item:hover button.x { visibility: visible; }
    button.x:hover { color: inherit; }
    @media (prefers-color-scheme: dark) {
      .ui { color: #edeef0; }
      .card { background: #212225; box-shadow: 0 6px 24px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08); }
      .kind, .muted, button.link { color: #b0b4ba; }
      button.link:hover { color: #edeef0; }
      button.style { background: #2b2d31; border-color: #43484e; color: #edeef0; }
      button.style:hover { background: #363a3f; }
      .result, .diff { background: #2b2d31; }
      .diff del { color: #ff9592; }
      .diff ins { color: #3dd68c; }
      .err { color: #ff9592; }
      .item:hover { background: #2b2d31; }
      .what del { color: #ff9592; }
      .what ins { color: #3dd68c; }
    }
  </style><div id="lines"></div><div id="ui"></div>`
  const linesLayer = shadow.getElementById('lines')
  const uiLayer = shadow.getElementById('ui')
  const mirror = document.createElement('div')
  mirror.className = 'mirror'
  shadow.appendChild(mirror)

  // Clicks on our UI must not take focus or the selection away from the field.
  shadow.addEventListener('mousedown', event => event.preventDefault())
  // Only a real click may press our buttons (apply a fix, start a Claude rewrite):
  // one a page script fakes stops here.
  shadow.addEventListener('click', (event) => {
    if (!event.isTrusted) {
      event.stopImmediatePropagation()
      event.preventDefault()
    }
  }, true)

  function mountHost() {
    if (!host.isConnected) {
      document.documentElement.appendChild(host)
    }
  }

  // ------------------------------------------------------------ fields

  function editableFrom(target) {
    let el = target instanceof Element ? target : target?.parentElement
    if (!el || host.contains(el)) {
      return null
    }
    if (el instanceof HTMLInputElement && !INPUT_TYPES.has(el.type)) {
      return null
    }
    if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) {
      if (!el.isContentEditable) {
        return null
      }
      while (el.parentElement?.isContentEditable) {
        el = el.parentElement
      }
    }
    const skip = skipReason(el)
    if (skip) {
      if (!told.has(el)) {
        told.add(el)
        console.debug(`[pennvass] skipping this field: ${skip}`, el)
      }
      return null
    }
    accepted.add(el)
    return el
  }

  const accepted = new WeakSet()
  const told = new WeakSet()
  const CODE_EDITORS = '.cm-editor, .CodeMirror, .monaco-editor, .ace_editor'

  /**
   * Why a field is left alone, or '' when it is not. Grammarly's own opt-out
   * (data-gramm="false") is not honoured, so a page can turn Grammarly off in
   * a field and compare this alone.
   */
  function skipReason(el) {
    if (el.closest('[data-pennvass="off"]')) {
      return 'data-pennvass="off"'
    }
    if (el.readOnly || el.disabled) {
      return 'read-only or disabled'
    }
    if (el.closest(CODE_EDITORS)) {
      return 'code editor'
    }
    // spellcheck="false" usually means code. But Grammarly sets it on every
    // field it takes over, before or after we see it, so with Grammarly on the
    // page it says nothing; and a field taken once stays ours.
    if (el.getAttribute('spellcheck') === 'false' && !accepted.has(el) && !grammarlyOnPage()) {
      return 'spellcheck="false"'
    }
    return ''
  }

  /**
   * Grammarly running on the same page puts its badge in the bottom-right
   * corner and its underlines at the baseline, exactly where ours go. When it
   * is there, ours move: underlines a little lower, and in a single-line field
   * the badge left of its pill (in taller fields ours is bottom-left anyway).
   * It also sets spellcheck="false" on the fields it takes over (see skipReason).
   */
  function grammarlyOnPage() {
    return !!document.querySelector('grammarly-extension, grammarly-desktop-integration, grammarly-popups, [data-gramm], [data-gr-ext-installed], [data-new-gr-c-s-check-loaded]')
  }

  const fields = new WeakMap()

  function fieldFor(el) {
    let field = fields.get(el)
    if (!field) {
      field = {
        el,
        isInput: el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement,
        text: '',
        version: 0,
        checked: -1,
        lt: [],
        ai: [],
        ignored: new Set(),
        tone: null,
        offline: false,
        error: '',
        checking: false,
        aiBusy: false,
        aiAgain: false,
        pending: 0,
        checkTimer: 0,
        aiTimer: 0,
      }
      fields.set(el, field)
      field.text = readText(field).text
    }
    return field
  }

  /** The field's text, and for contenteditable where each text node starts in it. */
  function readText(field) {
    if (field.isInput) {
      return { text: field.el.value, segments: [] }
    }
    let text = ''
    const segments = []
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          segments.push({ node: child, start: text.length })
          text += child.data
        }
        else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.tagName === 'BR') {
            text += '\n'
            continue
          }
          const block = BLOCK_TAGS.has(child.tagName)
          if (block && text && !text.endsWith('\n')) {
            text += '\n'
          }
          walk(child)
          if (block && text && !text.endsWith('\n')) {
            text += '\n'
          }
        }
      }
    }
    walk(field.el)
    return { text, segments }
  }

  /** A text offset as a DOM point. Offsets on an inserted newline snap to the next text node. */
  function domPoint(segments, offset, isEnd) {
    for (const { node, start } of segments) {
      const end = start + node.data.length
      if (offset < end || (isEnd && offset === end)) {
        return [node, Math.max(0, offset - start)]
      }
    }
    const last = segments.at(-1)
    return last ? [last.node, last.node.data.length] : null
  }

  function domRange(field, start, end) {
    const { segments } = readText(field)
    const a = domPoint(segments, start, false)
    const b = domPoint(segments, end, true)
    if (!a || !b) {
      return null
    }
    const range = document.createRange()
    range.setStart(a[0], a[1])
    range.setEnd(b[0], b[1])
    return range
  }

  const MIRRORED = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch', 'letterSpacing', 'wordSpacing',
    'lineHeight', 'textTransform', 'textIndent', 'tabSize', 'textAlign', 'direction', 'paddingTop', 'paddingRight', 'paddingBottom',
    'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle', 'wordBreak']

  /** Where characters start..end of a textarea or input are drawn, via a hidden copy with the same box and font. */
  function mirrorRects(field, start, end) {
    const el = field.el
    const style = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    for (const name of MIRRORED) {
      mirror.style[name] = style[name]
    }
    mirror.style.borderColor = 'transparent'
    mirror.style.boxSizing = 'border-box'
    mirror.style.left = `${box.left}px`
    mirror.style.top = `${box.top}px`
    mirror.style.height = `${box.height}px`
    // clientWidth leaves out a scrollbar, which narrows the lines in the real field.
    const scrollbar = el.offsetWidth - el.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)
    mirror.style.width = `${box.width - Math.max(0, scrollbar)}px`
    const isTextarea = el instanceof HTMLTextAreaElement
    mirror.style.whiteSpace = isTextarea ? 'pre-wrap' : 'pre'
    mirror.style.overflowWrap = isTextarea ? 'break-word' : 'normal'
    const text = field.text
    const mark = document.createElement('span')
    mark.textContent = text.slice(start, end)
    // A trailing newline in a textarea starts a line the mirror would otherwise drop.
    mirror.replaceChildren(text.slice(0, start), mark, `${text.slice(end)}​`)
    if (!isTextarea) {
      // A single-line input centres its line vertically.
      mirror.style.lineHeight = `${box.height - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)}px`
    }
    mirror.scrollTop = el.scrollTop
    mirror.scrollLeft = el.scrollLeft
    return [...mark.getClientRects()]
  }

  function issueRects(field, issue) {
    const rects = field.isInput
      ? mirrorRects(field, issue.offset, issue.offset + issue.length)
      : [...(domRange(field, issue.offset, issue.offset + issue.length)?.getClientRects() ?? [])]
    return rects.filter(rect => rect.width > 0)
  }

  // ------------------------------------------------------------ issues

  function keyOf(issue) {
    return `${issue.kind}|${issue.original}|${issue.message}`
  }

  const plainWords = text => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

  /** A sentence rewrite that only makes the fixes already underlined in it says nothing new. */
  function repeatsFixes(rewrite, fixes) {
    let sentence = rewrite.original
    const inside = fixes
      .filter(fix => fix.offset >= rewrite.offset && fix.offset + fix.length <= rewrite.offset + rewrite.length && fix.replacements.length)
      .sort((a, b) => b.offset - a.offset)
    if (!inside.length) {
      return false
    }
    for (const fix of inside) {
      const at = fix.offset - rewrite.offset
      sentence = sentence.slice(0, at) + fix.replacements[0] + sentence.slice(at + fix.length)
    }
    return plainWords(sentence) === plainWords(rewrite.replacements[0])
  }

  function visibleIssues(field) {
    // An underline is only drawn over the text it was found in.
    const current = issue => !field.ignored.has(keyOf(issue)) && field.text.slice(issue.offset, issue.offset + issue.length) === issue.original
    const fixes = field.lt.filter(current)
    const all = [...fixes, ...field.ai.filter(issue => current(issue) && !repeatsFixes(issue, fixes))]
    // A clarity rewrite covers its whole sentence: drawn first, so spelling inside it lands on top.
    return all.sort((a, b) => (b.kind === 'clarity') - (a.kind === 'clarity') || a.offset - b.offset)
  }

  /**
   * After an edit, keeps the underlines that the edit did not touch, moved by
   * however much text it added or removed before them.
   */
  function shiftIssues(issues, before, after) {
    let head = 0
    while (head < before.length && head < after.length && before[head] === after[head]) {
      head++
    }
    let tail = 0
    while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) {
      tail++
    }
    const editEnd = before.length - tail
    const delta = after.length - before.length
    return issues.flatMap((issue) => {
      if (issue.offset + issue.length <= head) {
        return [issue]
      }
      if (issue.offset >= editEnd) {
        return [{ ...issue, offset: issue.offset + delta }]
      }
      return []
    })
  }

  function withOriginal(text, issues) {
    return issues.map(issue => ({ ...issue, original: text.slice(issue.offset, issue.offset + issue.length) }))
  }

  // ------------------------------------------------------------ requests

  function schedule(field) {
    clearTimeout(field.checkTimer)
    clearTimeout(field.aiTimer)
    field.checkTimer = setTimeout(() => runCheck(field), CHECK_DELAY)
    field.aiTimer = setTimeout(() => runAi(field), AI_DELAY)
  }

  function tooLong(field) {
    return !field.text.trim() || field.text.length > MAX_TEXT
  }

  async function runCheck(field) {
    const version = field.version
    if (tooLong(field)) {
      field.lt = []
      render()
      return
    }
    field.checking = true
    render()
    const text = field.text
    const result = await api('check', { text })
    field.checking = false
    field.offline = !result.ok && !!result.offline
    field.error = result.ok ? '' : result.error
    // my-agent restarting (a rebuild takes a few seconds) should not leave the badge
    // grey until you type again: try again in 5 s while this field is focused.
    if (field.offline) {
      clearTimeout(field.checkTimer)
      field.checkTimer = setTimeout(() => field === active && runCheck(field).then(() => !field.offline && runAi(field)), 5000)
    }
    if (version !== field.version) {
      return
    }
    field.checked = version
    if (result.ok) {
      field.lt = withOriginal(text, result.data.issues)
    }
    render()
  }

  async function runAi(field) {
    if (field.aiBusy) {
      field.aiAgain = true
      return
    }
    if (tooLong(field)) {
      field.ai = []
      return
    }
    field.aiBusy = true
    field.aiAgain = false
    render()
    const version = field.version
    const text = field.text
    if (settings.tone && text.trim().length >= MIN_TONE_TEXT) {
      const result = await api('tone', { text })
      if (result.ok) {
        field.tone = result.data
      }
    }
    if (settings.improve) {
      // Each call reads at most three new sentences; keep going while the text stands still.
      for (;;) {
        const result = await api('improve', { text })
        if (!result.ok || version !== field.version) {
          break
        }
        field.ai = withOriginal(text, result.data.issues)
        field.pending = result.data.pending
        render()
        if (!result.data.pending) {
          break
        }
      }
    }
    field.aiBusy = false
    field.pending = 0
    render()
    if (field.aiAgain || version !== field.version) {
      runAi(field)
    }
  }

  // ------------------------------------------------------------ applying text

  /** Replaces start..end of the field with `replacement`, as if typed, if that text is still `expected`. */
  function replaceText(field, start, end, expected, replacement) {
    const current = readText(field).text
    if (current.slice(start, end) !== expected) {
      return false
    }
    const el = field.el
    el.focus()
    if (field.isInput) {
      el.setSelectionRange(start, end)
      if (!document.execCommand('insertText', false, replacement)) {
        el.setRangeText(replacement, start, end, 'end')
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: replacement }))
      }
    }
    else {
      const range = domRange(field, start, end)
      if (!range) {
        return false
      }
      const selection = getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      document.execCommand('insertText', false, replacement)
    }
    return true
  }

  function selectionIn(field) {
    if (field.isInput) {
      const { selectionStart: start, selectionEnd: end } = field.el
      return start !== end ? { start, end } : null
    }
    const selection = getSelection()
    if (!selection.rangeCount || selection.isCollapsed) {
      return null
    }
    const range = selection.getRangeAt(0)
    if (!field.el.contains(range.startContainer) || !field.el.contains(range.endContainer)) {
      return null
    }
    // Offsets of the selection's ends in readText's text.
    const { text, segments } = readText(field)
    const offsetOf = (container, offset) => {
      const segment = segments.find(s => s.node === container)
      if (segment) {
        return segment.start + offset
      }
      // A point between elements: it sits just before the first text node that starts after it.
      const point = document.createRange()
      point.setStart(container, offset)
      const next = segments.find(s => point.comparePoint(s.node, 0) > 0)
      return next ? next.start : text.length
    }
    const start = offsetOf(range.startContainer, range.startOffset)
    const end = offsetOf(range.endContainer, range.endOffset)
    return end > start ? { start, end } : null
  }

  // ------------------------------------------------------------ drawing

  let active = null
  let drawn = []
  let card = null
  let frame = 0

  function setActive(el) {
    const next = el && settings.enabled ? fieldFor(el) : null
    if (next === active) {
      return
    }
    active = next
    closeCard()
    if (active) {
      mountHost()
      // Text changed while the field was not focused is checked now.
      if (!syncText(active) && active.checked !== active.version) {
        schedule(active)
      }
    }
    render()
  }

  /**
   * The one place a field's text change is noticed: typed, pasted, set by the
   * page, or swapped while the field was not focused. Underlines the change
   * did not touch move with the text; the rest go until the next check.
   * Only the focused field is checked right away; another one is checked when
   * it is focused, so a page filling four fields does not queue four checks.
   */
  function syncText(field) {
    const before = field.text
    const after = readText(field).text
    if (after === before) {
      return false
    }
    field.text = after
    field.version++
    field.lt = shiftIssues(field.lt, before, after)
    field.ai = shiftIssues(field.ai, before, after)
    if (field === active) {
      closeCard()
      schedule(field)
      render()
    }
    return true
  }

  function render() {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(draw)
  }

  function draw() {
    linesLayer.replaceChildren()
    drawn = []
    if (!active || !active.el.isConnected) {
      uiLayer.querySelector('.badge')?.remove()
      return
    }
    const field = active
    const box = field.el.getBoundingClientRect()
    if (!box.width || !box.height) {
      return
    }
    const shared = grammarlyOnPage()
    // Underlines scrolled out of the field are not drawn.
    const clip = { left: box.left, right: box.right, top: box.top, bottom: box.bottom + 2 }
    for (const issue of visibleIssues(field)) {
      for (const rect of issueRects(field, issue)) {
        // Clarity sits a little lower, so a spelling line in the same sentence stays visible.
        const top = rect.bottom - 1 + (issue.kind === 'clarity' ? 3 : 0) + (shared ? 3 : 0)
        if (top < clip.top || top > clip.bottom || rect.right < clip.left || rect.left > clip.right) {
          continue
        }
        const left = Math.max(rect.left, clip.left)
        const width = Math.min(rect.right, clip.right) - left
        const line = document.createElement('div')
        line.className = `line ${issue.kind}`
        line.style.cssText = `left:${left}px;top:${top}px;width:${width}px;background:${COLORS[issue.kind]};`
        linesLayer.appendChild(line)
        drawn.push({ issue, rect })
      }
    }
    drawBadge(field, box, shared)
  }

  function drawBadge(field, box, shared) {
    let badge = uiLayer.querySelector('.badge')
    if (!badge) {
      badge = document.createElement('button')
      badge.className = 'ui badge'
      badge.addEventListener('click', () => openMenu())
      uiLayer.appendChild(badge)
    }
    const count = visibleIssues(field).length
    const busy = field.checking || field.aiBusy
    badge.className = `ui badge${field.offline ? ' offline' : busy ? ' busy' : count ? ' issues' : ''}`
    badge.textContent = field.offline ? '!' : busy && !count ? '…' : count ? String(count) : '✓'
    badge.title = field.offline ? 'Pennvass: my-agent is not running on 127.0.0.1:8787' : `Pennvass: ${count} suggestion${count === 1 ? '' : 's'}`
    const size = badge.getBoundingClientRect()
    const right = Math.min(box.right, innerWidth)
    const bottom = Math.min(box.bottom, innerHeight)
    if (box.height < 60) {
      // A single-line field: bottom-left would sit on its first word, so the
      // badge goes at the end of the line, left of Grammarly's pill if it is there.
      badge.style.left = `${right - size.width - (shared ? 74 : 6)}px`
      badge.style.top = `${(box.top + bottom) / 2 - size.height / 2}px`
    }
    else {
      // Bottom-left corner: clear of Grammarly's pill and of the resize handle.
      badge.style.left = `${Math.max(box.left, 0) + 8}px`
      badge.style.top = `${bottom - size.height - 8}px`
    }
  }

  // ------------------------------------------------------------ cards

  function closeCard() {
    card?.remove()
    card = null
  }

  function showCard(anchor, build) {
    closeCard()
    card = document.createElement('div')
    card.className = 'ui card'
    build(card)
    uiLayer.appendChild(card)
    const size = card.getBoundingClientRect()
    const below = anchor.bottom + 6
    const top = below + size.height > innerHeight - 8 ? Math.max(8, anchor.top - size.height - 6) : below
    card.style.top = `${top}px`
    card.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - size.width - 8))}px`
  }

  function el(tag, className, text) {
    const node = document.createElement(tag)
    if (className) {
      node.className = className
    }
    if (text !== undefined) {
      node.textContent = text
    }
    return node
  }

  /** Old and new sentence as one line: removed words struck through, added ones green. */
  function wordDiff(before, after) {
    const a = before.split(/(\s+)/)
    const b = after.split(/(\s+)/)
    // Longest common subsequence of tokens, walked back into a list of kept/removed/added.
    const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
      }
    }
    const box = el('div', 'diff')
    let i = 0
    let j = 0
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        box.append(a[i++])
        j++
      }
      else if (j < b.length && (i >= a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
        box.append(/^\s+$/.test(b[j]) ? b[j++] : el('ins', '', b[j++]))
      }
      else {
        // Whitespace from both sides is kept: the box collapses runs of it, and words stay apart.
        box.append(/^\s+$/.test(a[i]) ? a[i++] : el('del', '', a[i++]))
      }
    }
    return box
  }

  function applyIssue(field, issue, replacement) {
    return replaceText(field, issue.offset, issue.offset + issue.length, issue.original, replacement)
  }

  /** One row of the menu's list: what is wrong, and what clicking it does. */
  function issueRow(field, issue, anchor) {
    const row = el('div', 'item')
    const main = el('button', 'pick')
    const dot = el('span', 'dot')
    dot.style.background = COLORS[issue.kind]
    const what = el('span', 'what')
    if (issue.kind === 'clarity') {
      what.append(el('b', '', 'Rewrite sentence'), el('span', 'muted', ` · ${issue.message}`))
      // Too long to apply blind: the row opens the card with its diff.
      main.addEventListener('click', () => openIssue(issue, anchor))
    }
    else {
      what.append(el('del', '', issue.original), issue.replacements.length ? ' → ' : '', el('ins', '', issue.replacements[0] ?? ''),
        el('span', 'muted', ` · ${KIND_LABEL[issue.kind]}`))
      main.title = issue.message
      main.addEventListener('click', () => {
        if (!issue.replacements.length) {
          openIssue(issue, anchor)
          return
        }
        applyIssue(field, issue, issue.replacements[0])
        openMenu()
      })
    }
    main.append(dot, what)
    const ignore = el('button', 'x', '×')
    ignore.title = 'Ignore'
    ignore.addEventListener('click', () => {
      field.ignored.add(keyOf(issue))
      render()
      openMenu()
    })
    row.append(main, ignore)
    return row
  }

  function openIssue(issue, rect) {
    const field = active
    showCard(rect, (box) => {
      const kind = el('div', 'kind')
      const dot = el('span', 'dot')
      dot.style.background = COLORS[issue.kind]
      kind.append(dot, `${KIND_LABEL[issue.kind]}${issue.source === 'ollama' ? ' · local AI' : ''}`)
      box.append(kind, el('div', 'msg', issue.message))
      if (issue.kind === 'clarity') {
        box.appendChild(wordDiff(issue.original, issue.replacements[0]))
      }
      if (issue.replacements.length) {
        const reps = el('div', 'reps')
        for (const replacement of issue.replacements.slice(0, 3)) {
          const button = el('button', 'rep', issue.kind === 'clarity' ? 'Use this sentence' : replacement || '(remove)')
          button.addEventListener('click', () => {
            closeCard()
            if (!applyIssue(field, issue, replacement)) {
              showCard(rect, b => b.append(el('div', 'msg err', 'The text changed under this suggestion. It will be checked again.')))
            }
          })
          reps.appendChild(button)
        }
        box.appendChild(reps)
      }
      const ignore = el('button', 'link', 'Ignore')
      ignore.addEventListener('click', () => {
        field.ignored.add(keyOf(issue))
        closeCard()
        render()
      })
      box.appendChild(ignore)
    })
  }

  function openMenu() {
    const field = active
    if (!field) {
      return
    }
    const anchor = uiLayer.querySelector('.badge').getBoundingClientRect()
    const selection = selectionIn(field)
    showCard(anchor, (box) => {
      const head = el('div', 'row')
      head.append(el('strong', '', 'Pennvass'))
      if (field.tone) {
        const share = Math.round((field.tone.probabilities[field.tone.tone] ?? 0) * 100)
        const tone = el('span', 'muted', `${TONE_LABEL[field.tone.tone]} ${share}%`)
        tone.title = Object.entries(field.tone.probabilities).map(([name, p]) => `${name} ${Math.round(p * 100)}%`).join('\n')
        head.appendChild(tone)
      }
      box.appendChild(head)
      const status = field.offline
        ? 'my-agent is not running. Start it: docker compose up -d in ~/projects/my-agent'
        : field.error
          ? field.error
          : field.aiBusy
            ? `Local AI is reading${field.pending ? ` (${field.pending} sentences left)` : ''}…`
            : `${visibleIssues(field).length} suggestions`
      box.appendChild(el('div', field.offline || field.error ? 'muted err' : 'muted', status))
      const issues = visibleIssues(field).sort((a, b) => a.offset - b.offset)
      if (issues.length) {
        const list = el('div', 'list')
        for (const issue of issues) {
          list.appendChild(issueRow(field, issue, anchor))
        }
        box.appendChild(list)
      }
      box.appendChild(el('div', 'muted', selection ? 'Rewrite the selection with Claude:' : 'Rewrite all of it with Claude:'))
      const styles = el('div', 'styles')
      for (const [style, label] of STYLES) {
        const button = el('button', 'style', label)
        button.addEventListener('click', () => runRewrite(field, style, label, selection, anchor))
        styles.appendChild(button)
      }
      box.appendChild(styles)
      const off = el('button', 'link', `Turn off on ${location.hostname}`)
      off.addEventListener('click', async () => {
        const { disabledHosts } = await chrome.storage.local.get({ disabledHosts: [] })
        await chrome.storage.local.set({ disabledHosts: [...new Set([...disabledHosts, location.hostname])] })
        closeCard()
      })
      box.appendChild(off)
    })
  }

  async function runRewrite(field, style, label, selection, anchor) {
    const text = readText(field).text
    const start = selection?.start ?? 0
    const end = selection?.end ?? text.replace(/\s+$/, '').length
    const original = text.slice(start, end)
    if (!original.trim()) {
      return
    }
    showCard(anchor, box => box.append(el('div', 'kind', `${label} · Claude`), el('div', 'muted', 'Claude is rewriting, usually 5–30 seconds…')))
    const waiting = card
    const keepalive = setInterval(() => chrome.runtime.sendMessage({ type: 'keepalive' }).catch(() => {}), 20_000)
    const result = await api('rewrite', { text: original, style })
    clearInterval(keepalive)
    if (card !== waiting) {
      return
    }
    showCard(anchor, (box) => {
      box.appendChild(el('div', 'kind', `${label} · Claude`))
      if (!result.ok) {
        box.appendChild(el('div', 'msg err', result.error))
        return
      }
      box.appendChild(el('div', 'result', result.data.text))
      const replace = el('button', 'rep', 'Replace')
      replace.addEventListener('click', async () => {
        closeCard()
        if (!replaceText(field, start, end, original, result.data.text)) {
          await navigator.clipboard.writeText(result.data.text)
          showCard(anchor, b => b.append(el('div', 'msg', 'The text changed while Claude worked, so the rewrite was copied to the clipboard instead.')))
        }
      })
      const copy = el('button', 'link', 'Copy')
      copy.addEventListener('click', async () => {
        await navigator.clipboard.writeText(result.data.text)
        closeCard()
      })
      const cancel = el('button', 'link', 'Cancel')
      cancel.addEventListener('click', closeCard)
      const row = el('div', 'reps')
      row.append(replace)
      box.append(row, copy, cancel)
    })
  }

  // ------------------------------------------------------------ events

  function targetOf(event) {
    return event.composedPath?.()[0] ?? event.target
  }

  document.addEventListener('focusin', (event) => {
    if (host.contains(event.target)) {
      return
    }
    setActive(editableFrom(targetOf(event)))
  }, true)

  /** The editable field that has focus, looking inside shadow roots. */
  function focusedEditable() {
    let focused = document.activeElement
    while (focused?.shadowRoot?.activeElement) {
      focused = focused.shadowRoot.activeElement
    }
    return editableFrom(focused)
  }

  // Clicking somewhere that takes no focus fires no focusin; the field is still left.
  // Switching to another window fires focusout too, but the field keeps focus
  // for when you come back, so a page without focus changes nothing.
  document.addEventListener('focusout', () => setTimeout(() => {
    if (!document.hasFocus()) {
      return
    }
    if (active && !card && focusedEditable() !== active.el) {
      setActive(null)
    }
  }), true)

  addEventListener('focus', () => {
    const el = focusedEditable()
    if (el) {
      setActive(el)
    }
  })

  document.addEventListener('input', (event) => {
    const el = editableFrom(targetOf(event))
    if (!el || !settings.enabled) {
      return
    }
    // Typing in the focused field makes it the active one, whatever focus events were missed.
    if (fieldFor(el) !== active && focusedEditable() === el) {
      setActive(el)
    }
    else {
      syncText(fieldFor(el))
    }
  }, true)

  // Some pages set a field's text without an input event (a sent message
  // clearing the box, a framework resetting it). Caught within a second.
  // The same tick heals a lost active field: focus is in one, but nothing is drawn for it.
  setInterval(() => {
    if (active?.el.isConnected) {
      syncText(active)
    }
    else if (settings.enabled && document.hasFocus()) {
      const el = focusedEditable()
      if (el) {
        setActive(el)
      }
    }
  }, 1000)

  // The underlines take no clicks, so the field gets every one; a click that
  // lands on an underline then opens its card.
  document.addEventListener('click', (event) => {
    if (!active || host.contains(event.target)) {
      return
    }
    // Searched last-drawn first: a word's own underline wins over its sentence's.
    const hit = drawn.findLast(({ rect }) => event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom + 3)
    if (hit && editableFrom(targetOf(event)) === active.el) {
      openIssue(hit.issue, hit.rect)
    }
    else {
      closeCard()
    }
  }, true)

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && card) {
      closeCard()
    }
  }, true)

  addEventListener('scroll', render, true)
  addEventListener('resize', render)
  new ResizeObserver(render).observe(document.documentElement)
})()
