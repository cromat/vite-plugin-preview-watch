import type { LogLevel, Rollup } from "vite";

/** Outcome of one background rebuild cycle, passed to `onRebuild`. */
export interface RebuildInfo {
  /** Whether the cycle finished without a build error. */
  ok: boolean;
  /** The build error for failed cycles, `null` otherwise. */
  error: unknown;
  /** Wall-clock duration of the cycle in milliseconds. */
  durationMs: number;
}

/**
 * Options for {@link previewWatch}. Every field is optional; see
 * {@link resolveOptions} for the defaults.
 */
export interface PreviewWatchOptions {
  /**
   * What to do in connected preview tabs after a successful rebuild:
   *
   * - `true` - full-page reload automatically;
   * - `"manual"` - show a small "Rebuilt - click to reload" toast instead of
   *   reloading, so in-page state (scroll, form input) survives until you opt
   *   in;
   * - `false` - the plugin still rebuilds `dist/` on source changes but does
   *   not inject the client and does not touch served HTML.
   *
   * @default true
   */
  reload?: boolean | "manual";

  /**
   * Called on the server after every rebuild cycle, successful or not. Runs
   * regardless of the `reload` setting. Exceptions thrown here are caught and
   * logged so they cannot take down the preview server.
   */
  onRebuild?: (info: RebuildInfo) => void;

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
   * Show a full-screen overlay in the browser when a rebuild fails, instead of
   * silently keeping the previous bundle on screen. The overlay is cleared on
   * the next successful rebuild. Has no effect when {@link reload} is `false`.
   *
   * @default true
   */
  overlay?: boolean;

  /**
   * React when the SSE connection reconnects after a drop. When `true`, an
   * `open` event that follows a dropped connection is treated as a fresh
   * rebuild (auto-reload, or toast in `"manual"` mode), because the preview
   * server may have restarted with a changed bundle while the tab was not
   * listening. Set to `false` to make reconnection a no-op - useful when the
   * preview server is restarted often on purpose (e.g. behind a supervisor)
   * and you do not want those restarts to reload open tabs. Has no effect when
   * {@link reload} is `false`.
   *
   * @default true
   */
  reconnect?: boolean;

  /**
   * Let the background build clear the terminal on each rebuild. Off by default
   * so the preview server's own output stays visible.
   *
   * @default false
   */
  clearScreen?: boolean;

  /**
   * Source watch options: `buildDelay`, `include`, `exclude`, `onInvalidate`,
   * and `chokidar` are honored. Unless specified here, rebuilds are debounced
   * by 100 ms so the watcher reads completed file saves. Other Rollup-only
   * watch options have no effect because the plugin runs a separate fresh build
   * to write preview output.
   *
   * @default { buildDelay: 100 }
   */
  watch?: Rollup.WatcherOptions;
}

/** Fully-defaulted options, produced by {@link resolveOptions}. */
export interface ResolvedPreviewWatchOptions {
  /** `true` is normalized to `"auto"`. */
  reload: "auto" | "manual" | false;
  onRebuild: ((info: RebuildInfo) => void) | null;
  clientPath: string;
  logLevel: LogLevel;
  overlay: boolean;
  reconnect: boolean;
  clearScreen: boolean;
  watch: Rollup.WatcherOptions;
}

/**
 * Apply defaults to user-supplied options. `clientPath` is normalized to start
 * with a single leading slash so it can be compared against request pathnames;
 * `reload: true` is normalized to `"auto"`.
 */
export function resolveOptions(
  options: PreviewWatchOptions = {},
): ResolvedPreviewWatchOptions {
  const clientPath = options.clientPath ?? "/__preview_watch";
  const reload = options.reload ?? true;
  return {
    reload: reload === true ? "auto" : reload,
    onRebuild: options.onRebuild ?? null,
    clientPath: "/" + clientPath.replace(/^\/+/, ""),
    logLevel: options.logLevel ?? "warn",
    overlay: options.overlay ?? true,
    reconnect: options.reconnect ?? true,
    clearScreen: options.clearScreen ?? false,
    watch: options.watch ?? {},
  };
}
