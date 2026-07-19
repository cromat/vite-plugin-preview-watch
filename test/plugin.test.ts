import { describe, expect, it } from "vitest";
import { previewWatch } from "../src/plugin";

describe("previewWatch (plugin shape)", () => {
  it("returns a named vite plugin", () => {
    const plugin = previewWatch();
    expect(plugin.name).toBe("vite-plugin-preview-watch");
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
});
