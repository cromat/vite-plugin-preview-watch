/**
 * The subset of a Rollup/Vite build error we know how to render. All fields are
 * optional because build errors come from many plugins and are not guaranteed
 * to be well-formed.
 */
export interface BuildErrorLike {
  message?: string;
  plugin?: string;
  id?: string;
  loc?: { file?: string; line?: number; column?: number };
  frame?: string;
}

/**
 * Turn an unknown thrown value from a failed build into a single readable,
 * multi-line string suitable for the browser overlay. Combines the plugin name,
 * message, offending file location, and code frame when present.
 */
export function formatBuildError(err: unknown): string {
  if (err == null) return "Build failed";
  if (typeof err === "string") return err || "Build failed";

  const e = err as BuildErrorLike;
  const parts: string[] = [];

  const head = e.plugin
    ? `[${e.plugin}] ${e.message ?? ""}`.trim()
    : (e.message ?? "").trim();
  if (head) parts.push(head);

  const file = e.loc?.file ?? e.id;
  if (file) {
    parts.push(
      e.loc?.line != null ? `${file}:${e.loc.line}:${e.loc.column ?? 0}` : file,
    );
  }

  if (e.frame) parts.push(e.frame);

  return parts.join("\n") || "Build failed";
}
