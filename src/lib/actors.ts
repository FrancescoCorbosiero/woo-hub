import { secretMatches } from "@/lib/auth";

/**
 * Who acts on the shop through the Hub, and what each caller of its API may
 * do (docs/api.md#tokens).
 *
 * A person signed in on the screens acts as themselves: Authelia vouched for
 * them, and src/proxy.ts passes their Remote-User only then (never on
 * /api/v1, whatever the request claims). A program — a script, a service, an
 * assistant — calls /api/v1 with a bearer token, and each token is a caller
 * of its own, with a name and its scopes:
 *
 * - read     the reads, the actions described, a preview (dryRun), a proposal;
 * - propose  proposals, and the order sources they use;
 * - confirm  a proposal's yes: a person's credential, never a program's;
 * - undo     "Annulla";
 * - admin    the one-call shortcuts, deleting an order source.
 *
 * Pure — no env, no server-only — shared by src/lib/env.ts, which checks the
 * token list at boot, the API's envelope (src/server/api/v1.ts) and the
 * actions' log (src/server/vetrina/operations).
 */

export const SCOPES = ["read", "propose", "confirm", "undo", "admin"] as const;
export type Scope = (typeof SCOPES)[number];

/** A caller of the API: its name (what the log files), its token, its scopes. */
export interface Principal {
  name: string;
  token: string;
  scopes: readonly Scope[];
}

/** Who asks: a person signed in on the screens, or a caller of the API by its token's name. */
export type Actor = { kind: "user"; name: string } | { kind: "token"; name: string; scopes: readonly Scope[] };

/** HUB_API_TOKEN, the single token from before the list: one caller, every scope. */
export const LEGACY_NAME = "legacy";
export const MIN_TOKEN_LENGTH = 24;

const NAME = /^[a-z0-9][a-z0-9._-]{0,39}$/i;

const isScope = (value: string): value is Scope => (SCOPES as readonly string[]).includes(value);

/**
 * HUB_API_TOKENS — `name:token:scopes`, entries apart by commas (or spaces),
 * scopes joined by "+", e.g. `assistant:<token>:read+propose` — with
 * HUB_API_TOKEN, if set, as the caller "legacy" with every scope. Refused
 * whole when one entry is wrong: a list half read would leave a caller out
 * without a word. No refusal ever repeats a token.
 */
export function parsePrincipals(
  list: string | undefined,
  legacyToken?: string,
): { ok: true; principals: Principal[] } | { ok: false; error: string } {
  const principals: Principal[] = [];
  if (legacyToken) principals.push({ name: LEGACY_NAME, token: legacyToken, scopes: SCOPES });
  const entries = (list ?? "").split(/[\s,]+/).filter(Boolean);
  for (const [i, entry] of entries.entries()) {
    const at = `HUB_API_TOKENS entry ${i + 1}`;
    const parts = entry.split(":");
    if (parts.length !== 3) return { ok: false, error: `${at} is not name:token:scopes.` };
    const [name, token, scopeList] = parts;
    if (!NAME.test(name)) return { ok: false, error: `${at}: "${name}" is not a name (letters, digits, ".", "_", "-"; up to 40).` };
    if (token.length < MIN_TOKEN_LENGTH) {
      return { ok: false, error: `${at} (${name}): the token is shorter than ${MIN_TOKEN_LENGTH} characters (openssl rand -hex 32).` };
    }
    const asked = scopeList.split("+").filter(Boolean);
    const unknown = asked.filter((s) => !isScope(s));
    if (asked.length === 0 || unknown.length > 0) {
      return { ok: false, error: `${at} (${name}): scopes are ${SCOPES.join(", ")}, joined by "+"${unknown.length > 0 ? ` — not ${unknown.join(", ")}` : ""}.` };
    }
    if (principals.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: `${at}: the name "${name}" is taken${name.toLowerCase() === LEGACY_NAME ? " (HUB_API_TOKEN's)" : ""}.` };
    }
    const twin = principals.find((p) => p.token === token);
    if (twin) return { ok: false, error: `${at} (${name}) has the same token as ${twin.name}: one token, one caller.` };
    principals.push({ name, token, scopes: SCOPES.filter((s) => asked.includes(s)) });
  }
  return { ok: true, principals };
}

/** The caller this token is; every one compared, so how long it takes says nothing of which matched. */
export function findPrincipal(principals: readonly Principal[], token: string): Principal | null {
  let found: Principal | null = null;
  for (const p of principals) {
    if (secretMatches(token, p.token)) found ??= p;
  }
  return found;
}

/** The actor as the log files it: "user:<Authelia username>", "token:<caller's name>". */
export function actorId(actor: Actor): string {
  return `${actor.kind}:${actor.name}`;
}

/** The log's actor for a nullable one. */
export const actorOf = (actor: Actor | null | undefined): string | null => (actor ? actorId(actor) : null);

/**
 * What the actor may do: a token, what its scopes say; a person on the
 * screens, whatever the screens offer (the sign-in is their gate).
 */
export function may(actor: Actor, scope: Scope): boolean {
  return actor.kind === "user" || actor.scopes.includes(scope);
}

/**
 * A person — who alone says yes to a proposal: someone signed in on the
 * screens, or a token holding the confirm scope, which is given only to a
 * credential a person keeps (a phone's client, the owner's own script),
 * never to a program acting on its own. Without one, nobody confirms: the
 * token that proposed is not the owner's yes.
 */
export function isPerson(actor: Actor | null | undefined): actor is Actor {
  return actor != null && may(actor, "confirm");
}
