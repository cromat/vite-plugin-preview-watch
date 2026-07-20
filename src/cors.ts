/**
 * The subset of Vite's `preview.cors` shapes we understand. Mirrors the
 * semantics of the `cors` middleware package for the common cases; function
 * origins are not supported (we cannot call them synchronously) and yield no
 * headers.
 */
export interface CorsOptionsLike {
  origin?: boolean | string | RegExp | Array<string | RegExp> | unknown;
  credentials?: boolean;
}

export type PreviewCors = boolean | CorsOptionsLike | null | undefined;

function originMatches(
  origin: string | RegExp | unknown,
  requestOrigin: string,
): boolean {
  if (typeof origin === "string") return origin === requestOrigin;
  if (origin instanceof RegExp) {
    // A user regex with the `g` or `y` flag is stateful: `test()` advances
    // `lastIndex`, so consecutive requests would alternate between matching
    // and not matching. Reset it around the call to stay stateless.
    const stateful = origin.global || origin.sticky;
    if (stateful) origin.lastIndex = 0;
    const matched = origin.test(requestOrigin);
    if (stateful) origin.lastIndex = 0;
    return matched;
  }
  return false;
}

/**
 * Compute the CORS response headers our short-circuited responses (injected
 * HTML, SSE) should carry, mirroring the preview server's `cors` config that
 * Vite's own middleware would have applied further down the stack.
 *
 * Returns an empty object when CORS is disabled or the request origin is not
 * allowed. When the allowed origin is reflected (rather than `*`), a
 * `Vary: Origin` header is included so caches key on the origin.
 */
export function resolveCorsHeaders(
  cors: PreviewCors,
  requestOrigin: string | undefined,
): Record<string, string> {
  if (!cors) return {};

  const options: CorsOptionsLike = cors === true ? {} : cors;
  const origin = options.origin ?? "*";
  const headers: Record<string, string> = {};

  if (origin === "*") {
    headers["Access-Control-Allow-Origin"] = "*";
  } else if (origin === true) {
    // Reflect whatever origin the request carries.
    if (!requestOrigin) return {};
    headers["Access-Control-Allow-Origin"] = requestOrigin;
    headers["Vary"] = "Origin";
  } else {
    if (!requestOrigin) return {};
    const allowed = Array.isArray(origin)
      ? origin.some((o) => originMatches(o, requestOrigin))
      : originMatches(origin, requestOrigin);
    if (!allowed) return {};
    headers["Access-Control-Allow-Origin"] = requestOrigin;
    headers["Vary"] = "Origin";
  }

  if (options.credentials === true) {
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}
