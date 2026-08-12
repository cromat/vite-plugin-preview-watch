import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { previewWatch } from "../src/plugin";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 10_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out waiting for rebuild")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

describe("previewWatch (background watcher)", () => {
  const fixtures: string[] = [];

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => rm(fixture, { force: true, recursive: true })));
  });

  it("delays a rebuild and writes the latest saved source", async () => {
    const root = await mkdtemp(join(tmpdir(), "preview-watch-"));
    fixtures.push(root);
    await writeFile(join(root, "index.html"), "<p>first</p>");

    const initialBuild = deferred<void>();
    const rebuild = deferred<{ durationMs: number; source: string }>();
    let completedBuilds = 0;
    let changedAt = 0;
    let close: (() => void) | undefined;
    const plugin = previewWatch({
      logLevel: "silent",
      reload: false,
      watch: { buildDelay: 250 },
      onRebuild: ({ error, ok }) => {
        if (!ok) {
          const failure = error instanceof Error ? error : new Error(String(error));
          initialBuild.reject(failure);
          rebuild.reject(failure);
          return;
        }

        completedBuilds += 1;
        if (completedBuilds === 1) {
          initialBuild.resolve();
          return;
        }

        void readFile(join(root, "dist", "index.html"), "utf8").then((source) => {
          rebuild.resolve({ durationMs: Date.now() - changedAt, source });
        }, rebuild.reject);
      },
    });
    const hook = plugin.configurePreviewServer;
    if (!hook) throw new Error("Expected configurePreviewServer hook");
    const configurePreviewServer = typeof hook === "function" ? hook : hook.handler;

    await configurePreviewServer({
      config: {
        appType: "spa",
        base: "/",
        build: { outDir: "dist" },
        cacheDir: join(root, "node_modules", ".vite"),
        configFile: false,
        configFileDependencies: [],
        mode: "production",
        preview: {},
        root,
      },
      httpServer: {
        once: (_event: string, listener: () => void) => {
          close = listener;
        },
      },
      middlewares: { use: () => undefined },
    } as never);

    await withTimeout(initialBuild.promise);
    changedAt = Date.now();
    await writeFile(join(root, "index.html"), "<p>latest</p>");

    const result = await withTimeout(rebuild.promise);
    close?.();

    expect(result.durationMs).toBeGreaterThanOrEqual(200);
    expect(result.source).toContain("<p>latest</p>");
  });

  it("does not reuse a framework plugin's stale watch cache for output", async () => {
    const root = await mkdtemp(join(tmpdir(), "preview-watch-"));
    fixtures.push(root);
    await writeFile(
      join(root, "index.html"),
      '<script type="module" src="/main.js"></script>',
    );
    await writeFile(
      join(root, "main.js"),
      'const message = "first"; document.body.textContent = message;',
    );
    // This deliberately returns the preceding source whenever the same plugin
    // instance sees a second transform. It models a framework plugin retaining
    // stale compilation state across Rollup watch cycles.
    await writeFile(
      join(root, "vite.config.mjs"),
      `let previousSource;
export default {
  build: { watch: { buildDelay: 0 } },
  plugins: [{
    name: "stale-transform-cache",
    transform(code, id) {
      if (!id.endsWith("/main.js")) return null;
      const transformed = previousSource ?? code;
      previousSource = code;
      return transformed;
    },
  }],
};
`,
    );

    const initialBuild = deferred<void>();
    const rebuild = deferred<void>();
    let completedBuilds = 0;
    let close: (() => void) | undefined;
    const plugin = previewWatch({
      logLevel: "silent",
      reload: false,
      watch: { buildDelay: 0 },
      onRebuild: ({ error, ok }) => {
        if (!ok) {
          const failure = error instanceof Error ? error : new Error(String(error));
          initialBuild.reject(failure);
          rebuild.reject(failure);
          return;
        }
        completedBuilds += 1;
        if (completedBuilds === 1) initialBuild.resolve();
        else rebuild.resolve();
      },
    });
    const hook = plugin.configurePreviewServer;
    if (!hook) throw new Error("Expected configurePreviewServer hook");
    const configurePreviewServer = typeof hook === "function" ? hook : hook.handler;

    await configurePreviewServer({
      config: {
        appType: "spa",
        base: "/",
        build: { outDir: "dist" },
        cacheDir: join(root, "node_modules", ".vite"),
        configFile: join(root, "vite.config.mjs"),
        configFileDependencies: [join(root, "vite.config.mjs")],
        mode: "production",
        preview: {},
        root,
      },
      httpServer: {
        once: (_event: string, listener: () => void) => {
          close = listener;
        },
      },
      middlewares: { use: () => undefined },
    } as never);

    try {
      await withTimeout(initialBuild.promise);
      await writeFile(
        join(root, "main.js"),
        'const message = "latest"; document.body.textContent = message;',
      );
      await withTimeout(rebuild.promise);

      const html = await readFile(join(root, "dist", "index.html"), "utf8");
      const scriptPath = html.match(/src="\/([^"?]+)(?:\?[^\"]*)?"/)?.[1];
      if (!scriptPath) throw new Error("Expected built JavaScript entry in index.html");
      const output = await readFile(join(root, "dist", scriptPath), "utf8");
      expect(output).toContain('"latest"');
    } finally {
      close?.();
    }
  });

  it("detects an external template a build-mode framework plugin does not watch", async () => {
    const root = await mkdtemp(join(tmpdir(), "preview-watch-"));
    fixtures.push(root);
    const templatePath = join(root, "app.component.html");
    const configPath = join(root, "vite.config.mjs");
    await writeFile(
      join(root, "index.html"),
      '<script type="module" src="/main.js"></script>',
    );
    await writeFile(
      join(root, "main.js"),
      'const template = "__TEMPLATE__"; document.body.innerHTML = template;',
    );
    await writeFile(templatePath, "<p>first</p>");
    // This mirrors a build-mode Angular-style plugin: it reads an external
    // template but intentionally does not call this.addWatchFile(template).
    // The cached result also makes a persistent watcher one revision behind.
    await writeFile(
      configPath,
      `import { readFileSync } from "node:fs";
let previousSource;
const templatePath = ${JSON.stringify(templatePath)};
export default {
  plugins: [{
    name: "external-template-without-watch-file",
    transform(code, id) {
      if (!id.endsWith("/main.js")) return null;
      const source = code.replace(
        '"__TEMPLATE__"',
        JSON.stringify(readFileSync(templatePath, "utf8")),
      );
      const transformed = previousSource ?? source;
      previousSource = source;
      return transformed;
    },
  }],
};
`,
    );

    const initialBuild = deferred<void>();
    const rebuild = deferred<void>();
    let completedBuilds = 0;
    let close: (() => void) | undefined;
    const plugin = previewWatch({
      logLevel: "silent",
      reload: false,
      watch: { buildDelay: 0 },
      onRebuild: ({ error, ok }) => {
        if (!ok) {
          const failure = error instanceof Error ? error : new Error(String(error));
          initialBuild.reject(failure);
          rebuild.reject(failure);
          return;
        }
        completedBuilds += 1;
        if (completedBuilds === 1) initialBuild.resolve();
        else rebuild.resolve();
      },
    });
    const hook = plugin.configurePreviewServer;
    if (!hook) throw new Error("Expected configurePreviewServer hook");
    const configurePreviewServer = typeof hook === "function" ? hook : hook.handler;

    await configurePreviewServer({
      config: {
        appType: "spa",
        base: "/",
        build: { outDir: "dist" },
        cacheDir: join(root, "node_modules", ".vite"),
        configFile: configPath,
        configFileDependencies: [configPath],
        mode: "production",
        preview: {},
        root,
      },
      httpServer: {
        once: (_event: string, listener: () => void) => {
          close = listener;
        },
      },
      middlewares: { use: () => undefined },
    } as never);

    try {
      await withTimeout(initialBuild.promise);
      await writeFile(templatePath, "<p>latest template</p>");
      await withTimeout(rebuild.promise);

      const html = await readFile(join(root, "dist", "index.html"), "utf8");
      const scriptPath = html.match(/src="\/([^"?]+)(?:\?[^\"]*)?"/)?.[1];
      if (!scriptPath) throw new Error("Expected built JavaScript entry in index.html");
      const output = await readFile(join(root, "dist", scriptPath), "utf8");
      expect(output).toContain("latest template");
    } finally {
      close?.();
    }
  });

  it("does not loop when Vite loads an ESM vite.config.mts", async () => {
    const root = await mkdtemp(join(tmpdir(), "preview-watch-"));
    fixtures.push(root);
    const configPath = join(root, "vite.config.mts");
    await writeFile(join(root, "index.html"), "<p>config mts</p>");
    await writeFile(configPath, "export default {};\n");
    // Vite writes bundled ESM configs to node_modules/.vite-temp when this
    // directory is available, which is the normal installed-project case.
    await mkdir(join(root, "node_modules"));

    let completedBuilds = 0;
    const buildErrors: unknown[] = [];
    let close: (() => void) | undefined;
    const plugin = previewWatch({
      logLevel: "silent",
      reload: false,
      watch: { buildDelay: 0 },
      onRebuild: ({ error, ok }) => {
        if (ok) completedBuilds += 1;
        else buildErrors.push(error);
      },
    });
    const hook = plugin.configurePreviewServer;
    if (!hook) throw new Error("Expected configurePreviewServer hook");
    const configurePreviewServer = typeof hook === "function" ? hook : hook.handler;

    const configuring = configurePreviewServer({
      config: {
        appType: "spa",
        base: "/",
        build: { outDir: "dist" },
        cacheDir: join(root, "node_modules", ".vite"),
        configFile: configPath,
        configFileDependencies: [configPath],
        mode: "production",
        preview: {},
        root,
      },
      httpServer: {
        once: (_event: string, listener: () => void) => {
          close = listener;
        },
      },
      middlewares: { use: () => undefined },
    } as never);

    try {
      await withTimeout(Promise.resolve(configuring));
      // Leave enough time for an accidentally observed config temp file to
      // schedule multiple zero-delay builds.
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(buildErrors).toEqual([]);
      expect(completedBuilds).toBe(1);
    } finally {
      close?.();
    }
  });
});
