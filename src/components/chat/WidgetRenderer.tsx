/**
 * WidgetRenderer — sandboxed iframe renderer for Generative UI widgets.
 * Supports streaming preview, finalization with script execution,
 * height auto-sizing, theme sync, and link interception.
 */

import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { resolveThemeVars, getWidgetIframeStyleBlock } from '../../lib/widget-css-bridge'
import {
  sanitizeForStreaming,
  sanitizeForIframe,
  buildReceiverSrcdoc,
} from '../../lib/widget-sanitizer'
import { WidgetErrorBoundary } from './WidgetErrorBoundary'

interface WidgetRendererProps {
  widgetCode: string
  isStreaming: boolean
  title?: string
  showOverlay?: boolean
}

const MAX_IFRAME_HEIGHT = 2000
const STREAM_DEBOUNCE = 120
const CDN_PATTERN = /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|esm\.sh/

// Module-level height cache to prevent scroll jumps on remount
const _heightCache = new Map<string, number>()
function getHeightCacheKey(code: string): string {
  return code.slice(0, 200)
}

function WidgetRendererInner({ widgetCode, isStreaming, title, showOverlay }: WidgetRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSentRef = useRef('')
  const [iframeReady, setIframeReady] = useState(false)
  const [iframeHeight, setIframeHeight] = useState(
    () => _heightCache.get(getHeightCacheKey(widgetCode)) || 0,
  )
  const [showCode, setShowCode] = useState(false)
  const [finalized, setFinalized] = useState(false)
  const finalizedRef = useRef(false)
  const hasReceivedFirstHeight = useRef((_heightCache.get(getHeightCacheKey(widgetCode)) || 0) > 0)
  const heightLockedRef = useRef(false)

  const hasCDN = useMemo(() => CDN_PATTERN.test(widgetCode), [widgetCode])

  const srcdoc = useMemo(() => {
    const isDark = document.documentElement.classList.contains('dark')
    const vars = resolveThemeVars()
    const styleBlock = getWidgetIframeStyleBlock(vars)
    return buildReceiverSrcdoc(styleBlock, isDark)
  }, [])

  // postMessage handler
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!e.data || typeof e.data.type !== 'string') return
      if (iframeRef.current && e.source !== iframeRef.current.contentWindow) return

      switch (e.data.type) {
        case 'widget:ready':
          setIframeReady(true)
          break
        case 'widget:resize':
          if (typeof e.data.height === 'number' && e.data.height > 0) {
            const newH = Math.min(e.data.height + 2, MAX_IFRAME_HEIGHT)
            const cacheKey = getHeightCacheKey(widgetCode)
            if (heightLockedRef.current) {
              setIframeHeight((prev) => {
                const h = Math.max(prev, newH)
                _heightCache.set(cacheKey, h)
                return h
              })
              break
            }
            _heightCache.set(cacheKey, newH)
            if (!hasReceivedFirstHeight.current) {
              hasReceivedFirstHeight.current = true
              const el = iframeRef.current
              if (el) {
                el.style.transition = 'none'
                void el.offsetHeight
              }
              setIframeHeight(newH)
              requestAnimationFrame(() => {
                if (el) el.style.transition = 'height 0.3s ease-out'
              })
            } else {
              setIframeHeight(newH)
            }
          }
          break
        case 'widget:link': {
          const href = String(e.data.href || '')
          if (href && !/^\s*(javascript|data)\s*:/i.test(href)) {
            window.open(href, '_blank', 'noopener,noreferrer')
          }
          break
        }
        case 'widget:sendMessage': {
          const text = String(e.data.text || '')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fn = (window as any).__widgetSendMessage
          if (text && text.length <= 500 && typeof fn === 'function') {
            fn(text)
          }
          break
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // Streaming updates
  const sendUpdate = useCallback((html: string) => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    if (html === lastSentRef.current) return
    lastSentRef.current = html
    iframe.contentWindow.postMessage({ type: 'widget:update', html }, '*')
  }, [])

  useEffect(() => {
    if (!isStreaming || !iframeReady) return
    const sanitized = sanitizeForStreaming(widgetCode)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => sendUpdate(sanitized), STREAM_DEBOUNCE)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [widgetCode, isStreaming, iframeReady, sendUpdate])

  // Finalize
  useEffect(() => {
    if (isStreaming || !iframeReady || finalizedRef.current) return
    const sanitized = sanitizeForIframe(widgetCode)
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    finalizedRef.current = true
    lastSentRef.current = sanitized
    heightLockedRef.current = true
    iframe.contentWindow.postMessage({ type: 'widget:finalize', html: sanitized }, '*')
    setTimeout(() => {
      heightLockedRef.current = false
      setFinalized(true)
    }, 400)
  }, [isStreaming, iframeReady, widgetCode])

  // Theme sync
  useEffect(() => {
    if (!iframeReady) return
    const observer = new MutationObserver(() => {
      const nowDark = document.documentElement.classList.contains('dark')
      const vars = resolveThemeVars()
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'widget:theme', vars, isDark: nowDark },
        '*',
      )
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [iframeReady])

  const showLoadingOverlay = hasCDN && !isStreaming && iframeReady && !finalized

  return (
    <div className="group/widget relative my-1">
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts"
        srcDoc={srcdoc}
        title={title || 'Widget'}
        onLoad={() => setIframeReady(true)}
        style={{
          width: '100%',
          height: iframeHeight,
          border: 'none',
          display: showCode ? 'none' : 'block',
          overflow: 'hidden',
          colorScheme: 'auto',
        }}
      />

      {(showLoadingOverlay || showOverlay) && (
        <div
          className="absolute inset-0 pointer-events-none rounded-lg"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, var(--color-muted, rgba(128,128,128,0.08)) 50%, transparent 100%)',
            backgroundSize: '200% 100%',
            animation: 'widget-shimmer 1.5s ease-in-out infinite',
          }}
        />
      )}

      {showCode && (
        <pre className="p-3 text-xs rounded-lg bg-muted/30 overflow-x-auto max-h-80 overflow-y-auto border border-border/30">
          <code>{widgetCode}</code>
        </pre>
      )}

      <button
        onClick={() => setShowCode(!showCode)}
        type="button"
        className="absolute top-1 right-1 opacity-0 group-hover/widget:opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50"
      >
        {showCode ? '隐藏代码' : '查看代码'}
      </button>
    </div>
  )
}

export function WidgetRenderer(props: WidgetRendererProps) {
  return (
    <WidgetErrorBoundary>
      <WidgetRendererInner {...props} />
    </WidgetErrorBoundary>
  )
}
