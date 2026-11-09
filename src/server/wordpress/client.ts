import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { requestJson, requestJsonWithHeaders, type HttpError, type RetryPolicy } from "@/server/adapters/http";
import { VetrinaError } from "@/server/vetrina/source";

/**
 * WordPress's own REST API (wp/v2), for what WooCommerce's keys cannot reach:
 * navigation menus, their items and the theme's places for them, and pages.
 * WordPress accepts Woo's REST keys on wc-* routes only, so this signs in as
 * a WordPress user, with an Application Password (WP_APP_USER,
 * WP_APP_PASSWORD; WordPress 5.6+). Menus need an administrator — the
 * edit_theme_options capability — and WordPress 5.9+ (the menus API). The
 * site is WOO_BASE_URL's.
 *
 * The shapes below are WordPress 6.5's own (WP_REST_Menus_Controller,
 * WP_REST_Menu_Items_Controller, WP_REST_Menu_Locations_Controller). Writes
 * go through WordPress's batch endpoint (/batch/v1, 25 requests a call,
 * WordPress 5.6+), one request each where a site turns it off.
 */

const READ_RETRY: RetryPolicy = { attempts: 3, backoffMs: 400, timeoutMs: 25_000 };
// Never retried: a write that timed out may have landed, and replaying it would add an item twice.
const WRITE_ONCE: RetryPolicy = { attempts: 1, backoffMs: 0, timeoutMs: 45_000 };
/** WordPress's own ceiling for one batch (rest_get_max_batch_size). */
export const BATCH_SIZE = 25;
const PER_PAGE = 100;
/** A menu is not a thousand items; past this the read stops rather than loop. */
const MAX_PAGES = 20;

/* ---------------------------------------------------------------- *
 * What WordPress answers
 * ---------------------------------------------------------------- */

const Title = z.union([z.string(), z.object({ raw: z.string().optional(), rendered: z.string().default("") })]);

export const WpMenu = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  locations: z.array(z.string()).default([]),
  /** Its items (the nav_menu term's count). */
  count: z.number().int().default(0),
});
export type WpMenu = z.infer<typeof WpMenu>;

/** GET /wp/v2/menu-locations: every place the theme registered, keyed by its slug. */
export const WpLocations = z.record(z.string(), z.object({ name: z.string(), description: z.string().default(""), menu: z.number().int().default(0) }));
export type WpLocations = z.infer<typeof WpLocations>;

export const WpMenuItem = z.object({
  id: z.number().int(),
  title: Title,
  status: z.string().default("publish"),
  url: z.string().default(""),
  attr_title: z.string().default(""),
  description: z.string().default(""),
  type: z.string(),
  object: z.string().default(""),
  object_id: z.number().int().default(0),
  parent: z.number().int().default(0),
  menu_order: z.number().int().default(0),
  target: z.string().default(""),
  classes: z.array(z.string()).default([]),
  xfn: z.array(z.string()).default([]),
  invalid: z.boolean().default(false),
  menus: z.number().int().default(0),
});
export type WpMenuItem = z.infer<typeof WpMenuItem>;

export const WpPage = z.object({
  id: z.number().int(),
  title: Title,
  parent: z.number().int().default(0),
  link: z.string().default(""),
});
export type WpPage = z.infer<typeof WpPage>;

/** A menu item as WordPress takes it on create or update: only what is sent changes. */
export interface WpMenuItemBody {
  menus?: number;
  type?: "taxonomy" | "post_type" | "post_type_archive" | "custom";
  object?: string;
  object_id?: number;
  url?: string;
  /** "" = the target's own name. */
  title?: string;
  parent?: number;
  menu_order?: number;
  status?: "publish";
  target?: "" | "_blank";
  attr_title?: string;
  description?: string;
  classes?: string[];
  xfn?: string[];
}

/* ---------------------------------------------------------------- *
 * The call
 * ---------------------------------------------------------------- */

/** Set up: the site, and a user to sign in as. */
export function wordpressConfigured(): boolean {
  return Boolean(env.WOO_BASE_URL && env.WP_APP_USER && env.WP_APP_PASSWORD);
}

function root(): string {
  const base = (env.WOO_BASE_URL ?? "").replace(/\/+$/, "");
  const origin = base.includes("/wp-json") ? base.slice(0, base.indexOf("/wp-json")) : base;
  return `${origin}/wp-json`;
}

function headers(): HeadersInit {
  const token = Buffer.from(`${env.WP_APP_USER}:${env.WP_APP_PASSWORD}`).toString("base64");
  return { Authorization: `Basic ${token}`, Accept: "application/json", "Content-Type": "application/json" };
}

