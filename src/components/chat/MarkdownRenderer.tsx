/**
 * MarkdownRenderer — Renders streaming Markdown with code highlighting.
 * Uses react-markdown + remark-gfm + rehype-raw.
 * Code blocks use a simple syntax-highlighted <pre> (Shiki can be added later for full theme support).
 */

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { cn } from '../../lib/utils'
import { Copy, Check } from 'lucide-react'
import { useState, useCallback, type ComponentPropsWithoutRef } from 'react'

interface MarkdownRendererProps {
  content: string
  className?: string
}

function CodeBlock({ className, children, ...props }: ComponentPropsWithoutRef<'code'>) {
  const [copied, setCopied] = useState(false)
  const match = /language-(\w+)/.exec(className || '')
  const lang = match ? match[1] : ''
  const code = String(children).replace(/\n$/, '')
  const isInline = !className && !code.includes('\n')

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  if (isInline) {
    return (
      <code
        className="px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-sm font-mono text-pink-600 dark:text-pink-400"
        {...props}
      >
        {children}
      </code>
    )
  }

  return (
    <div className="relative group my-3 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-100 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-700">
        <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">{lang || 'text'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {/* Code content */}
      <pre className="overflow-x-auto p-4 bg-zinc-50 dark:bg-zinc-900 text-sm leading-relaxed">
        <code className={cn('font-mono', className)} {...props}>
          {children}
        </code>
      </pre>
    </div>
  )
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn('prose prose-sm dark:prose-invert max-w-none', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          code: CodeBlock,
          // Tables
          table: ({ children }) => (
            <div className="overflow-x-auto my-3">
              <table className="min-w-full text-sm border-collapse border border-zinc-200 dark:border-zinc-700 rounded-lg">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left font-medium bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 border border-zinc-200 dark:border-zinc-700">{children}</td>
          ),
          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-600 underline underline-offset-2"
            >
              {children}
            </a>
          ),
          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-blue-500 pl-4 my-3 text-zinc-600 dark:text-zinc-400 italic">
              {children}
            </blockquote>
          ),
          // Lists
          ul: ({ children }) => <ul className="list-disc pl-6 my-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-6 my-2 space-y-1">{children}</ol>,
          // Headings
          h1: ({ children }) => <h1 className="text-xl font-bold mt-4 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-lg font-bold mt-3 mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-base font-semibold mt-3 mb-1">{children}</h3>,
          // Paragraphs
          p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
          // Horizontal rule
          hr: () => <hr className="my-4 border-zinc-200 dark:border-zinc-800" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
