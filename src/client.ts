/**
 * Join the resolved `base` with the client path into the absolute URL the
 * reload client should connect to. `base` ends with `/`, `clientPath` starts
 * with `/`, so we drop the duplicate slash.
 *
 * `/` + `/__preview_watch`   -> `/__preview_watch`
 * `/app/` + `/__preview_watch` -> `/app/__preview_watch`
 */
export function joinClientUrl(base: string, clientPath: string): string {
  return base.replace(/\/+$/, "") + clientPath;
}

const OVERLAY_STYLE =
  "position:fixed;inset:0;z-index:2147483647;margin:0;padding:24px;" +
  "background:rgba(20,20,20,.95);color:#ff5555;" +
  "font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;" +
  "white-space:pre-wrap;overflow:auto;";

/**
 * Render the inline script injected into served HTML. It opens an EventSource
 * to the plugin's SSE endpoint and:
 *
 * - on a `reload` event, does a full-page reload;
 * - on a `build-error` event, shows a full-screen overlay with the build error
 *   (using a custom event name so it is not confused with EventSource's own
 *   built-in `error` event, which fires on connection drops).
 *
 * The overlay is removed on the next reload. `textContent` is used for the
 * message so build output can never inject HTML into the page.
 *
 * EventSource reconnects on its own if the preview server restarts, so no extra
 * connection handling is needed.
 */
export function renderClientScript(url: string): string {
  return (
    `<script type="module">` +
    `(()=>{` +
    `const s=new EventSource(${JSON.stringify(url)});` +
    `let box;` +
    `const clear=()=>{if(box){box.remove();box=null;}};` +
    `s.addEventListener("reload",()=>location.reload());` +
    `s.addEventListener("build-error",(e)=>{` +
    `clear();` +
    `let msg="Build failed";try{msg=JSON.parse(e.data).message||msg;}catch(_){}` +
    `box=document.createElement("pre");` +
    `box.setAttribute("data-vite-preview-watch-error","");` +
    `box.style.cssText=${JSON.stringify(OVERLAY_STYLE)};` +
    `box.textContent=msg;` +
    `(document.body||document.documentElement).appendChild(box);` +
    `});` +
    `})();` +
    `</script>`
  );
}
