/**
 * CodeBlock — syntax-highlighted code blocks with Shiki.
 * Features: async highlighting, header with language icon + copy buttons,
 * long code collapse/expand, terminal-style for shell languages.
 */

import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BundledLanguage, BundledTheme, HighlighterGeneric, ThemedToken } from 'shiki'
import { bundledLanguages, createHighlighter } from 'shiki'
import type { Icon } from '@phosphor-icons/react'
import {
  Check,
  Copy,
  CaretDown,
  CaretUp,
  FileCode,
  Terminal,
  Code,
  File,
  Hash,
} from '@phosphor-icons/react'
import { cn } from '../../lib/utils'

// ── Constants ──────────────────────────────────────────────────────────

const COLLAPSE_THRESHOLD = 20
const VISIBLE_LINES = 10
const LIGHT_THEME: BundledTheme = 'github-light'
const DARK_THEME: BundledTheme = 'github-dark'

const TERMINAL_LANGUAGES = new Set(['bash', 'sh', 'shell', 'terminal', 'zsh', 'console'])

// ── Language icon mapping ──────────────────────────────────────────────

function getLanguageIcon(language: string): Icon {
  const lower = language.toLowerCase()
  if (TERMINAL_LANGUAGES.has(lower)) return Terminal
  if (['typescript', 'tsx', 'javascript', 'jsx'].includes(lower)) return Code
  if (['json', 'yaml', 'yml', 'toml', 'xml'].includes(lower)) return Code
  if (['python', 'ruby', 'go', 'rust', 'java', 'c', 'cpp'].includes(lower)) return Hash
  if (['css', 'scss', 'html'].includes(lower)) return File
  return FileCode
}

// ── Shiki highlighter cache ────────────────────────────────────────────

interface TokenizedCode {
  tokens: ThemedToken[][]
  fg: string
  bg: string
}

type Highlighter = HighlighterGeneric<BundledLanguage, BundledTheme>

const highlighterCache = new Map<string, Promise<Highlighter>>()
const tokensCache = new Map<string, TokenizedCode>()
const subscribers = new Map<string, Set<(result: TokenizedCode) => void>>()

const isBundledLanguage = (lang: string): lang is BundledLanguage =>
  lang in bundledLanguages || lang === 'text' || lang === 'plaintext'

function getTokensCacheKey(code: string, language: string): string {
  const start = code.slice(0, 100)
  const end = code.length > 100 ? code.slice(-100) : ''
  return `${language}:${code.length}:${start}:${end}`
}

function getHighlighter(language: BundledLanguage): Promise<Highlighter> {
  const safeLang = isBundledLanguage(language) ? language : ('text' as BundledLanguage)
  const cacheKey = `${safeLang}:${LIGHT_THEME}:${DARK_THEME}`

  const cached = highlighterCache.get(cacheKey)
  if (cached) return cached

  const promise: Promise<Highlighter> = createHighlighter({
    langs: [safeLang],
    themes: [LIGHT_THEME, DARK_THEME],
  }).catch(() => {
    highlighterCache.delete(cacheKey)
    return getHighlighter('text' as BundledLanguage)
  })

  highlighterCache.set(cacheKey, promise)
  return promise
}

function createRawTokens(code: string): TokenizedCode {
  return {
    bg: 'transparent',
    fg: 'inherit',
    tokens: code
      .split('\n')
      .map((line) => (line === '' ? [] : [{ color: 'inherit', content: line } as ThemedToken])),
  }
}

function highlightCode(
  code: string,
  language: BundledLanguage,
  callback?: (result: TokenizedCode) => void,
): TokenizedCode | null {
  const cacheKey = getTokensCacheKey(code, language)

  const cached = tokensCache.get(cacheKey)
  if (cached) return cached

  if (callback) {
    if (!subscribers.has(cacheKey)) subscribers.set(cacheKey, new Set())
    subscribers.get(cacheKey)?.add(callback)
  }

  getHighlighter(language)
    .then((highlighter) => {
      const langs = highlighter.getLoadedLanguages()
      const lang = langs.includes(language) ? language : 'text'

      const result = highlighter.codeToTokens(code, {
        lang,
        themes: { dark: DARK_THEME, light: LIGHT_THEME },
      })

      const tokenized: TokenizedCode = {
        bg: result.bg ?? 'transparent',
        fg: result.fg ?? 'inherit',
        tokens: result.tokens,
      }

      tokensCache.set(cacheKey, tokenized)

      const subs = subscribers.get(cacheKey)
      if (subs) {
        for (const sub of subs) sub(tokenized)
        subscribers.delete(cacheKey)
      }
    })
    .catch(() => {
      subscribers.delete(cacheKey)
    })

  return null
}

