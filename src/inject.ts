import { extname, join, normalize, sep } from "node:path";

/**
 * Strip the resolved `base` prefix from a request URL and return the remaining
 * root-relative path (always starting with `/`). Returns `null` when the URL
 * falls outside `base` (those requests are none of our business).
 *
 * @param url  Raw request URL, may include query/hash (kept as-is here).
 * @param base Resolved Vite base, always ends with `/` (e.g. `/` or `/app/`).
 */
export function stripBase(url: string, base: string): string | null {
  if (base === "/") return url.startsWith("/") ? url : "/" + url;
  // `/app` (no trailing slash) is the base root as well.
  if (url === base.slice(0, -1)) return "/";
  if (url.startsWith(base)) return "/" + url.slice(base.length);
  return null;
}

/**
 * Decide whether the plugin should serve an `index.html` SPA fallback for
 * extensionless routes, based on Vite's resolved `appType`.
 *
 * Vite's `appType` is `"spa" | "mpa" | "custom"` (undefined resolves to the
 * `"spa"` default). Only genuine SPAs get the fallback:
 *
 * - `"spa"` / `undefined` -> `true` (fallback extensionless routes to
 *   `index.html`);
 * - `"mpa"` -> `false` (only explicit `*.html`);
 * - `"custom"` -> `false` (Vite serves no HTML itself; the app owns routing, so
 *   an `index.html` fallback would be wrong).
 *
 * @param appType Vite's resolved `config.appType`.
 */
export function isSpaAppType(appType: string | undefined): boolean {
  return appType !== "mpa" && appType !== "custom";
}

/**
 * Map a root-relative pathname to the on-disk HTML file that a preview request
 * would resolve to, or `null` if the request is not for an HTML document.
 *
 * - `/` and any `/dir/` map to the corresponding `index.html`.
 * - Explicit `*.html` paths map straight through (MPA support).
 * - Extensionless paths (client-side routes) fall back to the root
 *   `index.html`, but only for SPAs - MPAs get `null` so the static server can
 *   return a real 404.
 *
 * The result is guaranteed to stay inside `outDirAbs` (path-traversal guard).
 *
 * @param pathname  Root-relative path with no query/hash.
 * @param outDirAbs Absolute path of the build output directory.
 * @param spa       Whether the app is served as a single-page app.
 */
export function resolveHtmlFile(
  pathname: string,
  outDirAbs: string,
  spa: boolean,
): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel.endsWith("/")) rel += "index.html";

  const ext = extname(rel);
  let candidate: string;
  if (ext === ".html") {
    candidate = rel;
  } else if (ext === "") {
    if (!spa) return null;
    candidate = "/index.html";
  } else {
    return null;
  }

  const abs = normalize(join(outDirAbs, candidate));
  if (abs !== outDirAbs && !abs.startsWith(outDirAbs + sep)) return null;
  return abs;
}

/**
 * Insert `snippet` into an HTML document. Prefers just before `</body>`, falls
 * back to before `</html>`, and finally appends. Only the first match is
 * replaced.
 */
export function injectSnippet(html: string, snippet: string): string {
  if (html.includes("</body>")) return html.replace("</body>", snippet + "</body>");
  if (html.includes("</html>")) return html.replace("</html>", snippet + "</html>");
  return html + snippet;
}
