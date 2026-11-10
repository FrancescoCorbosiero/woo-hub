import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";

/**
 * The API's envelope (v1.ts): who calls, what each caller may do, and how
 * every answer and failure reads — pure, no database, no shop.
 */
const env = vi.hoisted(() => ({ HUB_API_TOKEN: undefined as string | undefined, HUB_API_TOKENS: undefined as string | undefined }));
vi.mock("@/lib/env", () => ({ env }));

import { SCOPES } from "@/lib/actors";
import { currentLanguage } from "@/server/vetrina/operations/words";
import { VetrinaError } from "@/server/vetrina/source";
import { apiError, operationId, proposalId, serve, shortcutStatus, type Caller } from "./v1";

const LEGACY = "legacy-token-0123456789abcdef";
const ASSISTANT = "assistant-token-0123456789abcdef";
const PHONE = "phone-token-0123456789abcdef-0000";
const LIST = `assistant:${ASSISTANT}:read+propose,phone:${PHONE}:read+confirm+undo`;

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://hub.test/api/v1/anything", { headers });
}
const bearer = (token: string, more: Record<string, string> = {}) => request({ authorization: `Bearer ${token}`, ...more });

async function read(res: Response): Promise<{ status: number; body: { ok: boolean; code?: string; error?: string; data?: unknown } }> {
  return { status: res.status, body: await res.json() };
}

