import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import type { Locale } from "@/i18n/config";
import { env } from "@/lib/env";
import { secretMatches } from "@/lib/auth";
import { inLanguage } from "@/server/vetrina/operations/words";
import { VetrinaError } from "@/server/vetrina/source";

/**
 * The Hub's programmatic API (/api/v1/*): the same catalog actions the
 * Vetrina's screens use, for a script or another service. Every request
 * carries `Authorization: Bearer $HUB_API_TOKEN` (unset = the API answers
 * 503). The sign-in (Authelia) lets /api/v1/* through without a session, as
 * it does /api/cron/*: the token is the check (docs/api.md).
 *
 * Answers are JSON: `{ ok: true, data }`, or `{ ok: false, code, error }`
 * with the HTTP status the failure deserves — and `data` when the failure
 * has something to go on with (a proposal that changed: the new one). The words in them (labels,
 * previews, refusals) are Italian, or English with `Accept-Language: en`.
 */

export type ApiHandler = (req: NextRequest) => Promise<unknown>;

const STATUS: Record<string, number> = {
  invalid: 400,
  not_found: 404,
  stale: 409,
  not_configured: 503,
  unauthorized: 401,
};

export function apiError(code: string, error: string, status = STATUS[code] ?? 500, data?: unknown): NextResponse {
  return NextResponse.json({ ok: false, code, error, ...(data !== undefined ? { data } : {}) }, { status });
}

/** The language of the answer's words: English when the caller prefers it, else Italian. */
function languageOf(req: NextRequest): Locale {
  return /^\s*en\b/i.test(req.headers.get("accept-language") ?? "") ? "en" : "it";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An action's id as the log files it: anything else is no action of ours. */
export function operationId(id: string): string {
  if (!UUID.test(id)) throw new VetrinaError("not_found", "No such operation.", 404);
  return id;
}

/** A proposal's id: anything else is no proposal of ours. */
export function proposalId(id: string): string {
  if (!UUID.test(id)) throw new VetrinaError("not_found", "No such proposal.", 404);
  return id;
}

/** Check the token, run the handler in the caller's language, and answer its result (or its failure) as JSON. */
export async function serve(req: NextRequest, handler: ApiHandler, status = 200): Promise<NextResponse> {
  if (!env.HUB_API_TOKEN) return apiError("not_configured", "HUB_API_TOKEN is not set: the API is disabled.", 503);
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!secretMatches(token, env.HUB_API_TOKEN)) return apiError("unauthorized", "Missing or wrong bearer token.", 401);
  try {
    const data = await inLanguage(languageOf(req), () => handler(req));
    return NextResponse.json({ ok: true, data }, { status });
  } catch (e) {
    if (e instanceof VetrinaError) return apiError(e.code, e.message, e.status ?? STATUS[e.code] ?? 500, e.data);
    if (e instanceof ZodError) return apiError("invalid", e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    console.error("[api/v1]", e);
    return apiError("failed", "Unexpected error on the server: its log has the detail.", 500);
  }
}
