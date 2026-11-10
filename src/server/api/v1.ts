import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import type { Locale } from "@/i18n/config";
import { env } from "@/lib/env";
import { findPrincipal, parsePrincipals, type Actor, type Scope } from "@/lib/actors";
import { inLanguage } from "@/server/vetrina/operations/words";
import { VetrinaError } from "@/server/vetrina/source";

/**
 * The Hub's programmatic API (/api/v1/*): the same catalog actions the
 * Vetrina's screens use, for a script, another service or an assistant.
 * Every request carries `Authorization: Bearer <token>`, and every token is a
 * caller with a name and its scopes (HUB_API_TOKENS; HUB_API_TOKEN is the
 * caller "legacy", with every scope — src/lib/actors.ts). No token set = the
 * API answers 503. Each route says what it needs (read, propose, confirm,
 * undo, admin); a caller without it gets 403, and the handler learns who
 * called. The sign-in (Authelia) lets /api/v1/* through without a session,
 * as it does /api/cron/*: the token is the check (docs/api.md).
 *
 * Answers are JSON: `{ ok: true, data }`, or `{ ok: false, code, error }`
 * with the HTTP status the failure deserves — and `data` when the failure
 * has something to go on with (a proposal that changed: the new one). The words in them (labels,
 * previews, refusals) are Italian, or English with `Accept-Language: en`.
 */

/** Who called: the token's caller, by name and scopes (never its token). */
export type Caller = Extract<Actor, { kind: "token" }>;

export type ApiHandler<T = unknown> = (req: NextRequest, caller: Caller) => Promise<T>;

const STATUS: Record<string, number> = {
  invalid: 400,
  not_found: 404,
  stale: 409,
  not_configured: 503,
  unauthorized: 401,
  forbidden: 403,
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

/**
 * A shortcut's answer (POST /catalog/order, /order-sources/{id}/apply): the
 * preview asked with dryRun (200), the proposal made in its place for a
 * caller that may not act in one call (201), the action started (202).
 */
export function shortcutStatus(data: object): number {
  if ("dryRun" in data && data.dryRun === true) return 200;
  return "proposal" in data ? 201 : 202;
}

/**
 * Check the token and what its caller may do, run the handler in the
 * caller's language, and answer its result (or its failure) as JSON. `need`:
 * the scope the route asks for, or several of which any one will do.
 * `status`: the answer's on success, or how to tell it from the result.
 */
export async function serve<T>(
  req: NextRequest,
  need: Scope | readonly Scope[],
  handler: ApiHandler<T>,
  status: number | ((data: T) => number) = 200,
): Promise<NextResponse> {
  const callers = parsePrincipals(env.HUB_API_TOKENS, env.HUB_API_TOKEN);
  // env.ts refuses a wrong list at boot: this is for a test's env, or a module loaded around it.
  if (!callers.ok) return apiError("not_configured", `${callers.error} The API is disabled.`, 503);
  if (callers.principals.length === 0) {
    return apiError("not_configured", "No API token is set (HUB_API_TOKENS, HUB_API_TOKEN): the API is disabled.", 503);
  }
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const principal = token ? findPrincipal(callers.principals, token) : null;
  if (!principal) return apiError("unauthorized", "Missing or wrong bearer token.", 401);
  const needed: readonly Scope[] = typeof need === "string" ? [need] : need;
  if (!needed.some((scope) => principal.scopes.includes(scope))) {
    return apiError(
      "forbidden",
      `The token "${principal.name}" may not do this: it needs ${needed.join(" or ")}, and has ${principal.scopes.join(", ")}.`,
    );
  }
  const caller: Caller = { kind: "token", name: principal.name, scopes: principal.scopes };
  try {
    const data = await inLanguage(languageOf(req), () => handler(req, caller));
    return NextResponse.json({ ok: true, data }, { status: typeof status === "function" ? status(data) : status });
  } catch (e) {
    if (e instanceof VetrinaError) return apiError(e.code, e.message, e.status ?? STATUS[e.code] ?? 500, e.data);
    if (e instanceof ZodError) return apiError("invalid", e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    console.error("[api/v1]", e);
    return apiError("failed", "Unexpected error on the server: its log has the detail.", 500);
  }
}
