import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { build, createFilter, watchFiles } = vi.hoisted(() => ({
  build: vi.fn(),
  createFilter: vi.fn(),
  watchFiles: vi.fn(),
}));

vi.mock("vite", () => ({ build, createFilter }));
vi.mock("chokidar", () => ({ watch: watchFiles }));

import { previewWatch } from "../src/plugin";

async function configurePreviewServer(
  plugin: ReturnType<typeof previewWatch>,
): Promise<void> {
  const hook = plugin.configurePreviewServer;
  if (!hook) throw new Error("Expected configurePreviewServer hook");
  if (typeof hook === "function") {
    await hook(previewServer as never);
  } else {
    await hook.handler(previewServer as never);
  }
}

const sourceWatcher = {
  close: vi.fn(),
  on: vi.fn(),
  once: vi.fn((event: string, listener: () => void) => {
    if (event === "ready") queueMicrotask(listener);
  }),
};

const previewServer = {
  config: {
    root: "/project",
    base: "/",
    cacheDir: "/project/node_modules/.vite",
    mode: "production",
    configFile: "/project/vite.config.ts",
    configFileDependencies: [],
    build: { outDir: "dist" },
    preview: {},
  },
  middlewares: { use: vi.fn() },
  httpServer: { once: vi.fn() },
};

describe("previewWatch (plugin shape)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    build.mockResolvedValue(undefined);
    createFilter.mockReturnValue(() => true);
    watchFiles.mockReturnValue(sourceWatcher);
  });

  afterEach(() => vi.useRealTimers());

  it("returns a named vite plugin", () => {
    const plugin = previewWatch();
    expect(plugin.name).toBe("vite-plugin-preview-xwatch");
  });

  it("only applies on the serve command", () => {
    expect(previewWatch().apply).toBe("serve");
  });

  it("exposes a configurePreviewServer hook", () => {
    expect(typeof previewWatch().configurePreviewServer).toBe("function");
  });

  it("accepts options without throwing", () => {
    expect(() =>
      previewWatch({ reload: false, clientPath: "/x", logLevel: "silent" }),
    ).not.toThrow();
  });

  it("watches the project source tree with Chokidar", async () => {
    await configurePreviewServer(previewWatch({ reload: false }));

    expect(watchFiles).toHaveBeenCalledWith(
      ["/project", "/project/vite.config.ts"],
      expect.objectContaining({
        ignoreInitial: true,
        ignorePermissionErrors: true,
        persistent: true,
      }),
    );
    expect(build).toHaveBeenLastCalledWith(
      expect.objectContaining({ build: { watch: false } }),
    );
  });

  it("honors an explicit zero build delay", async () => {
    let onAll: ((event: string, path: string) => void) | undefined;
    sourceWatcher.on.mockImplementation((event: string, listener: () => void) => {
      if (event === "all") onAll = listener as (event: string, path: string) => void;
    });
    await configurePreviewServer(previewWatch({ reload: false, watch: { buildDelay: 0 } }));
    const buildCalls = build.mock.calls.length;

    onAll?.("change", "/project/src/example.ts");
    await new Promise((resolve) => setTimeout(resolve));
    expect(build).toHaveBeenCalledTimes(buildCalls + 1);
  });

  it("waits for the initial source scan before preview startup completes", async () => {
    let onReady: (() => void) | undefined;
    sourceWatcher.once.mockImplementation((event: string, listener: () => void) => {
      if (event === "ready") onReady = listener;
    });

    let configured = false;
    const configuring = configurePreviewServer(previewWatch({ reload: false })).then(() => {
      configured = true;
    });

    await vi.waitFor(() => expect(onReady).toBeTypeOf("function"));
    expect(configured).toBe(false);

    onReady?.();
    await configuring;
    expect(configured).toBe(true);
  });
});
