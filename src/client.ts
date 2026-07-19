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

/** Client behaviour on a successful rebuild. */
export type ClientMode = "auto" | "manual";

const OVERLAY_STYLE =
  "position:fixed;inset:0;z-index:2147483647;margin:0;padding:24px;" +
  "background:rgba(20,20,20,.95);color:#ff5555;" +
  "font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;" +
  "white-space:pre-wrap;overflow:auto;";

const TOAST_STYLE =
  "position:fixed;right:16px;bottom:16px;z-index:2147483647;" +
  "padding:10px 14px;background:#1b1b1f;color:#e2e2e6;" +
  "font:13px/1.4 system-ui,sans-serif;border:1px solid #3c3c44;" +
  "border-radius:8px;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.4);";

/**
 * Render the inline script injected into served HTML. It opens an EventSource
 * to the plugin's SSE endpoint and reacts to:
 *
 * - `reload` (successful rebuild): in `auto` mode, full-page reload; in
 *   `manual` mode, clear any error overlay and show a "Rebuilt - click to
 *   reload" toast so in-page state survives until the user opts in;
 * - `build-error`: show a full-screen overlay with the build error (custom
 *   event name so it is not confused with EventSource's built-in `error`
 *   event, which fires on connection drops);
 * - reconnection (an `open` after the connection previously dropped): the
 *   server restarted and the bundle may have changed while we were not
 *   listening - reload in `auto` mode, toast in `manual` mode.
 *
 * `textContent` is used for all rendered text so build output can never inject
 * HTML into the page. EventSource reconnects on its own, so no manual retry
 * logic is needed.
 */
export function renderClientScript(url: string, mode: ClientMode): string {
  return (
    `<script type="module">` +
    `(()=>{` +
    `const s=new EventSource(${JSON.stringify(url)});` +
    `const manual=${JSON.stringify(mode === "manual")};` +
    `let box,toast,wasOpen=false;` +
    `const clearBox=()=>{if(box){box.remove();box=null;}};` +
    `const clearToast=()=>{if(toast){toast.remove();toast=null;}};` +
    `const root=()=>document.body||document.documentElement;` +
    `const showToast=()=>{` +
    `if(toast)return;` +
    `toast=document.createElement("div");` +
    `toast.setAttribute("data-vite-preview-watch-toast","");` +
    `toast.style.cssText=${JSON.stringify(TOAST_STYLE)};` +
    `toast.textContent="Rebuilt - click to reload";` +
    `toast.addEventListener("click",()=>location.reload());` +
    `root().appendChild(toast);` +
    `};` +
    `const onFresh=()=>{if(manual){clearBox();showToast();}else{location.reload();}};` +
    `s.addEventListener("reload",onFresh);` +
    `s.addEventListener("open",()=>{if(wasOpen)onFresh();wasOpen=true;});` +
    `s.addEventListener("build-error",(e)=>{` +
    `clearBox();clearToast();` +
    `let msg="Build failed";try{msg=JSON.parse(e.data).message||msg;}catch(_){}` +
    `box=document.createElement("pre");` +
    `box.setAttribute("data-vite-preview-watch-error","");` +
    `box.style.cssText=${JSON.stringify(OVERLAY_STYLE)};` +
    `box.textContent=msg;` +
    `root().appendChild(box);` +
    `});` +
    `})();` +
    `</script>`
  );
}
