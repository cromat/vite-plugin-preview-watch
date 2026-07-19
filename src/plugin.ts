import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ServerResponse } from "node:http";
import { build } from "vite";
import type { Plugin, PreviewServer, Rollup } from "vite";
import { joinClientUrl, renderClientScript } from "./client";
import { injectSnippet, resolveHtmlFile, stripBase } from "./inject";
import { resolveOptions, type PreviewWatchOptions } from "./options";

const PLUGIN_NAME = "vite-plugin-preview-watch";

/**
 * Vite plugin that adds a watch mode to `vite preview`: it rebuilds the output
 * directory whenever your source changes and full-page reloads any open preview
 * tabs, so the production build you are previewing stays fresh without a manual
 * `vite build` + refresh.
 *
 * The plugin is inert during `vite dev` and `vite build`; all of its behaviour
 * lives in the `configurePreviewServer` hook.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from "vite";
 * import { previewWatch } from "vite-plugin-preview-watch";
 *
 * export default defineConfig({
 *   plugins: [previewWatch()],
 * });
 * ```
 */
export function previewWatch(options: PreviewWatchOptions = {}): Plugin {
  const opts = resolveOptions(options);

  return {
    name: PLUGIN_NAME,
    // Active for `dev` and `preview` (both resolve with command "serve") but
    // excluded from the nested `build()` we spawn below, so there is no
    // recursion and no duplicate work.
    apply: "serve",

    async configurePreviewServer(server: PreviewServer) {
      const config = server.config;
      const base = config.base;
      const outDirAbs = resolve(config.root, config.build.outDir);
      const isSpa = config.appType !== "mpa";

      // ---- background rebuild -------------------------------------------
      // Re-run the production build in watch mode. This writes into the same
      // outDir the preview server serves from, so every source change lands in
      // the served bundle.
      const watcher = (await build({
        root: config.root,
        base,
        mode: config.mode,
        configFile: config.configFile,
        logLevel: opts.logLevel,
        clearScreen: false,
        build: { watch: opts.watch },
      })) as Rollup.RollupWatcher;

      // ---- reload wiring -------------------------------------------------
      const clients = new Set<ServerResponse>();

      const notifyReload = (): void => {
        for (const client of clients) {
          client.write("event: reload\ndata: {}\n\n");
        }
      };

      watcher.on("event", (event) => {
        // "END" fires after every successful (re)build. Vite already logs
        // build errors itself; we simply keep the preview server alive.
        if (event.code === "END" && opts.reload) notifyReload();
      });

      if (opts.reload) {
        const snippet = renderClientScript(joinClientUrl(base, opts.clientPath));

        // SSE endpoint the injected client subscribes to.
        server.middlewares.use((req, res, next) => {
          const stripped = stripBase(req.url ?? "", base);
          if (stripped === null) return next();
          if (stripped.split("?")[0] !== opts.clientPath) return next();

          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          });
          res.write("retry: 1000\n\n");
          clients.add(res);

          // Comment pings keep proxies from dropping the idle connection.
          const ping = setInterval(() => res.write(": ping\n\n"), 30000);
          req.on("close", () => {
            clearInterval(ping);
            clients.delete(res);
          });
        });

        // Inject the reload client into served HTML documents. Runs before the
        // internal static file server so it can short-circuit HTML responses.
        server.middlewares.use((req, res, next) => {
          if (req.method !== "GET" && req.method !== "HEAD") return next();
          const stripped = stripBase(req.url ?? "", base);
          if (stripped === null) return next();

          const pathname = stripped.split("?")[0].split("#")[0];
          const htmlFile = resolveHtmlFile(pathname, outDirAbs, isSpa);
          if (!htmlFile) return next();

          let html: string;
          try {
            html = readFileSync(htmlFile, "utf8");
          } catch {
            // Missing file: let the static server produce the real 404.
            return next();
          }

          const body = injectSnippet(html, snippet);
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache");
          res.end(req.method === "HEAD" ? undefined : body);
        });
      }

      // ---- teardown ------------------------------------------------------
      const close = (): void => {
        void watcher.close();
        for (const client of clients) client.end();
        clients.clear();
      };
      server.httpServer.once("close", close);
    },
  };
}
