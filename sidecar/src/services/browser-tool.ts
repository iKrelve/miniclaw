/**
 * Browser Tool — registers browser_action as an SDK MCP tool via createSdkMcpServer().
 *
 * This lets Claude see and call browser_action during conversations.
 * The tool communicates directly with Chrome via CDP WebSocket.
 *
 * Actions: navigate, click, type, scroll_down, scroll_up, screenshot,
 *          wait, back, forward, refresh, get_text, evaluate
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import { chromeManager } from './chrome-manager'
import { logger } from '../utils/logger'

// CDP message ID counter
let cdpId = 1

/**
 * Send a CDP command over WebSocket and await the response.
 * Opens a fresh WebSocket per command (fire-and-forget style, same as Jarvis).
 */
async function cdpCommand(
  wsUrl: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const id = cdpId++
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error(`CDP timeout: ${method}`))
    }, 30_000)

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id, method, params }))
    })

    ws.addEventListener('message', (event: MessageEvent) => {
      try {
        const msg = JSON.parse(String(event.data))
        if (msg.id === id) {
          clearTimeout(timeout)
          ws.close()
          if (msg.error) {
            reject(new Error(`CDP error: ${msg.error.message}`))
          } else {
            resolve(msg.result)
          }
        }
      } catch {
        /* ignore parse errors */
      }
    })

    ws.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error(`CDP WebSocket error: ${method}`))
    })
  })
}

/**
 * Find a page target's WebSocket URL from Chrome's /json endpoint.
 */