// ── Shiki font style helpers ───────────────────────────────────────────

// Shiki bitflags: 1=italic, 2=bold, 4=underline
const isItalic = (fs: number | undefined) => fs && fs & 1
const isBold = (fs: number | undefined) => fs && fs & 2
const isUnderline = (fs: number | undefined) => fs && fs & 4

// ── Token rendering ────────────────────────────────────────────────────

function TokenSpan({ token }: { token: ThemedToken }) {
  return (
    <span
      className="dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)]"
      style={{
        backgroundColor: token.bgColor,
        color: token.color,
        fontStyle: isItalic(token.fontStyle) ? 'italic' : undefined,
        fontWeight: isBold(token.fontStyle) ? 'bold' : undefined,
        textDecoration: isUnderline(token.fontStyle) ? 'underline' : undefined,
        ...token.htmlStyle,
      }}
    >
      {token.content}
    </span>
  )
}

const LINE_NUMBER_CLASSES = cn(
  'block',
  'before:content-[counter(line)]',
  'before:inline-block',
  'before:[counter-increment:line]',
  'before:w-8',
  'before:mr-4',
  'before:text-right',
  'before:text-muted-foreground/50',
  'before:font-mono',
  'before:select-none',
)

// ── Code body ──────────────────────────────────────────────────────────

const CodeBlockBody = memo(function CodeBlockBody({
  tokenized,
  showLineNumbers,
}: {
  tokenized: TokenizedCode
  showLineNumbers: boolean
}) {
  return (
    <pre
      className="dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)] m-0 p-4 text-sm"
      style={{ backgroundColor: tokenized.bg, color: tokenized.fg }}
    >
      <code
        className={cn(
          'font-mono text-sm',
          showLineNumbers && '[counter-increment:line_0] [counter-reset:line]',
        )}
      >
        {tokenized.tokens.map((line, i) => (
          <span key={i} className={showLineNumbers ? LINE_NUMBER_CLASSES : 'block'}>
            {line.length === 0 ? '\n' : line.map((token, j) => <TokenSpan key={j} token={token} />)}
          </span>
        ))}
      </code>
    </pre>
  )
})

// ── CodeBlock content (with collapse) ──────────────────────────────────

