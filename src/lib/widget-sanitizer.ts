/**
 * Widget HTML sanitizer + iframe srcdoc builder.
 *
 * 3-layer security model:
 * 1. Streaming: strip all scripts/handlers/dangerous tags (preview only)
 * 2. Finalized: strip only nesting-escape tags; scripts execute in sandbox
 * 3. iframe sandbox: allow-scripts only, CSP limits CDN to whitelist
 */

export const CDN_WHITELIST = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'esm.sh']

const DANGEROUS_TAGS = /<(iframe|object|embed|meta|link|base|form)[\s>][\s\S]*?<\/\1>/gi
const DANGEROUS_VOID = /<(iframe|object|embed|meta|link|base)\b[^>]*\/?>/gi

/** Strip all interactivity for streaming preview. */
export function sanitizeForStreaming(html: string): string {
  return html
    .replace(DANGEROUS_TAGS, '')
    .replace(DANGEROUS_VOID, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']*)/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(
      /\s+(href|src|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']*))/gi,
      (match, _attr: string, dq?: string, sq?: string, uq?: string) => {
        const url = (dq ?? sq ?? uq ?? '').trim()
        if (/^\s*(javascript|data)\s*:/i.test(url)) return ''
        return match
      },
    )
}

/** Light sanitization for finalized content inside iframe. */
export function sanitizeForIframe(html: string): string {
  return html.replace(DANGEROUS_TAGS, '').replace(DANGEROUS_VOID, '')
}

/** Build the receiver iframe srcdoc. */
export function buildReceiverSrcdoc(styleBlock: string, isDark: boolean): string {
  const cspDomains = CDN_WHITELIST.map((d) => 'https://' + d).join(' ')
  const csp = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${cspDomains}`,
    "style-src 'unsafe-inline'",
    'img-src * data: blob:',
    'font-src * data:',
    "connect-src 'none'",
  ].join('; ')

  const receiverScript = `(function(){
var root=document.getElementById('__root');
var _t=null,_first=true;
function _h(){
if(_t)clearTimeout(_t);
_t=setTimeout(function(){
var h=document.body.scrollHeight;
if(h>0)parent.postMessage({type:'widget:resize',height:h,first:_first},'*');
_first=false;
},60);
}
var _ro=new ResizeObserver(_h);
_ro.observe(document.body);

function applyHtml(html){
root.innerHTML=html;
_h();
}

function finalizeHtml(html){
var tmp=document.createElement('div');
tmp.innerHTML=html;
var ss=tmp.querySelectorAll('script');
var scripts=[];
for(var i=0;i<ss.length;i++){
scripts.push({src:ss[i].src||'',text:ss[i].textContent||'',attrs:[]});
for(var j=0;j<ss[i].attributes.length;j++){
var a=ss[i].attributes[j];
if(a.name!=='src')scripts[scripts.length-1].attrs.push({name:a.name,value:a.value});
}
ss[i].remove();
}
var visualHtml=tmp.innerHTML;
if(root.innerHTML!==visualHtml)root.innerHTML=visualHtml;
for(var i=0;i<scripts.length;i++){
var n=document.createElement('script');
if(scripts[i].src)n.src=scripts[i].src;
else if(scripts[i].text)n.textContent=scripts[i].text;
for(var j=0;j<scripts[i].attrs.length;j++)n.setAttribute(scripts[i].attrs[j].name,scripts[i].attrs[j].value);
root.appendChild(n);
}
_h();
}

window.addEventListener('message',function(e){
if(!e.data)return;
switch(e.data.type){
case 'widget:update':
applyHtml(e.data.html);
break;
case 'widget:finalize':
finalizeHtml(e.data.html);
setTimeout(_h,150);
break;
case 'widget:theme':
var r=document.documentElement,v=e.data.vars;
if(v)for(var k in v)r.style.setProperty(k,v[k]);
if(typeof e.data.isDark==='boolean')r.className=e.data.isDark?'dark':'';
setTimeout(_h,100);
break;
}
});

document.addEventListener('click',function(e){
var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;
if(!a)return;var h=a.getAttribute('href');
if(!h||h.charAt(0)==='#')return;
e.preventDefault();
parent.postMessage({type:'widget:link',href:h},'*');
});

window.__widgetSendMessage=function(t){
if(typeof t!=='string'||t.length>500)return;
parent.postMessage({type:'widget:sendMessage',text:t},'*');
};

parent.postMessage({type:'widget:ready'},'*');
})();`

  return `<!DOCTYPE html>
<html class="${isDark ? 'dark' : ''}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
${styleBlock}
</style>
</head>
<body style="margin:0;padding:0;">
<div id="__root"></div>
<script>${receiverScript}</script>
</body>
</html>`
}