async function getPageWsUrl(cdpPort: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json`, {
    signal: AbortSignal.timeout(3000),
  })
  const targets = (await res.json()) as Array<{
    type: string
    url: string
    webSocketDebuggerUrl?: string
  }>
  // Prefer a non-blank page
  const page =
    targets.find(
      (t) => t.type === 'page' && !t.url.startsWith('about:') && t.webSocketDebuggerUrl,
    ) || targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page?.webSocketDebuggerUrl) {
    throw new Error('No page target found in Chrome')
  }
  return page.webSocketDebuggerUrl
}

/**
 * Take a full-page screenshot and return base64 JPEG.
 */
async function takeScreenshot(wsUrl: string): Promise<string> {
  const result = (await cdpCommand(wsUrl, 'Page.captureScreenshot', {
    format: 'jpeg',
    quality: 75,
  })) as { data: string }
  return result.data
}

/**
 * Execute JavaScript in the page and return the string result.
 */
async function evaluate(wsUrl: string, expression: string): Promise<string> {
  const result = (await cdpCommand(wsUrl, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { value?: unknown }; exceptionDetails?: { text: string } }
  if (result.exceptionDetails) {
    throw new Error(`JS error: ${result.exceptionDetails.text}`)
  }
  const val = result.result?.value
  return typeof val === 'string' ? val : JSON.stringify(val)
}

// Cached server instance (lazy singleton)
let server: McpSdkServerConfigWithInstance | null = null

/**
 * Get the browser MCP server config. Returns null if SDK imports fail.
 * The server is created once and reused across all sessions.
 */
export function getBrowserMcpServer(): McpSdkServerConfigWithInstance | null {
  if (server) return server

  try {
    server = createSdkMcpServer({
      name: 'miniclaw-browser',
      version: '1.0.0',
      tools: [
        tool(
          'browser_action',
          `Interact with a web browser to perform actions like navigating to URLs, clicking elements, typing text, scrolling, and taking screenshots.

## Actions

- **navigate**: Go to a URL. Params: url (required)
- **click**: Click at coordinates. Params: x, y (required, integers)
- **type**: Type text at current focus. Params: text (required)
- **scroll_down**: Scroll down the page. Params: amount (optional, pixels, default 400)
- **scroll_up**: Scroll up the page. Params: amount (optional, pixels, default 400)
- **screenshot**: Take a screenshot of the current page. Returns base64 JPEG image.
- **wait**: Wait for a duration. Params: duration (optional, ms, default 2000)
- **back**: Navigate back in browser history
- **forward**: Navigate forward in browser history
- **refresh**: Refresh the current page
- **get_text**: Get all visible text on the page
- **evaluate**: Run JavaScript in the page. Params: expression (required)

## Important Notes

- Always take a screenshot after navigation or interactions to see the result
- Use x,y coordinates from previous screenshots for clicking
- The browser is a real Chrome instance controlled via CDP`,
          {
            action: z.enum([
              'navigate',
              'click',
              'type',
              'scroll_down',
              'scroll_up',
              'screenshot',
              'wait',
              'back',
              'forward',
              'refresh',
              'get_text',
              'evaluate',
            ]),
            url: z.string().optional(),
            x: z.number().optional(),
            y: z.number().optional(),
            text: z.string().optional(),
            amount: z.number().optional(),
            duration: z.number().optional(),
            expression: z.string().optional(),
          },
          async (args) => {
            const port = chromeManager.getCdpPort()
            if (!port) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'Browser is not running. Ask the user to enable the browser from the input toolbar.',
                  },
                ],
                isError: true,
              }
            }

            try {
              const wsUrl = await getPageWsUrl(port)

              switch (args.action) {
                case 'navigate': {
                  if (!args.url) {
                    return {
                      content: [
                        { type: 'text' as const, text: 'url is required for navigate action' },
                      ],
                      isError: true,
                    }
                  }
                  await cdpCommand(wsUrl, 'Page.navigate', { url: args.url })
                  // Wait for page load
                  await new Promise((r) => setTimeout(r, 2000))
                  const screenshot = await takeScreenshot(wsUrl)
                  return {
                    content: [
                      { type: 'text' as const, text: `Navigated to ${args.url}` },
                      { type: 'image' as const, data: screenshot, mimeType: 'image/jpeg' },
                    ],
                  }
                }

                case 'click': {
                  if (args.x === undefined || args.y === undefined) {
                    return {
                      content: [
                        {
                          type: 'text' as const,
                          text: 'x and y coordinates are required for click action',
                        },
                      ],
                      isError: true,
                    }
                  }
                  await cdpCommand(wsUrl, 'Input.dispatchMouseEvent', {
                    type: 'mousePressed',
                    x: args.x,
                    y: args.y,
                    button: 'left',
                    clickCount: 1,
                  })
                  await cdpCommand(wsUrl, 'Input.dispatchMouseEvent', {
                    type: 'mouseReleased',
                    x: args.x,
                    y: args.y,
                    button: 'left',
                    clickCount: 1,
                  })
                  await new Promise((r) => setTimeout(r, 500))
                  const screenshot = await takeScreenshot(wsUrl)
                  return {
                    content: [
                      { type: 'text' as const, text: `Clicked at (${args.x}, ${args.y})` },
                      { type: 'image' as const, data: screenshot, mimeType: 'image/jpeg' },
                    ],
                  }
                }

                case 'type': {
                  if (!args.text) {
                    return {
                      content: [
                        { type: 'text' as const, text: 'text is required for type action' },
                      ],
                      isError: true,
                    }
                  }
                  // Use Input.insertText for reliable text input
                  await cdpCommand(wsUrl, 'Input.insertText', { text: args.text })
                  await new Promise((r) => setTimeout(r, 300))
                  const screenshot = await takeScreenshot(wsUrl)
                  return {
                    content: [
                      { type: 'text' as const, text: `Typed: "${args.text}"` },
                      { type: 'image' as const, data: screenshot, mimeType: 'image/jpeg' },
                    ],
                  }
                }

                case 'scroll_down': {
                  const amt = args.amount || 400
                  await cdpCommand(wsUrl, 'Input.dispatchMouseEvent', {
                    type: 'mouseWheel',
                    x: 400,
                    y: 400,
                    deltaX: 0,
                    deltaY: amt,
                  })
                  await new Promise((r) => setTimeout(r, 300))
                  const screenshot = await takeScreenshot(wsUrl)
                  return {
                    content: [
                      { type: 'text' as const, text: `Scrolled down ${amt}px` },
                      { type: 'image' as const, data: screenshot, mimeType: 'image/jpeg' },
                    ],
                  }
                }

                case 'scroll_up': {
                  const amt = args.amount || 400
                  await cdpCommand(wsUrl, 'Input.dispatchMouseEvent', {
                    type: 'mouseWheel',
                    x: 400,
                    y: 400,
                    deltaX: 0,
                    deltaY: -amt,
                  })
                  await new Promise((r) => setTimeout(r, 300))
                  const screenshot = await takeScreenshot(wsUrl)
                  return {
                    content: [
                      { type: 'text' as const, text: `Scrolled up ${amt}px` },
                      { type: 'image' as const, data: screenshot, mimeType: 'image/jpeg' },
                    ],
                  }
                }

                case 'screenshot': {
                  const screenshot = await takeScreenshot(wsUrl)
                  // Also get current URL and title for context
                  const info = await evaluate(
                    wsUrl,
                    'JSON.stringify({ url: location.href, title: document.title })',
                  )
                  return {
                    content: [
                      { type: 'text' as const, text: `Screenshot taken. Page info: ${info}` },
                      { type: 'image' as const, data: screenshot, mimeType: 'image/jpeg' },
                    ],
                  }
                }

                case 'wait': {
                  const ms = args.duration || 2000
                  await new Promise((r) => setTimeout(r, ms))
                  return { content: [{ type: 'text' as const, text: `Waited ${ms}ms` }] }
                }

                case 'back': {
                  await cdpCommand(wsUrl, 'Page.navigateToHistoryEntry', {
                    entryId: -1, // This doesn't work directly; use JS instead
                  }).catch(() => {})
                  await evaluate(wsUrl, 'history.back()')
                  await new Promise((r) => setTimeout(r, 1500))
                  const screenshot = await takeScreenshot(wsUrl)
                  return {
                    content: [
                      { type: 'text' as const, text: 'Navigated back' },
                      { type: 'image' as const, data: screenshot, mimeType: 'image/jpeg' },
                    ],
                  }
                }

                case 'forward': {
                  await evaluate(wsUrl, 'history.forward()')
                  await new Promise((r) => setTimeout(r, 1500))
                  const screenshot = await takeScreenshot(wsUrl)
                  return {
                    content: [
                      { type: 'text' as const, text: 'Navigated forward' },
                      { type: 'image' as const, data: screenshot, mimeType: 'image/jpeg' },
                    ],
                  }
                }

                case 'refresh': {
                  await cdpCommand(wsUrl, 'Page.reload')
                  await new Promise((r) => setTimeout(r, 2000))
                  const screenshot = await takeScreenshot(wsUrl)
                  return {
                    content: [
                      { type: 'text' as const, text: 'Page refreshed' },
                      { type: 'image' as const, data: screenshot, mimeType: 'image/jpeg' },
                    ],
                  }
                }

                case 'get_text': {
                  const text = await evaluate(wsUrl, 'document.body.innerText')
                  // Truncate to avoid huge responses
                  const truncated =
                    text.length > 10000 ? text.slice(0, 10000) + '\n...(truncated)' : text
                  return { content: [{ type: 'text' as const, text: truncated }] }
                }

                case 'evaluate': {
                  if (!args.expression) {
                    return {
                      content: [
                        {
                          type: 'text' as const,
                          text: 'expression is required for evaluate action',
                        },
                      ],
                      isError: true,
                    }
                  }
                  const result = await evaluate(wsUrl, args.expression)
                  return { content: [{ type: 'text' as const, text: result }] }
                }

                default:
                  return {
                    content: [{ type: 'text' as const, text: `Unknown action: ${args.action}` }],
                    isError: true,
                  }
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              logger.error('browser', 'browser_action failed', { action: args.action, error: msg })
              return {
                content: [{ type: 'text' as const, text: `Browser action failed: ${msg}` }],
                isError: true,
              }
            }
          },
        ),
      ],
    })

    logger.info('browser', 'Browser MCP server created')
    return server
  } catch (err) {
    logger.error('browser', 'Failed to create browser MCP server', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
