import type { LogLevel, Rollup } from "vite";

/**
 * Options for {@link previewWatch}. Every field is optional; see
 * {@link resolveOptions} for the defaults.
 */
export interface PreviewWatchOptions {
  /**
   * Automatically full-page reload connected preview tabs after every
   * successful rebuild. When `false`, the plugin still rebuilds `dist/` on
   * source changes but does not inject the reload client and does not touch
   * served HTML.
   *
   * @default true
   */
  reload?: boolean;

  /**
   * Path (relative to the resolved `base`) of the internal Server-Sent Events
   * endpoint the reload client connects to. Change it only if it collides with
   * a real route in your app.
   *
   * @default "/__preview_watch"
   */
  clientPath?: string;

  /**
   * Log level for the background `vite build --watch` process. Kept quiet by
   * default so the preview terminal is not flooded on every rebuild.
   *
   * @default "warn"
   */
  logLevel?: LogLevel;

  /**
   * Rollup watch options forwarded to the background build (e.g. `exclude`,
   * `chokidar`). Merged into `build.watch`.
   *
   * @default {}
   */
  watch?: Rollup.WatcherOptions;
}

/** Fully-defaulted options, produced by {@link resolveOptions}. */
export interface ResolvedPreviewWatchOptions {
  reload: boolean;
  clientPath: string;
  logLevel: LogLevel;
  watch: Rollup.WatcherOptions;
}

/**
 * Apply defaults to user-supplied options. `clientPath` is normalized to start
 * with a single leading slash so it can be compared against request pathnames.
 */
export function resolveOptions(
  options: PreviewWatchOptions = {},
): ResolvedPreviewWatchOptions {
  const clientPath = options.clientPath ?? "/__preview_watch";
  return {
    reload: options.reload ?? true,
    clientPath: "/" + clientPath.replace(/^\/+/, ""),
    logLevel: options.logLevel ?? "warn",
    watch: options.watch ?? {},
  };
}
