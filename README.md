# vite-plugin-preview-watch

[![npm](https://img.shields.io/npm/v/vite-plugin-preview-watch)](https://www.npmjs.com/package/vite-plugin-preview-watch)

Watch mode for `vite preview`. It rebuilds your production bundle whenever the
source changes and full-page reloads any open preview tabs, so the build you are
previewing stays fresh - no manual `vite build` + refresh loop.

Use it when you specifically want to look at the **production** output (minified
assets, real `base`, hashed filenames, service worker, SSR/edge output) while
still iterating. For regular development, the dev server and its HMR remain the
right tool; this plugin is deliberately about the production build.

Implements the long-standing request in
[vitejs/vite#5196](https://github.com/vitejs/vite/issues/5196) as a plugin.

- Uses one small runtime dependency (`chokidar`) to watch all project files,
  including framework-managed templates and styles.
- Full-page reload over Server-Sent Events - no client library to install.
- Build failures surface as a full-screen overlay in the browser instead of
  silently leaving the stale bundle on screen.
- Inert during `vite dev` and `vite build`; all behaviour lives in the preview
  server.

## Install

```sh
npm install --save-dev --ignore-scripts vite-plugin-preview-watch
```

Requires Vite 4 or newer.

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { previewWatch } from "vite-plugin-preview-watch";

export default defineConfig({
  plugins: [previewWatch()],
});
```

Then:

```sh
vite build   # produce the initial dist/
vite preview # now watches sources, rebuilds, and reloads open tabs
```

Edit a source file and the preview reloads once the rebuild finishes.

## How it works

On `vite preview` startup the plugin:

1. Starts a background Chokidar watcher over the project source tree, including
   external templates and styles that a framework plugin may not register with
   Rollup. After each settled source change, it runs a fresh `vite build` into
   the same `outDir` the preview server serves from. Using a fresh build avoids
   persistent framework plugin caches returning the preceding version of a
   template. Preview startup waits for the first output build, so it cannot
   race the first edit you make.
2. Registers a Server-Sent Events endpoint and injects a tiny client script into
   served HTML documents.
3. On every successful rebuild, pushes a `reload` event. In the default
   (`reload: true`) mode the client does a `location.reload()`; in
   `reload: "manual"` mode it shows a small toast instead so in-page state
   survives until you click it.
4. When a rebuild fails, pushes a `build-error` event; the client shows a
   full-screen overlay with the error (plugin, message, file location, and code
   frame). The overlay clears on the next successful rebuild.
5. If the SSE connection drops and later reconnects (for example after the
   preview server restarts, when the bundle may have changed while the tab was
   not listening), the client treats it like a fresh rebuild - auto-reloading in
   the default mode, or showing the toast in `manual` mode. Set `reconnect:
   false` to turn this off, so a preview server that is deliberately restarted
   often does not reload open tabs.

The build-error overlay carries a small "Reload" button in its top-right corner
so you can force a reload without opening the DevTools console. The error text
itself is always rendered as `textContent` (never `innerHTML`), so build output
can never inject markup into the page.

The plugin's own responses (injected HTML and the SSE endpoint) mirror the
preview server's `preview.headers` and `preview.cors` configuration, so they
stay consistent with the rest of the preview server. A server-side `onRebuild`
hook, if provided, runs after every rebuild cycle.

Everything is torn down when the preview server closes.

## Options

```ts
previewWatch({
  // What to do in open tabs after each rebuild:
  // - true     -> full-page reload automatically;
  // - "manual" -> show a "Rebuilt - click to reload" toast instead, so in-page
  //               state (scroll, form input) survives until you opt in;
  // - false    -> still rebuilds on change but injects nothing and never
  //               reloads.
  reload: true,

  // Server-side hook run after every rebuild cycle, successful or not, and
  // regardless of the reload setting. Exceptions thrown here are caught and
  // logged so they cannot take down the preview server.
  onRebuild: (info) => {
    // info: { ok: boolean; error: unknown; durationMs: number }
  },

  // Show a full-screen overlay in the browser when a rebuild fails. No effect
  // when reload is false. The overlay includes a small "Reload" button.
  overlay: true,

  // React to SSE reconnection after a dropped connection. true treats a
  // reconnect as a fresh rebuild (reload / toast) because the server may have
  // restarted with a changed bundle; false makes reconnection a no-op - handy
  // when the preview server is restarted often on purpose. No effect when
  // reload is false.
  reconnect: true,

  // Path (relative to `base`) of the internal SSE endpoint. Change only on a
  // collision with a real route.
  clientPath: "/__preview_watch",

  // Log level for the background build. Quiet by default.
  logLevel: "warn",

  // Let the background build clear the terminal on each rebuild.
  clearScreen: false,

  // Source watch options: buildDelay, include, exclude, onInvalidate, and
  // chokidar are honored. The plugin debounces rebuilds by 100 ms by default
  // so it reads completed saves; set buildDelay explicitly (including 0) to
  // override that. Other Rollup-only watch options have no effect.
  watch: {},
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `reload` | `boolean \| "manual"` | `true` | `true` auto full-page reloads after each rebuild; `"manual"` shows a click-to-reload toast; `false` disables injection. |
| `onRebuild` | `(info: RebuildInfo) => void` | none | Server-side hook run after every rebuild cycle. |
| `overlay` | `boolean` | `true` | Show a browser overlay (with a "Reload" button) on build failure. |
| `reconnect` | `boolean` | `true` | Treat an SSE reconnect after a dropped connection as a fresh rebuild; `false` makes reconnection a no-op. |
| `clientPath` | `string` | `"/__preview_watch"` | SSE endpoint path, relative to `base`. |
| `logLevel` | `LogLevel` | `"warn"` | Log level of the background build. |
| `clearScreen` | `boolean` | `false` | Let the background build clear the terminal. |
| `watch` | `Rollup.WatcherOptions` | `{ buildDelay: 100 }` | Controls the source watcher; `buildDelay`, `include`, `exclude`, `onInvalidate`, and `chokidar` are honored. The default delay coalesces a save's filesystem-event burst. |

## Limitations

- The reload is a **full page reload**, not HMR. That is intentional - the point
  is to reflect the production build faithfully.
- Rebuilds run a fresh Rollup production build, so they are slower than dev-mode
  HMR. That is the cost of previewing the real bundle without stale framework
  compilation caches.
- Client injection targets HTML documents served from `outDir` (SPA index
  fallback and explicit `*.html` for MPA). Unusual `base`/`appType` setups may
  need `clientPath` tuning.
- The injected HTML response is produced before Vite's internal compression
  middleware, so those specific responses are served uncompressed.
- Function-style `preview.cors.origin` is not supported: the plugin's own
  responses cannot call it synchronously, so they carry no CORS headers in that
  configuration.

## License

MIT
