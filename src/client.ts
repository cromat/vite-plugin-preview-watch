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

/**
 * Render the tiny inline script injected into served HTML. It opens an
 * EventSource to the plugin's SSE endpoint and does a full-page reload whenever
 * a `reload` event arrives. EventSource reconnects on its own if the preview
 * server restarts, so no extra error handling is needed.
 */
export function renderClientScript(url: string): string {
  return (
    `<script type="module">` +
    `(()=>{` +
    `const s=new EventSource(${JSON.stringify(url)});` +
    `s.addEventListener("reload",()=>location.reload());` +
    `})();` +
    `</script>`
  );
}
