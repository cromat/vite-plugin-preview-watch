import { describe, expect, it } from "vitest";
import { formatBuildError } from "../src/error";

describe("formatBuildError", () => {
  it("falls back for null/undefined", () => {
    expect(formatBuildError(null)).toBe("Build failed");
    expect(formatBuildError(undefined)).toBe("Build failed");
  });

  it("returns a plain string as-is", () => {
    expect(formatBuildError("boom")).toBe("boom");
  });

  it("falls back for an empty string", () => {
    expect(formatBuildError("")).toBe("Build failed");
  });

  it("uses the message of a plain Error", () => {
    expect(formatBuildError(new Error("nope"))).toBe("nope");
  });

  it("prefixes the plugin name when present", () => {
    expect(formatBuildError({ plugin: "esbuild", message: "bad token" })).toBe(
      "[esbuild] bad token",
    );
  });

  it("includes file:line:column from loc", () => {
    const out = formatBuildError({
      message: "Unexpected token",
      loc: { file: "/src/main.js", line: 3, column: 7 },
    });
    expect(out).toContain("Unexpected token");
    expect(out).toContain("/src/main.js:3:7");
  });

  it("defaults the column to 0 when only a line is given", () => {
    const out = formatBuildError({
      message: "x",
      loc: { file: "/a.js", line: 5 },
    });
    expect(out).toContain("/a.js:5:0");
  });

  it("falls back to id when loc has no file", () => {
    const out = formatBuildError({ message: "x", id: "/src/x.ts" });
    expect(out).toContain("/src/x.ts");
  });

  it("appends the code frame", () => {
    const out = formatBuildError({
      message: "Unexpected token",
      loc: { file: "/a.js", line: 1, column: 0 },
      frame: "1 | const = 2\n  |       ^",
    });
    expect(out.split("\n").at(-1)).toContain("^");
  });

  it("falls back for an object with no usable fields", () => {
    expect(formatBuildError({})).toBe("Build failed");
    expect(formatBuildError(42)).toBe("Build failed");
  });
});