function assertConfigured(): void {
  if (!wordpressConfigured()) {
    throw new VetrinaError(
      "not_configured",
      "WordPress's menus need WP_APP_USER and WP_APP_PASSWORD: an administrator and an Application Password of theirs (Users › Profile), on WOO_BASE_URL's site.",
    );
  }
}

/** WordPress's error body, { code, message, data: { status } }, read into the Hub's codes. */
export function wpError(e: unknown, route: string): VetrinaError {
  const err = e as HttpError;
  const status = err.status;
  let code = "";
  let message = err.message ?? String(e);
  try {
    const body = JSON.parse(err.body ?? "") as { code?: string; message?: string };
    code = body.code ?? "";
    if (body.message) message = `${body.message} (${[code, status && `HTTP ${status}`].filter(Boolean).join(", ")})`;
  } catch {
    // not JSON: a proxy's page, a timeout — the transport's own words stay
  }
  if (code === "rest_no_route") {
    return new VetrinaError("not_configured", `This WordPress has no ${route} route: menus need WordPress 5.9 or later. ${message}`, status);
  }
  if (status === 401) {
    return new VetrinaError("unauthorized", `WordPress refused WP_APP_USER / WP_APP_PASSWORD: ${message}`, status);
  }
  if (status === 403) {
    return new VetrinaError("unauthorized", `WP_APP_USER may not do this — menus need an administrator (edit_theme_options): ${message}`, status);
  }
  if (status === 404) return new VetrinaError("not_found", message, status);
  if (status === 409) return new VetrinaError("stale", message, status);
  if (status === 400 || status === 422) return new VetrinaError("invalid", message, status);
  return new VetrinaError("failed", message, status);
}

/** Validate an answer: a shape this Hub does not know names the route and the field, not a wall of issues. */
function parsed<T>(route: string, schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw new VetrinaError("failed", `Unexpected answer from wp/v2 ${route}:\n${z.prettifyError(result.error)}`);
}

function url(path: string, query: Record<string, string> = {}): string {
  const out = new URL(`${root()}${path}`);
  for (const [k, v] of Object.entries(query)) out.searchParams.set(k, v);
  return out.toString();
}

async function read<T>(path: string, schema: z.ZodType<T>, query: Record<string, string> = {}): Promise<T> {
  assertConfigured();
  try {
    return parsed(path, schema, await requestJson(url(path, query), { method: "GET", headers: headers(), cache: "no-store" }, READ_RETRY));
  } catch (e) {
    throw e instanceof VetrinaError ? e : wpError(e, path);
  }
}

/** Every page of a collection (X-WP-TotalPages), PER_PAGE at a time. */
async function readAll<T>(path: string, schema: z.ZodType<T>, query: Record<string, string>): Promise<T[]> {
  assertConfigured();
  const out: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let answer: { data: unknown; headers: Headers };
    try {
      answer = await requestJsonWithHeaders(
        url(path, { ...query, per_page: String(PER_PAGE), page: String(page) }),
        { method: "GET", headers: headers(), cache: "no-store" },
        READ_RETRY,
      );
    } catch (e) {
      throw wpError(e, path);
    }
    out.push(...parsed(path, z.array(schema), answer.data));
    const pages = Number(answer.headers.get("x-wp-totalpages") ?? "1");
    if (!Number.isFinite(pages) || page >= pages) return out;
  }
  return out;
}

async function write(method: "POST" | "DELETE", path: string, body?: unknown, query: Record<string, string> = {}): Promise<unknown> {
  assertConfigured();
  try {
    return await requestJson(
      url(path, query),
      { method, headers: headers(), cache: "no-store", body: body === undefined ? undefined : JSON.stringify(body) },
      WRITE_ONCE,
    );
  } catch (e) {
    throw wpError(e, path);
  }
}

/* ---------------------------------------------------------------- *
 * Writes, a batch at a time
 * ---------------------------------------------------------------- */

export interface BatchRequest {
  method: "POST" | "DELETE";
  /** From the REST root: "/wp/v2/menu-items/12". */
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
}

/** One request's outcome: its answer, or WordPress's refusal of it. */
export type BatchOutcome = { ok: true; body: unknown } | { ok: false; error: VetrinaError };

const BatchAnswer = z.object({
  failed: z.string().optional(),
  responses: z.array(z.union([z.null(), z.object({ status: z.number().int(), body: z.unknown() })])),
});

/** A batch's own refusal of a request it never ran (validation), or a request's failure, as WordPress words it. */
function refusalOf(status: number, body: unknown, path: string): VetrinaError {
  return wpError({ message: `HTTP ${status}`, status, body: JSON.stringify(body ?? {}) } satisfies Partial<HttpError>, path);
}

/** Sites with the batch endpoint off answer this way: then one request at a time. */
const batchUnavailable = (e: VetrinaError) => e.status === 404 || /rest_batch_not_allowed|rest_no_route/.test(e.message);

