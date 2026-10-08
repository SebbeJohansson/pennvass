// The writing checks themselves, shared by both backends: Pennvass's direct
// mode (background.js calls the engines) and my-agent's /v1/write/* routes,
// which import this file from a pennvass checkout next to it. Plain ES module,
// no Node or Chrome APIs, so it runs in both. Types: write-core.d.ts.
//
// Each engine does the one thing it was measured doing well:
//
// | Check   | Engine              | Speed            | What it gives                                       |
// |---------|---------------------|------------------|-----------------------------------------------------|
// | check   | LanguageTool        | ~100 ms          | spelling and grammar, with exact offsets            |
// | tone    | Laya                | ~0.3 s           | formal / friendly / casual / confident / frustrated |
// | improve | Ollama (qwen2.5:7b) | 1.5-8 s/sentence | a clearer version of a sentence, or nothing         |
//
// Laya is not asked whether a sentence is well written: untrained, it scored
// "Me and him goes to store yesterday" as fine and caught one bad sentence in
// four. qwen2.5:7b, asked the same thing with a schema, fixed both bad
// sentences in its test and left the good one alone, so it reads every
// sentence itself, slowly, behind a cache.
//
// Offsets are UTF-16 code units, as in JavaScript strings. LanguageTool is
// Java and counts the same way, so its offsets pass through unchanged.

/** A page's whole textbox, not a book. LanguageTool's own default limit is 20k characters. */
export const MAX_TEXT = 20_000

// ---------------------------------------------------------------- check

/** LanguageTool's issue types, folded into the four underline colours. */
export function kindOf(match) {
  const type = match.rule?.issueType
  if (type === 'misspelling') {
    return 'spelling'
  }
  if (type === 'style' || type === 'locale-violation' || type === 'register' || match.rule?.category?.id === 'STYLE') {
    return 'style'
  }
  return 'grammar'
}

export function readLanguageTool(body) {
  const issues = []
  for (const match of body?.matches ?? []) {
    if (typeof match.offset !== 'number' || typeof match.length !== 'number' || !match.message) {
      continue
    }
    issues.push({
      offset: match.offset,
      length: match.length,
      message: match.message,
      // A long list is noise in a card; LanguageTool puts the likeliest first.
      replacements: (match.replacements ?? []).map(r => r.value ?? '').filter(Boolean).slice(0, 5),
      kind: kindOf(match),
      source: 'languagetool',
      ...(match.rule?.id ? { rule: match.rule.id } : {}),
    })
  }
  return { language: body?.language?.detectedLanguage?.code ?? body?.language?.code ?? 'auto', issues }
}