describe("the API's envelope", () => {
  beforeEach(() => {
    env.HUB_API_TOKEN = undefined;
    env.HUB_API_TOKENS = undefined;
  });
  afterEach(() => vi.restoreAllMocks());

  it("is off until a token is set: 503, and nothing runs", async () => {
    const handler = vi.fn(async () => "data");
    const { status, body } = await read(await serve(bearer(LEGACY), "read", handler));
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, code: "not_configured" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a missing, wrong or not-bearer token with 401", async () => {
    env.HUB_API_TOKEN = LEGACY;
    const handler = vi.fn(async () => "data");
    for (const req of [
      request(),
      bearer("not-the-token-0123456789abcdef"),
      bearer(`${LEGACY}x`),
      bearer(LEGACY.slice(0, -1)),
      request({ authorization: LEGACY }),
      request({ authorization: `Basic ${LEGACY}` }),
    ]) {
      const { status, body } = await read(await serve(req, "read", handler));
      expect(status).toBe(401);
      expect(body).toMatchObject({ ok: false, code: "unauthorized" });
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("takes the single token from before as the caller «legacy», with every scope", async () => {
    env.HUB_API_TOKEN = LEGACY;
    const seen: Caller[] = [];
    for (const scope of SCOPES) {
      const res = await serve(bearer(LEGACY), scope, async (_req, caller) => {
        seen.push(caller);
        return scope;
      });
      expect(await read(res)).toEqual({ status: 200, body: { ok: true, data: scope } });
    }
    expect(seen[0]).toEqual({ kind: "token", name: "legacy", scopes: ["read", "propose", "confirm", "undo", "admin"] });
  });

  it("knows each token of the list as its own caller, and refuses a scope it lacks with 403, saying what it needs", async () => {
    env.HUB_API_TOKENS = LIST;
    const who = (token: string, need: Parameters<typeof serve>[1]) => serve(bearer(token), need, async (_req, caller) => caller.name);

    expect(await read(await who(ASSISTANT, "read"))).toEqual({ status: 200, body: { ok: true, data: "assistant" } });
    expect(await read(await who(ASSISTANT, "propose"))).toEqual({ status: 200, body: { ok: true, data: "assistant" } });
    expect(await read(await who(PHONE, "confirm"))).toEqual({ status: 200, body: { ok: true, data: "phone" } });

    const handler = vi.fn(async () => "ran");
    const refused = await read(await serve(bearer(ASSISTANT), "confirm", handler));
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ ok: false, code: "forbidden" });
    expect(refused.body.error).toBe('The token "assistant" may not do this: it needs confirm, and has read, propose.');
    expect((await read(await serve(bearer(PHONE), "propose", handler))).status).toBe(403);
    expect((await read(await serve(bearer(ASSISTANT), "undo", handler))).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets through a caller with any one of the scopes a route takes", async () => {
    env.HUB_API_TOKENS = `${LIST},script:script-token-0123456789abcdef:read+admin`;
    const shortcut = (token: string) => serve(bearer(token), ["propose", "admin"], async (_req, caller) => caller.name);
    expect((await read(await shortcut(ASSISTANT))).body.data).toBe("assistant");
    expect((await read(await shortcut("script-token-0123456789abcdef"))).body.data).toBe("script");
    const refused = await read(await shortcut(PHONE));
    expect(refused.status).toBe(403);
    expect(refused.body.error).toContain("it needs propose or admin");
  });

  it("serves the list and the token from before side by side", async () => {
    env.HUB_API_TOKEN = LEGACY;
    env.HUB_API_TOKENS = LIST;
    const name = async (token: string) => (await read(await serve(bearer(token), "read", async (_req, c) => c.name))).body.data;
    expect(await name(LEGACY)).toBe("legacy");
    expect(await name(ASSISTANT)).toBe("assistant");
    expect(await name(PHONE)).toBe("phone");
  });

  it("stays off with a wrong list rather than guess at it, and never repeats a token", async () => {
    env.HUB_API_TOKEN = LEGACY;
    env.HUB_API_TOKENS = "assistant:short:read";
    const { status, body } = await read(await serve(bearer(LEGACY), "read", async () => "data"));
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, code: "not_configured" });
    expect(body.error).toContain("HUB_API_TOKENS entry 1 (assistant)");
    expect(body.error).not.toContain(LEGACY);
  });

  it("answers the result as data, with the route's status or the one its result calls for", async () => {
    env.HUB_API_TOKEN = LEGACY;
    expect(await read(await serve(bearer(LEGACY), "propose", async () => ({ id: "p1" }), 201))).toEqual({
      status: 201,
      body: { ok: true, data: { id: "p1" } },
    });
    const shortcut = (data: object) => serve(bearer(LEGACY), "read", async () => data, shortcutStatus);
    expect((await shortcut({ dryRun: true, preview: {} })).status).toBe(200);
    expect((await shortcut({ dryRun: false, proposal: { id: "p1" } })).status).toBe(201);
    expect((await shortcut({ dryRun: false, operation: { id: "o1" } })).status).toBe(202);
  });

  it("answers a refusal of ours by its code, status and data; a schema's by field; anything else without its text", async () => {
    env.HUB_API_TOKEN = LEGACY;
    const failing = (e: unknown) => serve(bearer(LEGACY), "read", async () => Promise.reject(e));

    expect(await read(await failing(new VetrinaError("stale", "The shop changed.", 409, { proposal: { id: "p2" } })))).toEqual({
      status: 409,
      body: { ok: false, code: "stale", error: "The shop changed.", data: { proposal: { id: "p2" } } },
    });
    expect(await read(await failing(new VetrinaError("forbidden", "A person confirms.")))).toEqual({
      status: 403,
      body: { ok: false, code: "forbidden", error: "A person confirms." },
    });
    expect((await failing(new VetrinaError("invalid", "No."))).status).toBe(400);
    expect((await failing(new VetrinaError("not_found", "Gone."))).status).toBe(404);

    const zod = z.object({ limit: z.number() }).safeParse({ limit: "many" }).error;
    const invalid = await read(await failing(zod));
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ ok: false, code: "invalid", error: expect.stringMatching(/^limit: /) });

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await read(await failing(new Error("password authentication failed for user kicks")));
    expect(failed).toEqual({ status: 500, body: { ok: false, code: "failed", error: "Unexpected error on the server: its log has the detail." } });
    expect(log).toHaveBeenCalled();
  });

  it("runs the handler in the caller's language: English when asked first, else Italian", async () => {
    env.HUB_API_TOKEN = LEGACY;
    const language = async (accept?: string) =>
      (await read(await serve(bearer(LEGACY, accept ? { "accept-language": accept } : {}), "read", async () => currentLanguage()))).body.data;
    expect(await language("en")).toBe("en");
    expect(await language("en-GB,en;q=0.9,it;q=0.8")).toBe("en");
    expect(await language("it-IT,it;q=0.9")).toBe("it");
    expect(await language("fr-FR,en;q=0.5")).toBe("it");
    expect(await language()).toBe("it");
  });

  it("takes only ids shaped as the log files them", () => {
    const id = "3376e826-1b2c-4d5e-8f90-123456789abc";
    expect(operationId(id)).toBe(id);
    expect(proposalId(id.toUpperCase())).toBe(id.toUpperCase());
    for (const bad of ["", "42", "../operations", `${id}x`]) {
      expect(() => operationId(bad)).toThrow(VetrinaError);
      expect(() => proposalId(bad)).toThrow(expect.objectContaining({ code: "not_found", status: 404 }));
    }
  });

  it("words its own failures with the matching status unless told", async () => {
    const res = apiError("forbidden", "No.");
    expect(await read(res)).toEqual({ status: 403, body: { ok: false, code: "forbidden", error: "No." } });
    expect(apiError("something_else", "?").status).toBe(500);
  });
});
