import "server-only";

/**
 * Whether a request comes from another site's page, as Next itself checks
 * for server actions: being signed in must not let another site's page
 * create products through this browser. A request with no Origin (a script,
 * curl) is not a page's.
 */
export function crossOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  try {
    return new URL(origin).host !== host;
  } catch {
    // "null" (a sandboxed frame) or garbage: not this site.
    return true;
  }
}
