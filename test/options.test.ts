import { describe, expect, it } from "vitest";
import { resolveOptions } from "../src/options";

describe("resolveOptions", () => {
  it("applies defaults for an empty object", () => {
    expect(resolveOptions()).toEqual({
      reload: true,
      clientPath: "/__preview_watch",
      logLevel: "warn",
      overlay: true,
      clearScreen: false,
      watch: {},
    });
  });

  it("allows disabling the error overlay and toggling clearScreen", () => {
    const resolved = resolveOptions({ overlay: false, clearScreen: true });
    expect(resolved.overlay).toBe(false);
    expect(resolved.clearScreen).toBe(true);
  });

  it("allows disabling reload", () => {
    expect(resolveOptions({ reload: false }).reload).toBe(false);
  });

  it("normalizes clientPath to a single leading slash", () => {
    expect(resolveOptions({ clientPath: "reload" }).clientPath).toBe("/reload");
    expect(resolveOptions({ clientPath: "///reload" }).clientPath).toBe(
      "/reload",
    );
  });

  it("passes through logLevel and watch options", () => {
    const resolved = resolveOptions({
      logLevel: "silent",
      watch: { exclude: ["**/node_modules/**"] },
    });
    expect(resolved.logLevel).toBe("silent");
    expect(resolved.watch).toEqual({ exclude: ["**/node_modules/**"] });
  });
});