/**
 * Run writes in order, BATCH_SIZE to a call; each comes back with its own
 * outcome. A chunk is checked whole before any of it runs
 * ("require-all-validate"): a request WordPress would refuse stops its chunk
 * before anything in it is written. Past that, WordPress runs each request
 * on its own — the caller reads every outcome.
 */
export async function runBatch(requests: readonly BatchRequest[]): Promise<BatchOutcome[]> {
  const out: BatchOutcome[] = [];
  for (let i = 0; i < requests.length; i += BATCH_SIZE) {
    const chunk = requests.slice(i, i + BATCH_SIZE);
    if (chunk.length === 1) {
      out.push(await one(chunk[0]));
      continue;
    }
    let answer: z.infer<typeof BatchAnswer>;
    try {
      answer = parsed(
        "/batch/v1",
        BatchAnswer,
        await write("POST", "/batch/v1", {
          validation: "require-all-validate",
          requests: chunk.map((r) => ({
            method: r.method,
            path: r.query ? `${r.path}?${new URLSearchParams(r.query)}` : r.path,
            ...(r.body ? { body: r.body } : {}),
          })),
        }),
      );
    } catch (e) {
      if (e instanceof VetrinaError && batchUnavailable(e)) {
        for (const r of chunk) out.push(await one(r));
        continue;
      }
      throw e;
    }
    if (answer.failed === "validation") {
      // Nothing in this chunk ran. A route a plugin keeps out of batches: one request at a time.
      if (answer.responses.some((r) => (r?.body as { code?: string } | undefined)?.code === "rest_batch_not_allowed")) {
        for (const r of chunk) out.push(await one(r));
        continue;
      }
      // Else the first refusal says why, and nothing after it is tried.
      const at = answer.responses.findIndex((r) => r != null);
      const refused = at >= 0 ? answer.responses[at] : null;
      throw refused ? refusalOf(refused.status, refused.body, chunk[at].path) : new VetrinaError("invalid", "WordPress refused the batch.");
    }
    chunk.forEach((r, j) => {
      const res = answer.responses[j];
      if (res && res.status < 400) out.push({ ok: true, body: res.body });
      else out.push({ ok: false, error: refusalOf(res?.status ?? 500, res?.body, r.path) });
    });
  }
  return out;
}

async function one(r: BatchRequest): Promise<BatchOutcome> {
  try {
    return { ok: true, body: await write(r.method, r.path, r.body, r.query) };
  } catch (e) {
    if (e instanceof VetrinaError) return { ok: false, error: e };
    throw e;
  }
}

/* ---------------------------------------------------------------- *
 * The routes the Hub uses
 * ---------------------------------------------------------------- */

const ITEM_FIELDS = "id,title,status,url,attr_title,description,type,object,object_id,parent,menu_order,target,classes,xfn,invalid,menus";

export const wp = {
  /** Every menu: id, name, slug, the places it is in. */
  menus: () => readAll("/wp/v2/menus", WpMenu, { context: "edit", _fields: "id,name,slug,locations,count" }),
  /** The theme's places for a menu, with the menu each shows. */
  locations: () => read("/wp/v2/menu-locations", WpLocations, { context: "edit" }),
  /** A menu's items, in menu order, labels as stored (context=edit: title.raw). */
  menuItems: (menuId: number) =>
    readAll("/wp/v2/menu-items", WpMenuItem, {
      menus: String(menuId),
      context: "edit",
      orderby: "menu_order",
      order: "asc",
      status: "publish,draft",
      _fields: ITEM_FIELDS,
    }),
  /** The published pages a menu can lead to. */
  pages: () => readAll("/wp/v2/pages", WpPage, { status: "publish", orderby: "title", order: "asc", _fields: "id,title,parent,link" }),
  /** One create per body, in order; each answer is the item WordPress made (or why it did not). */
  createMenuItems: (bodies: readonly WpMenuItemBody[]) =>
    runBatch(bodies.map((body) => ({ method: "POST", path: "/wp/v2/menu-items", body: { status: "publish", ...body } }))),
  updateMenuItems: (updates: readonly { id: number; body: WpMenuItemBody }[]) =>
    runBatch(updates.map((u) => ({ method: "POST", path: `/wp/v2/menu-items/${u.id}`, body: { ...u.body } }))),
  /** Menu items have no trash: deleted for good (force=true). */
  deleteMenuItems: (ids: readonly number[]) =>
    runBatch(ids.map((id) => ({ method: "DELETE", path: `/wp/v2/menu-items/${id}`, query: { force: "true" } }))),
};

/** A created or updated item's answer, read. */
export function itemOf(body: unknown): WpMenuItem {
  return parsed("/wp/v2/menu-items", WpMenuItem, body);
}
