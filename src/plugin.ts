import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ServerResponse } from "node:http";
import { watch as watchFiles } from "chokidar";
import type { Matcher } from "chokidar";
import { build, createFilter } from "vite";
import type { Plugin, PreviewServer, Rollup } from "vite";
import { joinClientUrl, renderClientScript } from "./client";
import { resolveCorsHeaders, type PreviewCors } from "./cors";
import { formatBuildError } from "./error";
import { injectSnippet, isSpaAppType, resolveHtmlFile, stripBase } from "./inject";
import { resolveOptions, type PreviewWatchOptions } from "./options";

const PLUGIN_NAME = "vite-plugin-preview-watch";
// Some editors and framework tooling update a file through several filesystem
// events. Starting Rollup immediately on the first event can make it read the
// previous version while the save is still settling. Keep the delay short so
// normal edits remain responsive, but debounce that burst into one rebuild.
const DEFAULT_BUILD_DELAY_MS = 100;

function toArray<T>(value: T | T[] | null | undefined): T[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

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
      // Vite's appType is "spa" | "mpa" | "custom". Only "spa" (and the
      // undefined default, which resolves to "spa") serves an index.html
      // fallback for extensionless routes. "mpa" serves only explicit *.html,
      // and "custom" does not serve HTML at all - Vite leaves it to the app -
      // so we must not apply the SPA fallback there either. Both non-SPA cases
      // are handled the same way: only explicit *.html requests are injected.
      const isSpa = isSpaAppType(config.appType);
      // Configured preview response headers, minus undefined values (setHeader
      // and writeHead reject those).
      const previewHeaders: Record<string, string | number | string[]> = {};
      for (const [name, value] of Object.entries(config.preview.headers ?? {})) {
        if (value !== undefined) previewHeaders[name] = value;
      }

      // ---- background rebuild -------------------------------------------
      // Watch the source tree directly instead of relying on Rollup's module
      // watch graph. Framework plugins can use external templates or styles
      // without registering them during `vite build --watch`; that means an
      // edit is missed until another watched file changes. Each settled change
      // runs a fresh one-off Vite build, avoiding persistent plugin-instance
      // caches as well.
      //
      // `buildDelay` is retained as the debounce interval. Respect an explicit
      // value (including `0`) supplied by the caller.
      const watchOptions: Rollup.WatcherOptions = {
        ...opts.watch,
        buildDelay: opts.watch.buildDelay ?? DEFAULT_BUILD_DELAY_MS,
      };
      const buildConfig = {
        root: config.root,
        base,
        mode: config.mode,
        configFile: config.configFile,
        logLevel: opts.logLevel,
        clearScreen: opts.clearScreen,
      };
      const fileFilter = createFilter(
        watchOptions.include,
        watchOptions.exclude,
        { resolve: config.root },
      );
      const cacheDirAbs = resolve(config.root, config.cacheDir);
      const configFiles = [
        ...new Set([
          ...(config.configFileDependencies ?? []),
          ...(config.configFile ? [config.configFile] : []),
        ]),
      ];
      const ignored: Matcher[] = [
        "**/.git/**",
        "**/node_modules/**",
        outDirAbs,
        `${outDirAbs}/**`,
        cacheDirAbs,
        `${cacheDirAbs}/**`,
        ...toArray(watchOptions.chokidar?.ignored as Matcher | Matcher[] | undefined),
      ];

      // ---- reload wiring -------------------------------------------------
      const clients = new Set<ServerResponse>();

      const send = (event: string, data?: unknown): void => {
        const payload = data === undefined ? "{}" : JSON.stringify(data);
        for (const client of clients) {
          client.write(`event: ${event}\ndata: ${payload}\n\n`);
        }
      };

      let closed = false;
      let rebuildQueued = false;
      let rebuilding = false;
      let queuedVersion = 0;
      let invalidationVersion = 0;
      let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
      let finishInitialBuild: (() => void) | undefined;
      const initialBuildFinished = new Promise<void>((resolve) => {
        finishInitialBuild = resolve;
      });

      const notifyRebuild = (ok: boolean, error: unknown, durationMs: number): void => {
        if (!opts.onRebuild) return;
        try {
          opts.onRebuild({ ok, error, durationMs });
        } catch (err) {
          console.error(`[${PLUGIN_NAME}] onRebuild threw:`, err);
        }
      };

      const rebuild = async (version: number): Promise<boolean> => {
        if (closed || version !== invalidationVersion) return false;
        const startedAt = Date.now();
        try {
          // `false` (rather than `null`) overrides a build.watch value from
          // the project's config, ensuring this is always a one-off build.
          // Vite accepts `false` at runtime, though its public BuildOptions
          // type only declares an object or null for this field.
          await build({
            ...buildConfig,
            build: { watch: false as unknown as Rollup.WatcherOptions },
          });
          const isCurrent = !closed && version === invalidationVersion;
          if (isCurrent && opts.reload) send("reload");
          if (isCurrent) notifyRebuild(true, null, Date.now() - startedAt);
          return isCurrent;
        } catch (error) {
          const isCurrent = !closed && version === invalidationVersion;
          if (isCurrent && opts.reload && opts.overlay) {
            send("build-error", { message: formatBuildError(error) });
          }
          if (isCurrent) notifyRebuild(false, error, Date.now() - startedAt);
          return isCurrent;
        }
      };

      const runQueuedRebuilds = async (): Promise<void> => {
        if (rebuilding) return;
        rebuilding = true;
        try {
          while (rebuildQueued && !closed) {
            const version = queuedVersion;
            rebuildQueued = false;
            if (await rebuild(version)) {
              finishInitialBuild?.();
              finishInitialBuild = undefined;
            }
          }
        } finally {
          rebuilding = false;
        }
      };

      const queueRebuild = (version: number): void => {
        if (closed) return;
        queuedVersion = version;
        rebuildQueued = true;
        void runQueuedRebuilds();
      };

      const scheduleRebuild = (path: string): void => {
        if (!fileFilter(path) || closed) return;
        invalidationVersion += 1;
        try {
          watchOptions.onInvalidate?.(path);
        } catch (error) {
          console.error(`[${PLUGIN_NAME}] watch.onInvalidate threw:`, error);
        }
        if (rebuildTimer) clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(() => {
          rebuildTimer = undefined;
          queueRebuild(invalidationVersion);
        }, Math.max(0, watchOptions.buildDelay ?? DEFAULT_BUILD_DELAY_MS));
      };

      const sourceWatcher = watchFiles(
        [config.root, ...configFiles],
        {
          ...watchOptions.chokidar,
          ignored,
          ignoreInitial: true,
          ignorePermissionErrors: true,
          persistent: true,
        },
      );
      const sourceWatcherReady = new Promise<void>((resolveReady) => {
        sourceWatcher.once("ready", resolveReady);
      });
      sourceWatcher.on("all", (event, path) => {
        if (
          event === "add" ||
          event === "addDir" ||
          event === "change" ||
          event === "unlink" ||
          event === "unlinkDir"
        ) {
          scheduleRebuild(path);
        }
      });
      sourceWatcher.on("error", (error) => {
        console.error(`[${PLUGIN_NAME}] source watcher error:`, error);
      });

      if (opts.reload) {
        const snippet = renderClientScript(
          joinClientUrl(base, opts.clientPath),
          opts.reload === "manual" ? "manual" : "auto",
          opts.reconnect,
        );

        // SSE endpoint the injected client subscribes to.
        server.middlewares.use((req, res, next) => {
          const stripped = stripBase(req.url ?? "", base);
          if (stripped === null) return next();
          if (stripped.split("?")[0] !== opts.clientPath) return next();

          // Mirror the preview server's configured headers and CORS here too,
          // with our SSE headers last so they win.
          const corsHeaders = resolveCorsHeaders(
            config.preview.cors as PreviewCors,
            req.headers.origin,
          );
          res.writeHead(200, {
            ...previewHeaders,
            ...corsHeaders,
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
          // Mirror the preview server's configured response headers and CORS,
          // then set our own content-type/cache last so they win.
          for (const [name, value] of Object.entries(previewHeaders)) {
            res.setHeader(name, value);
          }
          const corsHeaders = resolveCorsHeaders(
            config.preview.cors as PreviewCors,
            req.headers.origin,
          );
          for (const [name, value] of Object.entries(corsHeaders)) {
            res.setHeader(name, value);
          }
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache");
          res.end(req.method === "HEAD" ? undefined : body);
        });
      }

      // ---- teardown ------------------------------------------------------
      const close = (): void => {
        closed = true;
        if (rebuildTimer) clearTimeout(rebuildTimer);
        rebuildTimer = undefined;
        void sourceWatcher.close();
        for (const client of clients) client.end();
        clients.clear();
        finishInitialBuild?.();
        finishInitialBuild = undefined;
      };
      server.httpServer.once("close", close);

      // Do not begin the initial output build until Chokidar has completed its
      // initial scan. Any source save during that scan is then read by the
      // initial build rather than being accidentally treated as an ignored
      // initial file event.
      await sourceWatcherReady;
      queueRebuild(invalidationVersion);
      await initialBuildFinished;
    },
  };
}
