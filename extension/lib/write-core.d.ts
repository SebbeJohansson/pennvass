// Types for write-core.js, for my-agent's TypeScript. The extension itself does not read this file.

export const MAX_TEXT: number

export interface Issue {
  offset: number
  length: number
  message: string
  replacements: string[]
  kind: 'spelling' | 'grammar' | 'style' | 'clarity'
  source: 'languagetool' | 'ollama'
  rule?: string
}

export interface LanguageToolMatch {
  message?: string
  shortMessage?: string
  offset?: number
  length?: number
  replacements?: { value?: string }[]
  rule?: { id?: string, issueType?: string, category?: { id?: string } }
}

export function kindOf(match: LanguageToolMatch): Issue['kind']
export function readLanguageTool(body: unknown): { language: string, issues: Issue[] }
export function check(text: string, deps: { languagetoolUrl: string, englishVariant?: string }): Promise<{ language: string, issues: Issue[] }>

export const TONES: Record<'formal' | 'friendly' | 'casual' | 'confident' | 'frustrated', string>
export type Tone = keyof typeof TONES
export function tone(text: string, deps: { layaUrl: string, layaKey: string }): Promise<{ tone: Tone, probabilities: Record<Tone, number> }>

export interface Sentence {
  offset: number
  text: string
}

export interface Suggestion {
  better: string
  reason: string
}

/** Sync (a Map) or async (chrome.storage); undefined means not asked yet, null means the sentence was fine. */
export interface SuggestionStore {
  get(sentence: string): Suggestion | null | undefined | Promise<Suggestion | null | undefined>
  set(sentence: string, suggestion: Suggestion | null): void | Promise<void>
}

export function sentences(text: string): Sentence[]
export function worthImproving(sentence: string): boolean
export const IMPROVE_SYSTEM: string
export const IMPROVE_FORMAT: Record<string, unknown>
export function onlySpellingVariants(sentence: string, better: string): boolean
export function describeProblems(problems: unknown): string
export function readSuggestion(sentence: string, reply: string): Suggestion | null
export const IMPROVE_PER_CALL: number
export function improve(text: string, deps: {
  complete: (system: string, sentence: string) => Promise<string>
  cache: SuggestionStore
}): Promise<{ issues: Issue[], pending: number }>
export function ollamaComplete(deps: { ollamaUrl: string, model: string, timeoutMs?: number }): (system: string, sentence: string) => Promise<string>

export const STYLES: Record<'clearer' | 'shorter' | 'formal' | 'friendly' | 'confident' | 'english' | 'swedish', string>
export type Style = keyof typeof STYLES
export const REWRITE_SYSTEM: string
export function rewritePrompt(text: string, style: Style): string