export async function check(text, { languagetoolUrl, englishVariant = 'en-US' }) {
  const response = await fetch(`${languagetoolUrl}/v2/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ text, language: 'auto', preferredVariants: englishVariant }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`languagetool answered ${response.status}: ${(await response.text()).slice(0, 200)}`)
  }
  return readLanguageTool(await response.json())
}

// ---------------------------------------------------------------- tone

export const TONES = {
  formal: 'polite and professional',
  friendly: 'warm and kind',
  casual: 'relaxed and informal',
  confident: 'direct and sure of itself',
  frustrated: 'annoyed or impatient',
}

/** Tone is about the message as a whole; its last 1500 characters are what the reader is left with. */
const TONE_WINDOW = 1500

export async function tone(text, { layaUrl, layaKey }) {
  const response = await fetch(`${layaUrl}/v1/systemone`, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${layaKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      state: `Text: ${text.slice(-TONE_WINDOW)}`,
      questions: { tone: { type: 'choice', instructions: 'What is the tone of the text?', criteria: TONES } },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`laya answered ${response.status}`)
  }
  const answer = (await response.json()).answers?.tone
  if (!answer?.choice || !(answer.choice in TONES)) {
    throw new Error('laya answered without a tone')
  }
  return { tone: answer.choice, probabilities: answer.probabilities ?? {} }
}

// ---------------------------------------------------------------- improve

/** Sentences with their offsets, surrounding whitespace trimmed off. */
export function sentences(text) {
  const out = []
  for (const { segment, index } of new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)) {
    const lead = segment.length - segment.trimStart().length
    const trimmed = segment.trim()
    if (trimmed) {
      out.push({ offset: index + lead, text: trimmed })
    }
  }
  return out
}

/** Short sentences are LanguageTool's job; very long ones are usually pasted, not written. */
export function worthImproving(sentence) {
  const words = sentence.split(/\s+/).filter(Boolean).length
  return words >= 6 && sentence.length <= 400
}

// Asked "is this clear?", qwen2.5:7b called the wordy test sentence ("I just
// wanted to quickly reach out in order to let you know that at this point in
// time...") fine. Made to name the problems first, it caught it, and Swedish
// "se dem" for "se den" too. The "not problems" line took its false alarms on
// eight test sentences from three to one; `onlySpellingVariants` drops that one.
export const IMPROVE_SYSTEM = `You are a strict copy editor. Read one sentence and list its concrete problems: grammar or spelling errors, wrong word forms, filler words (just, basically, actually, really), wordy phrases ("in order to", "at this point in time", "due to the fact that"), needless passive voice, or confusing word order.
If there are no problems, answer {"problems":[],"better":""}.
Otherwise answer problems = short names of each problem, and better = the sentence fixed, in the same language and tone, keeping every name, number and fact. Do not add new content. Do not change a sentence only for taste.
Not problems: commas versus semicolons, contractions, British versus American spelling, informal but correct wording. A short, correct sentence has no problems.
Use only real words of the sentence's language.`

export const IMPROVE_FORMAT = {
  type: 'object',
  properties: { problems: { type: 'array', items: { type: 'string' } }, better: { type: 'string' } },
  required: ['problems', 'better'],
}

/** Words compared without case, punctuation, contractions or British/American spelling. */
function comparable(sentence) {
  return sentence.toLowerCase()
    .replace(/n['’]t\b/g, ' not').replace(/['’]ll\b/g, ' will').replace(/['’]re\b/g, ' are').replace(/['’]ve\b/g, ' have').replace(/\bi['’]m\b/g, 'i am')
    .replace(/\bcan not\b/g, 'cannot').replace(/\bca not\b/g, 'cannot').replace(/\bwo not\b/g, 'will not')
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    .map(word => word.replace(/(\p{L})\1/gu, '$1').replace(/our\b/, 'or').replace(/is(e|ed|ing|ation)\b/, 'iz$1').replace(/tre\b/, 'ter'))
    .join(' ')
}

/** True when `better` only differs from `sentence` in ways the prompt says are not problems. */
export function onlySpellingVariants(sentence, better) {
  return comparable(sentence) === comparable(better)
}

/** "needless_passive_voice" → "Needless passive voice", joined: the card's one line on what is wrong. */
export function describeProblems(problems) {
  const names = Array.isArray(problems)
    ? [...new Set(problems.filter(p => typeof p === 'string').map(p => p.replace(/[_-]+/g, ' ').trim().toLowerCase()).filter(Boolean))]
    : []
  const line = names.join(', ')
  return line ? line[0].toUpperCase() + line.slice(1) : 'Clearer wording'
}

/** The model's reply as a suggestion, or null when it has none worth showing. */
export function readSuggestion(sentence, reply) {
  let parsed
  try {
    parsed = JSON.parse(reply)
  }
  catch {
    return null
  }
  const better = typeof parsed?.better === 'string' ? parsed.better.trim() : ''
  if (!better || (Array.isArray(parsed.problems) && !parsed.problems.length) || onlySpellingVariants(sentence, better)) {
    return null
  }
  // Seen once, in Swedish: a made-up "att_meet_up". Real sentences have no underscores.
  if (/_/.test(better) && !/_/.test(sentence)) {
    return null
  }
  return { better, reason: describeProblems(parsed.problems) }
}

/** Sentences the model reads per request. The rest come back as `pending`, for the next call. */
export const IMPROVE_PER_CALL = 3

/**
 * Clearer versions of the text's sentences. `complete` sends one sentence to
 * the model and returns its JSON reply; `cache` remembers each sentence's
 * answer (null: it was fine) and may be async, as chrome.storage is.
 */
export async function improve(text, { complete, cache }) {
  const issues = []
  let read = 0
  let pending = 0
  for (const sentence of sentences(text).filter(s => worthImproving(s.text))) {
    let suggestion = await cache.get(sentence.text)
    if (suggestion === undefined) {
      if (read >= IMPROVE_PER_CALL) {
        pending++
        continue
      }
      read++
      suggestion = readSuggestion(sentence.text, await complete(IMPROVE_SYSTEM, sentence.text))
      await cache.set(sentence.text, suggestion)
    }
    if (suggestion) {
      issues.push({
        offset: sentence.offset,
        length: sentence.text.length,
        message: suggestion.reason,
        replacements: [suggestion.better],
        kind: 'clarity',
        source: 'ollama',
      })
    }
  }
  return { issues, pending }
}

/** One sentence to Ollama's chat API with the improve prompt's schema; its JSON reply back. */
export function ollamaComplete({ ollamaUrl, model, timeoutMs = 60_000 }) {
  return async (system, sentence) => {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: 'system', content: system }, { role: 'user', content: sentence }],
        format: IMPROVE_FORMAT,
        think: false,
        keep_alive: '60m',
        options: { temperature: 0, top_p: 1, num_predict: 200 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      throw new Error(`ollama answered ${response.status}: ${(await response.text()).slice(0, 200)}`)
    }
    const content = (await response.json()).message?.content
    if (typeof content !== 'string') {
      throw new Error('ollama answered without message.content')
    }
    return content
  }
}

// ---------------------------------------------------------------- rewrite

/** What each rewrite button asks for. The rewrite itself is the backend's: it needs a model with no tools. */
export const STYLES = {
  clearer: 'clearer and easier to read',
  shorter: 'noticeably shorter, keeping every point',
  formal: 'more formal and professional',
  friendly: 'warmer and friendlier',
  confident: 'more direct and confident',
  english: 'in English',
  swedish: 'in Swedish',
}

export const REWRITE_SYSTEM = 'You rewrite text for the person. Reply with the rewritten text only: no preamble, no quotes, no explanation, no markdown fences. '
  + 'Keep the meaning, every fact, name, number and link, and the paragraph breaks. Do not use any tools.'

export function rewritePrompt(text, style) {
  return `Rewrite this to be ${STYLES[style]}:\n\n${text}`
}
