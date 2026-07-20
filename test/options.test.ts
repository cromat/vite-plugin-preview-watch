import { describe, expect, it } from "vitest";
import { resolveOptions } from "../src/options";

describe("resolveOptions", () => {
  it("applies defaults for an empty object", () => {
    expect(resolveOptions()).toEqual({
      reload: "auto",
      onRebuild: null,
      clientPath: "/__preview_watch",
      logLevel: "warn",
      overlay: true,
      reconnect: true,
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

  it("converts reload: true to auto", () => {
    expect(resolveOptions({ reload: true }).reload).toBe("auto");
  });

  it("passes through reload: manual", () => {
    expect(resolveOptions({ reload: "manual" }).reload).toBe("manual");
  });

  it("passes through reload: false", () => {
    expect(resolveOptions({ reload: false }).reload).toBe(false);
  });

  it("passes through onRebuild function", () => {
    const fn = () => {};
    expect(resolveOptions({ onRebuild: fn }).onRebuild).toBe(fn);
  });

  it("defaults reconnect to true", () => {
    expect(resolveOptions().reconnect).toBe(true);
    expect(resolveOptions({}).reconnect).toBe(true);
  });

  it("allows disabling reconnect", () => {
    expect(resolveOptions({ reconnect: false }).reconnect).toBe(false);
  });

  it("passes through reconnect: true", () => {
    expect(resolveOptions({ reconnect: true }).reconnect).toBe(true);
  });
});
