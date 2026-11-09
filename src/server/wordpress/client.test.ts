import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The wp/v2 client against answers shaped as WordPress 6.5 gives them
 * (WP_REST_Menu_Items_Controller, the batch endpoint): what it asks, how it
 * signs in, how it reads, batches and refuses.
 */
const env = vi.hoisted(() => ({
  WOO_BASE_URL: "https://shop.example.com" as string | undefined,
  WP_APP_USER: "admin" as string | undefined,
  WP_APP_PASSWORD: "abcd efgh ijkl mnop qrst uvwx" as string | undefined,
}));
vi.mock("@/lib/env", () => ({ env }));

import { BATCH_SIZE, runBatch, wordpressConfigured, wp, wpError } from "./client";

interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: Call[] = [];
let answers: ((call: Call) => Response)[] = [];

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const ITEM = {
  id: 12,
  title: { raw: "", rendered: "Sneakers &amp; Co" },
  status: "publish",
  url: "https://shop.example.com/categoria-prodotto/sneakers/",
  attr_title: "",
  description: "",
  type: "taxonomy",
  type_label: "Categoria prodotto",
  object: "product_cat",
  object_id: 101,
  parent: 0,
  menu_order: 2,
  target: "",
  classes: [""],
  xfn: [""],
  invalid: false,
  menus: 7,
};

beforeEach(() => {
  calls = [];
  answers = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      const call: Call = {
        url: new URL(input),
        method: init.method ?? "GET",
        headers: init.headers as Record<string, string>,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      };
      calls.push(call);
      const answer = answers.shift();
      if (!answer) throw new Error(`unexpected request ${call.method} ${call.url}`);
      return answer(call);
    }),
  );
  env.WOO_BASE_URL = "https://shop.example.com";
  env.WP_APP_USER = "admin";
  env.WP_APP_PASSWORD = "abcd efgh ijkl mnop qrst uvwx";
});
afterEach(() => vi.unstubAllGlobals());

describe("WordPress's REST API, signed in with an Application Password", () => {
  it("needs the site and a user to sign in as, and says which", async () => {
    expect(wordpressConfigured()).toBe(true);
    env.WP_APP_PASSWORD = undefined;
    expect(wordpressConfigured()).toBe(false);
    await expect(wp.menus()).rejects.toMatchObject({ code: "not_configured", message: expect.stringContaining("WP_APP_PASSWORD") });
    expect(calls).toHaveLength(0);
  });

  it("asks the shop's own site, signed in as the user, for every menu", async () => {
    env.WOO_BASE_URL = "https://shop.example.com/wp-json/wc/v3/";
    answers.push(() => json([{ id: 7, name: "Principale", slug: "principale", locations: ["primary"], description: "", meta: [] }]));
    expect(await wp.menus()).toEqual([{ id: 7, name: "Principale", slug: "principale", locations: ["primary"], count: 0 }]);
    const [call] = calls;
    expect(`${call.url.origin}${call.url.pathname}`).toBe("https://shop.example.com/wp-json/wp/v2/menus");
    expect(call.url.searchParams.get("context")).toBe("edit");
    expect(call.headers.Authorization).toBe(`Basic ${Buffer.from("admin:abcd efgh ijkl mnop qrst uvwx").toString("base64")}`);
  });

  it("reads a menu's items page by page, labels as stored, in menu order", async () => {
    answers.push(() => json([ITEM], 200, { "x-wp-totalpages": "2" }));
    answers.push(() => json([{ ...ITEM, id: 13, title: { raw: "Brand", rendered: "Brand" }, menu_order: 3 }], 200, { "x-wp-totalpages": "2" }));
    const items = await wp.menuItems(7);
    expect(items.map((i) => [i.id, i.title, i.menu_order])).toEqual([
      [12, { raw: "", rendered: "Sneakers &amp; Co" }, 2],
      [13, { raw: "Brand", rendered: "Brand" }, 3],
    ]);
    expect(calls.map((c) => c.url.searchParams.get("page"))).toEqual(["1", "2"]);
    const query = calls[0].url.searchParams;
    expect([query.get("menus"), query.get("orderby"), query.get("per_page"), query.get("status")]).toEqual(["7", "menu_order", "100", "publish,draft"]);
  });

  it("reads the theme's places, keyed by their slugs", async () => {
    answers.push(() =>
      json({ primary: { name: "primary", description: "Menu principale", menu: 7, _links: {} }, footer: { name: "footer", description: "Footer", menu: 0 } }),
    );
    expect(await wp.locations()).toEqual({
      primary: { name: "primary", description: "Menu principale", menu: 7 },
      footer: { name: "footer", description: "Footer", menu: 0 },
    });
  });

  it("names a shape it does not know by its route and field", async () => {
    answers.push(() => json([{ id: "seven" }]));
    await expect(wp.menus()).rejects.toMatchObject({ code: "failed", message: expect.stringContaining("/wp/v2/menus") });
  });

  it("reads WordPress's refusals into the Hub's codes, with WordPress's words", () => {
    const err = (status: number, code: string, message = "msg") => ({ message: `HTTP ${status}`, status, body: JSON.stringify({ code, message }) });
    expect(wpError(err(401, "incorrect_password", "The provided password is an invalid application password."), "/wp/v2/menus")).toMatchObject({
      code: "unauthorized",
      message: expect.stringContaining("invalid application password"),
    });
    expect(wpError(err(403, "rest_cannot_create"), "/wp/v2/menu-items")).toMatchObject({ code: "unauthorized", message: expect.stringContaining("edit_theme_options") });
    expect(wpError(err(404, "rest_no_route"), "/wp/v2/menus")).toMatchObject({ code: "not_configured", message: expect.stringContaining("WordPress 5.9") });
    expect(wpError(err(404, "rest_post_invalid_id"), "/wp/v2/menu-items/9")).toMatchObject({ code: "not_found" });
    expect(wpError(err(400, "rest_invalid_param"), "/wp/v2/menu-items")).toMatchObject({ code: "invalid" });
    expect(wpError(err(500, "internal_server_error"), "/wp/v2/menu-items")).toMatchObject({ code: "failed" });
    expect(wpError(new Error("Request failed: no answer within 25s"), "/wp/v2/menus")).toMatchObject({ code: "failed" });
  });
});

