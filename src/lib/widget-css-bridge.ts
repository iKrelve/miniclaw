/**
 * CSS variable bridge — maps widget variable names to MiniClaw's design tokens
 * so widgets inherit the current theme inside their sandboxed iframe.
 */

const WIDGET_CSS_BRIDGE = `
--color-background-primary:   var(--background);
--color-background-secondary: var(--muted);
--color-background-tertiary:  color-mix(in oklch, var(--muted-foreground) 10%, var(--background));
--color-text-primary:         var(--foreground);
--color-text-secondary:       var(--muted-foreground);
--color-text-tertiary:        color-mix(in oklch, var(--muted-foreground) 60%, transparent);
--color-border-tertiary:      var(--border);
--color-border-secondary:     var(--border);
--color-border-primary:       color-mix(in oklch, var(--foreground) 40%, transparent);
--font-sans:                  ui-sans-serif, system-ui, sans-serif;
--font-mono:                  ui-monospace, monospace;
--border-radius-md:           8px;
--border-radius-lg:           12px;
--border-radius-xl:           16px;
`

const WIDGET_UTILITIES = `
.hidden { display: none; }
.block { display: block; }
.inline-block { display: inline-block; }
.flex { display: flex; }
.inline-flex { display: inline-flex; }
.grid { display: grid; }
.flex-col { flex-direction: column; }
.flex-row { flex-direction: row; }
.flex-wrap { flex-wrap: wrap; }
.flex-1 { flex: 1 1 0%; }
.shrink-0 { flex-shrink: 0; }
.items-start { align-items: flex-start; }
.items-center { align-items: center; }
.items-end { align-items: flex-end; }
.justify-start { justify-content: flex-start; }
.justify-center { justify-content: center; }
.justify-end { justify-content: flex-end; }
.justify-between { justify-content: space-between; }
.grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
.grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.grid-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.gap-1 { gap: 4px; }
.gap-2 { gap: 8px; }
.gap-3 { gap: 12px; }
.gap-4 { gap: 16px; }
.gap-6 { gap: 24px; }
.m-0 { margin: 0; }
.m-2 { margin: 8px; }
.m-4 { margin: 16px; }
.mx-auto { margin-left: auto; margin-right: auto; }
.mt-2 { margin-top: 8px; }
.mt-4 { margin-top: 16px; }
.mb-2 { margin-bottom: 8px; }
.mb-4 { margin-bottom: 16px; }
.p-0 { padding: 0; }
.p-2 { padding: 8px; }
.p-3 { padding: 12px; }
.p-4 { padding: 16px; }
.p-6 { padding: 24px; }
.px-2 { padding-left: 8px; padding-right: 8px; }
.px-3 { padding-left: 12px; padding-right: 12px; }
.px-4 { padding-left: 16px; padding-right: 16px; }
.py-1 { padding-top: 4px; padding-bottom: 4px; }
.py-2 { padding-top: 8px; padding-bottom: 8px; }
.py-3 { padding-top: 12px; padding-bottom: 12px; }
.space-y-2 > * + * { margin-top: 8px; }
.space-y-3 > * + * { margin-top: 12px; }
.space-y-4 > * + * { margin-top: 16px; }
.w-full { width: 100%; }
.h-full { height: 100%; }
.min-w-0 { min-width: 0; }
.max-w-full { max-width: 100%; }
.text-xs { font-size: 12px; line-height: 1.5; }
.text-sm { font-size: 14px; line-height: 1.5; }
.text-base { font-size: 16px; line-height: 1.6; }
.text-lg { font-size: 18px; line-height: 1.6; }
.text-xl { font-size: 20px; line-height: 1.4; }
.text-2xl { font-size: 24px; line-height: 1.3; }
.font-medium { font-weight: 500; }
.font-semibold { font-weight: 600; }
.font-bold { font-weight: 700; }
.text-center { text-align: center; }
.text-right { text-align: right; }
.tabular-nums { font-variant-numeric: tabular-nums; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.font-mono { font-family: var(--font-mono); }
.rounded { border-radius: 8px; }
.rounded-md { border-radius: 8px; }
.rounded-lg { border-radius: 12px; }
.rounded-xl { border-radius: 16px; }
.rounded-full { border-radius: 9999px; }
.border { border: 1px solid var(--color-border-tertiary); }
.border-t { border-top: 1px solid var(--color-border-tertiary); }
.border-b { border-bottom: 1px solid var(--color-border-tertiary); }
.overflow-hidden { overflow: hidden; }
.overflow-auto { overflow: auto; }
.relative { position: relative; }
.absolute { position: absolute; }
.cursor-pointer { cursor: pointer; }
.transition { transition: all 0.15s ease; }
.transition-colors { transition: color 0.15s, background-color 0.15s, border-color 0.15s; }
.shadow-sm { box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
.bg-surface-primary { background-color: var(--color-background-primary); }
.bg-surface-secondary { background-color: var(--color-background-secondary); }
.bg-transparent { background-color: transparent; }
.text-content-primary { color: var(--color-text-primary); }
.text-content-secondary { color: var(--color-text-secondary); }
.text-content-tertiary { color: var(--color-text-tertiary); }
`

const FORM_STYLES = `
input[type="text"],
input[type="number"],
select,
textarea {
  height: 36px;
  padding: 0 10px;
  border: 0.5px solid var(--color-border-secondary);
  border-radius: var(--border-radius-md);
  background: var(--color-background-primary);
  color: var(--color-text-primary);
  font-size: 14px;
  font-family: var(--font-sans);
  outline: none;
}
input:focus, select:focus, textarea:focus {
  border-color: var(--color-border-primary);
}
button {
  background: transparent;
  border: 0.5px solid var(--color-border-secondary);
  border-radius: var(--border-radius-md);
  padding: 6px 14px;
  font-size: 14px;
  font-family: var(--font-sans);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: background 0.15s;
}
button:hover { background: var(--color-background-tertiary); }
`

// ── Theme variable names to resolve from parent ──

const THEME_VAR_NAMES = [
  '--background',
  '--foreground',
  '--muted',
  '--muted-foreground',
  '--border',
  '--primary',
  '--primary-foreground',
]

/** Read computed CSS variable values from the parent document. */
export function resolveThemeVars(): Record<string, string> {
  const computed = getComputedStyle(document.documentElement)
  const vars: Record<string, string> = {}
  for (const name of THEME_VAR_NAMES) {
    const val = computed.getPropertyValue(name).trim()
    if (val) vars[name] = val
  }
  return vars
}

/** Generate the full CSS content for iframe srcdoc. */
export function getWidgetIframeStyleBlock(resolvedVars: Record<string, string>): string {
  const rootVars = Object.entries(resolvedVars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')

  return `
:root {
${rootVars}
}
.dark { color-scheme: dark; }
body {
  ${WIDGET_CSS_BRIDGE}
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.7;
  color: var(--color-text-primary);
  background: transparent;
}
* { box-sizing: border-box; }
a { color: var(--color-text-secondary); text-decoration: none; cursor: pointer; }
a:hover { text-decoration: underline; }
${WIDGET_UTILITIES}
${FORM_STYLES}
@keyframes widget-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}
`
}
