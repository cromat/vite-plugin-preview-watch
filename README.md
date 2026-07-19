# vite-plugin-preview-watch

Watch mode for `vite preview`. It rebuilds your production bundle whenever the
source changes and full-page reloads any open preview tabs, so the build you are
previewing stays fresh - no manual `vite build` + refresh loop.

Use it when you specifically want to look at the **production** output (minified
assets, real `base`, hashed filenames, service worker, SSR/edge output) while
still iterating. For regular development, the dev server and its HMR remain the
right tool; this plugin is deliberately about the production build.

Implements the long-standing request in
[vitejs/vite#5196](https://github.com/vitejs/vite/issues/5196) as a plugin.

- Zero runtime dependencies (`vite` is a peer dependency).
- Full-page reload over Server-Sent Events - no client library to install.
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

1. Starts a background `vite build` in Rollup watch mode, writing into the same
   `outDir` the preview server serves from.
2. Registers a Server-Sent Events endpoint and injects a tiny client script into
   served HTML documents.
3. On every successful rebuild, pushes a `reload` event; the client does a
   `location.reload()`.

Everything is torn down when the preview server closes.

## Options

```ts
previewWatch({
  // Full-page reload open tabs after each rebuild. When false, the plugin still
  // rebuilds on change but injects nothing and never reloads.
  reload: true,

  // Path (relative to `base`) of the internal SSE endpoint. Change only on a
  // collision with a real route.
  clientPath: "/__preview_watch",

  // Log level for the background build. Quiet by default.
  logLevel: "warn",

  // Rollup watch options forwarded to build.watch (e.g. exclude globs).
  watch: {},
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `reload` | `boolean` | `true` | Auto full-page reload after each rebuild. |
| `clientPath` | `string` | `"/__preview_watch"` | SSE endpoint path, relative to `base`. |
| `logLevel` | `LogLevel` | `"warn"` | Log level of the background build. |
| `watch` | `Rollup.WatcherOptions` | `{}` | Forwarded to `build.watch`. |

## Limitations

- The reload is a **full page reload**, not HMR. That is intentional - the point
  is to reflect the production build faithfully.
- Rebuilds run the full Rollup production build, so they are slower than dev-mode
  HMR. That is the cost of previewing the real bundle.
- Client injection targets HTML documents served from `outDir` (SPA index
  fallback and explicit `*.html` for MPA). Unusual `base`/`appType` setups may
  need `clientPath` tuning.
- The injected HTML response is produced before Vite's internal compression
  middleware, so those specific responses are served uncompressed.

## License

MIT