describe("writes, a batch at a time", () => {
  const ok = (body: unknown) => ({ status: 200, body, headers: {} });

  it("sends one write as itself, and a deletion for good (force=true)", async () => {
    answers.push(() => json({ deleted: true, previous: ITEM }));
    expect(await wp.deleteMenuItems([12])).toEqual([{ ok: true, body: { deleted: true, previous: ITEM } }]);
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url.pathname).toBe("/wp-json/wp/v2/menu-items/12");
    expect(calls[0].url.searchParams.get("force")).toBe("true");
  });

  it("sends several in one call, checked whole first, each with its own answer", async () => {
    answers.push((call) => {
      const body = call.body as { validation: string; requests: { method: string; path: string; body?: unknown }[] };
      expect(body.validation).toBe("require-all-validate");
      expect(body.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /wp/v2/menu-items/12", "DELETE /wp/v2/menu-items/13?force=true"]);
      return json({ responses: [ok({ ...ITEM, menu_order: 5 }), { status: 500, body: { code: "rest_cannot_delete", message: "No." }, headers: {} }] }, 207);
    });
    const out = await runBatch([
      { method: "POST", path: "/wp/v2/menu-items/12", body: { menu_order: 5 } },
      { method: "DELETE", path: "/wp/v2/menu-items/13", query: { force: "true" } },
    ]);
    expect(out[0]).toEqual({ ok: true, body: expect.objectContaining({ menu_order: 5 }) });
    expect(out[1]).toMatchObject({ ok: false, error: { code: "failed", message: expect.stringContaining("rest_cannot_delete") } });
    expect(calls[0].url.pathname).toBe("/wp-json/batch/v1");
  });

  it(`splits what is more than ${BATCH_SIZE} requests into calls of ${BATCH_SIZE}`, async () => {
    const requests = Array.from({ length: BATCH_SIZE + 3 }, (_, i) => ({ method: "POST" as const, path: `/wp/v2/menu-items/${i + 1}`, body: { menu_order: i + 1 } }));
    for (const size of [BATCH_SIZE, 3]) {
      answers.push((call) => {
        expect((call.body as { requests: unknown[] }).requests).toHaveLength(size);
        return json({ responses: Array.from({ length: size }, () => ok(ITEM)) }, 207);
      });
    }
    expect((await runBatch(requests)).every((o) => o.ok)).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("stops at a chunk WordPress refuses whole, and says why, before writing any of it", async () => {
    answers.push(() =>
      json(
        { failed: "validation", responses: [null, { status: 400, body: { code: "rest_invalid_param", message: "Invalid parameter(s): menu_order" }, headers: {} }] },
        207,
      ),
    );
    await expect(
      runBatch([
        { method: "POST", path: "/wp/v2/menu-items/12", body: {} },
        { method: "POST", path: "/wp/v2/menu-items/13", body: { menu_order: 0 } },
      ]),
    ).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("menu_order") });
    expect(calls).toHaveLength(1);
  });

  it("goes one request at a time on a site without the batch endpoint", async () => {
    answers.push(() => json({ code: "rest_no_route", message: "No route was found matching the URL and request method.", data: { status: 404 } }, 404));
    answers.push(() => json({ ...ITEM, id: 21 }, 201));
    answers.push(() => json({ ...ITEM, id: 22 }, 201));
    const out = await wp.createMenuItems([{ menus: 7, type: "custom", url: "/a", title: "A" }, { menus: 7, type: "custom", url: "/b", title: "B" }]);
    expect(out.map((o) => o.ok && (o.body as { id: number }).id)).toEqual([21, 22]);
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      "POST /wp-json/batch/v1",
      "POST /wp-json/wp/v2/menu-items",
      "POST /wp-json/wp/v2/menu-items",
    ]);
    // Published, unless said otherwise.
    expect(calls[1].body).toMatchObject({ status: "publish", menus: 7, title: "A" });
  });

  it("goes one request at a time where a plugin keeps menu items out of batches", async () => {
    answers.push(() =>
      json({ failed: "validation", responses: [{ status: 400, body: { code: "rest_batch_not_allowed", message: "No." }, headers: {} }, null] }, 207),
    );
    answers.push(() => json(ITEM));
    answers.push(() => json(ITEM));
    const out = await wp.updateMenuItems([
      { id: 12, body: { menu_order: 1 } },
      { id: 13, body: { menu_order: 2 } },
    ]);
    expect(out.every((o) => o.ok)).toBe(true);
    expect(calls).toHaveLength(3);
  });
});