function CodeBlockContent({
  code,
  language,
  showLineNumbers = false,
}: {
  code: string
  language: BundledLanguage
  showLineNumbers?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const lines = useMemo(() => code.split('\n'), [code])
  const totalLines = lines.length
  const isCollapsible = totalLines > COLLAPSE_THRESHOLD

  const displayCode = useMemo(() => {
    if (!isCollapsible || expanded) return code
    return lines.slice(0, VISIBLE_LINES).join('\n')
  }, [code, lines, isCollapsible, expanded])

  const rawTokens = useMemo(() => createRawTokens(displayCode), [displayCode])
  const syncTokenized = useMemo(
    () => highlightCode(displayCode, language) ?? rawTokens,
    [displayCode, language, rawTokens],
  )

  const [asyncResult, setAsyncResult] = useState<{ key: string; tokens: TokenizedCode } | null>(
    null,
  )
  const resultKey = `${displayCode}:${language}`

  useEffect(() => {
    let cancelled = false
    highlightCode(displayCode, language, (result) => {
      if (!cancelled) setAsyncResult({ key: `${displayCode}:${language}`, tokens: result })
    })
    return () => {
      cancelled = true
    }
  }, [displayCode, language])

  const tokenized =
    asyncResult && asyncResult.key === resultKey ? asyncResult.tokens : syncTokenized
  const isTerminal = TERMINAL_LANGUAGES.has(language.toLowerCase())

  return (
    <>
      <div
        ref={containerRef}
        className="relative overflow-hidden"
        style={
          isCollapsible && !expanded ? { maxHeight: `${VISIBLE_LINES * 1.5 + 1.5}rem` } : undefined
        }
      >
        <div className="relative overflow-auto">
          <CodeBlockBody showLineNumbers={showLineNumbers} tokenized={tokenized} />
        </div>
        {isCollapsible && !expanded && (
          <div
            className={cn(
              'absolute bottom-0 left-0 right-0 h-16 pointer-events-none',
              isTerminal
                ? 'bg-gradient-to-t from-[#0a0a0a] to-transparent'
                : 'bg-gradient-to-t from-muted to-transparent',
            )}
          />
        )}
      </div>
      {isCollapsible && (
        <button
          onClick={() => setExpanded(!expanded)}
          type="button"
          className={cn(
            'flex w-full items-center justify-center gap-1.5 py-1.5 text-xs transition-colors',
            isTerminal
              ? 'bg-zinc-950 text-zinc-400 hover:text-zinc-200'
              : 'bg-muted text-muted-foreground hover:text-foreground',
          )}
        >
          {expanded ? (
            <>
              <CaretUp size={12} />
              <span>收起</span>
            </>
          ) : (
            <>
              <CaretDown size={12} />
              <span>展开全部 {totalLines} 行</span>
            </>
          )}
        </button>
      )}
    </>
  )
}

// ── Main CodeBlock ─────────────────────────────────────────────────────

interface CodeBlockProps {
  code: string
  language: string
  showLineNumbers?: boolean
  filename?: string
  className?: string
}

export const CodeBlock = memo(function CodeBlock({
  code,
  language,
  showLineNumbers = false,
  filename,
  className,
}: CodeBlockProps) {
  const isTerminal = TERMINAL_LANGUAGES.has(language.toLowerCase())
  const [copied, setCopied] = useState(false)
  const [copiedMd, setCopiedMd] = useState(false)
  const langIcon = getLanguageIcon(language)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }, [code])

  const handleCopyMd = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`\`\`\`${language}\n${code}\n\`\`\``)
      setCopiedMd(true)
      setTimeout(() => setCopiedMd(false), 2000)
    } catch {
      /* ignore */
    }
  }, [code, language])

  const safeLang = (isBundledLanguage(language) ? language : 'text') as BundledLanguage

  return (
    <div
      className={cn(
        'not-prose my-3 w-full overflow-hidden rounded-md border bg-background text-foreground',
        isTerminal && 'border-zinc-700/50',
        className,
      )}
      style={{ containIntrinsicSize: 'auto 200px', contentVisibility: 'auto' }}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center justify-between px-4 py-1.5 text-xs border-b',
          isTerminal ? 'bg-zinc-950 text-zinc-400' : 'bg-muted text-muted-foreground',
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          {createElement(langIcon, {
            size: 14,
            className: cn('shrink-0', isTerminal ? 'text-green-400' : 'text-muted-foreground'),
          })}
          {filename && (
            <span
              className={cn(
                'truncate font-medium',
                isTerminal ? 'text-zinc-300' : 'text-foreground',
              )}
            >
              {filename}
            </span>
          )}
          {filename && <span className="text-muted-foreground/50">|</span>}
          <span
            className={cn(
              'rounded px-1.5 py-0.5',
              isTerminal ? 'bg-zinc-700/50 text-green-400' : 'bg-muted text-muted-foreground',
            )}
          >
            {language.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          <button
            onClick={handleCopy}
            type="button"
            className={cn(
              'flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors',
              isTerminal
                ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
            title="Copy code"
          >
            {copied ? (
              <>
                <Check size={12} />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                <span>Copy</span>
              </>
            )}
          </button>
          <button
            onClick={handleCopyMd}
            type="button"
            className={cn(
              'flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors',
              isTerminal
                ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
            title="Copy as Markdown"
          >
            {copiedMd ? (
              <>
                <Check size={12} />
                <span>Copied</span>
              </>
            ) : (
              <>
                <FileCode size={12} />
                <span>Markdown</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Body */}
      <CodeBlockContent code={code} language={safeLang} showLineNumbers={showLineNumbers} />
    </div>
  )
})
