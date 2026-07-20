import { describe, expect, it } from "vitest";
import { join, sep } from "node:path";
import {
  injectSnippet,
  isSpaAppType,
  resolveHtmlFile,
  stripBase,
} from "../src/inject";

describe("stripBase", () => {
  it("returns the url unchanged for root base", () => {
    expect(stripBase("/foo?x=1", "/")).toBe("/foo?x=1");
  });

  it("adds a leading slash when missing on root base", () => {
    expect(stripBase("foo", "/")).toBe("/foo");
  });

  it("strips a non-root base prefix", () => {
    expect(stripBase("/app/foo", "/app/")).toBe("/foo");
  });

  it("treats the base root without trailing slash as '/'", () => {
    expect(stripBase("/app", "/app/")).toBe("/");
  });

  it("returns null for urls outside the base", () => {
    expect(stripBase("/other/foo", "/app/")).toBeNull();
  });
});

describe("isSpaAppType", () => {
  it("treats undefined (Vite's default) as SPA", () => {
    expect(isSpaAppType(undefined)).toBe(true);
  });

  it("treats 'spa' as SPA", () => {
    expect(isSpaAppType("spa")).toBe(true);
  });

  it("treats 'mpa' as not SPA (explicit *.html only)", () => {
    expect(isSpaAppType("mpa")).toBe(false);
  });

  it("treats 'custom' as not SPA (no index.html fallback)", () => {
    expect(isSpaAppType("custom")).toBe(false);
  });
});

describe("resolveHtmlFile", () => {
  const outDir = join("/project", "dist");

  it("maps '/' to index.html", () => {
    expect(resolveHtmlFile("/", outDir, true)).toBe(join(outDir, "index.html"));
  });

  it("maps a directory path to its index.html", () => {
    expect(resolveHtmlFile("/docs/", outDir, true)).toBe(
      join(outDir, "docs", "index.html"),
    );
  });

  it("maps an explicit .html path straight through (MPA)", () => {
    expect(resolveHtmlFile("/about.html", outDir, false)).toBe(
      join(outDir, "about.html"),
    );
  });

  it("falls back extensionless SPA routes to root index.html", () => {
    expect(resolveHtmlFile("/dashboard/settings", outDir, true)).toBe(
      join(outDir, "index.html"),
    );
  });

  it("returns null for extensionless routes when not an SPA", () => {
    expect(resolveHtmlFile("/dashboard", outDir, false)).toBeNull();
  });

  it("does not fall back to index.html for appType 'custom'", () => {
    const spa = isSpaAppType("custom");
    // Extensionless route: no SPA fallback for custom.
    expect(resolveHtmlFile("/dashboard", outDir, spa)).toBeNull();
    // Explicit *.html still resolves, exactly as for MPA.
    expect(resolveHtmlFile("/about.html", outDir, spa)).toBe(
      join(outDir, "about.html"),
    );
  });

  it("returns null for non-html assets", () => {
    expect(resolveHtmlFile("/assets/app.js", outDir, true)).toBeNull();
    expect(resolveHtmlFile("/logo.svg", outDir, true)).toBeNull();
  });

  it("guards against path traversal outside outDir", () => {
    expect(resolveHtmlFile("/../secret.html", outDir, true)).toBeNull();
    expect(resolveHtmlFile("/../../etc/passwd.html", outDir, true)).toBeNull();
  });

  it("does not confuse a sibling directory with the same prefix", () => {
    // `/project/dist-secret` must not be treated as inside `/project/dist`.
    const escaped = resolveHtmlFile("/../dist-secret/x.html", outDir, true);
    expect(escaped).toBeNull();
  });

  it("decodes percent-encoded paths", () => {
    expect(resolveHtmlFile("/a%20b.html", outDir, false)).toBe(
      join(outDir, "a b.html"),
    );
  });

  it("returns null for malformed percent-encoding", () => {
    expect(resolveHtmlFile("/%ZZ.html", outDir, true)).toBeNull();
  });

  it("keeps the result inside outDir on this platform", () => {
    const file = resolveHtmlFile("/nested/page.html", outDir, false);
    expect(file).toBe(join(outDir, "nested", "page.html"));
    expect(file?.startsWith(outDir + sep)).toBe(true);
  });
});

describe("injectSnippet", () => {
  const snippet = "<script>1</script>";

  it("injects before </body>", () => {
    expect(injectSnippet("<body>hi</body>", snippet)).toBe(
      "<body>hi" + snippet + "</body>",
    );
  });

  it("falls back to </html> when there is no body", () => {
    expect(injectSnippet("<html>hi</html>", snippet)).toBe(
      "<html>hi" + snippet + "</html>",
    );
  });

  it("appends when neither body nor html is present", () => {
    expect(injectSnippet("<p>hi</p>", snippet)).toBe("<p>hi</p>" + snippet);
  });

  it("only injects at the first closing body tag", () => {
    const out = injectSnippet("<body>a</body><body>b</body>", snippet);
    expect(out).toBe("<body>a" + snippet + "</body><body>b</body>");
  });
});
