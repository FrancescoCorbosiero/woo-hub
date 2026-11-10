import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The live site's check (check.ts) against a small WordPress of its own:
 * the routes the check calls, keeping menus and items as WordPress 6.5 does
 * (wp/v2 menus, menu-items, menu-locations, users/me, pages, /batch/v1).
 */
const env = vi.hoisted(() => ({
  WOO_BASE_URL: "https://shop.example.com" as string | undefined,
  WP_APP_USER: "admin" as string | undefined,
  WP_APP_PASSWORD: "abcd efgh ijkl mnop qrst uvwx" as string | undefined,
}));
vi.mock("@/lib/env", () => ({ env }));

import { checkWordPress } from "./check";

interface FakeItem {
  id: number;
  menus: number;
  title: string;
  url: string;
  parent: number;
  menu_order: number;
}

interface Fake {
  me: { id: number; name: string; slug: string; roles: string[]; capabilities: Record<string, boolean> };
  menus: { id: number; name: string; slug: string; locations: string[] }[];
  places: Record<string, { name: string; description: string; menu: number }>;
  items: FakeItem[];
  batch: boolean;
  /** Refuse this route (method and path), as WordPress would with a 500. */
  refuse: string | null;
  nextId: number;
}

let fake: Fake;
const calls: string[] = [];

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const itemBody = (i: FakeItem) => ({
  id: i.id,
  title: { raw: i.title, rendered: i.title },
  status: "publish",
  url: i.url,
  attr_title: "",
  description: "",
  type: "custom",
  object: "custom",
  object_id: i.id,
  parent: i.parent,
  menu_order: i.menu_order,
  target: "",
  classes: [""],
  xfn: [""],
  invalid: false,
  menus: i.menus,
});

/** One request, as WordPress answers it: { status, body }. */
function route(method: string, path: string, query: URLSearchParams, body: Record<string, unknown> | undefined): { status: number; body: unknown } {
  calls.push(`${method} ${path}`);
  if (fake.refuse === `${method} ${path}`) return { status: 500, body: { code: "internal_server_error", message: "Something broke." } };
  let m: RegExpMatchArray | null;
  if (method === "GET" && path === "/wp/v2/users/me") return { status: 200, body: fake.me };
  if (method === "GET" && path === "/wp/v2/menus") return { status: 200, body: fake.menus };
  if (method === "GET" && path === "/wp/v2/menu-locations") return { status: 200, body: fake.places };
  if (method === "GET" && path === "/wp/v2/pages") return { status: 200, body: [{ id: 2, title: { rendered: "Chi siamo" }, parent: 0, link: "/chi-siamo/" }] };
  if (method === "GET" && path === "/wp/v2/menu-items") {
    const menu = query.get("menus");
    const items = fake.items.filter((i) => !menu || i.menus === Number(menu)).sort((a, b) => a.menu_order - b.menu_order);
    return { status: 200, body: items.map(itemBody) };
  }
  if (method === "POST" && path === "/wp/v2/menus") {
    const menu = { id: fake.nextId++, name: String(body?.name), slug: "check", locations: [] };
    fake.menus.push(menu);
    return { status: 201, body: menu };
  }
  if (method === "DELETE" && (m = path.match(/^\/wp\/v2\/menus\/(\d+)$/))) {
    const id = Number(m[1]);
    fake.menus = fake.menus.filter((x) => x.id !== id);
    fake.items = fake.items.filter((i) => i.menus !== id);
    return { status: 200, body: { deleted: true } };
  }
  if (method === "POST" && path === "/wp/v2/menu-items") {
    const item: FakeItem = {
      id: fake.nextId++,
      menus: Number(body?.menus),
      title: String(body?.title ?? ""),
      url: String(body?.url ?? ""),
      parent: Number(body?.parent ?? 0),
      menu_order: Number(body?.menu_order ?? 1),
    };
    fake.items.push(item);
    return { status: 201, body: itemBody(item) };
  }
  if ((m = path.match(/^\/wp\/v2\/menu-items\/(\d+)$/))) {
    const item = fake.items.find((i) => i.id === Number(m![1]));
    if (!item) return { status: 404, body: { code: "rest_post_invalid_id", message: "Invalid post ID." } };
    if (method === "DELETE") {
      fake.items = fake.items.filter((i) => i !== item);
      return { status: 200, body: { deleted: true } };
    }
    if (body?.title !== undefined) item.title = String(body.title);
    if (body?.menu_order !== undefined) item.menu_order = Number(body.menu_order);
    if (body?.parent !== undefined) item.parent = Number(body.parent);
    return { status: 200, body: itemBody(item) };
  }
  if (method === "POST" && path === "/batch/v1") {
    if (!fake.batch) return { status: 404, body: { code: "rest_no_route", message: "No route was found matching the URL and request method." } };
    const requests = (body?.requests ?? []) as { method: string; path: string; body?: Record<string, unknown> }[];
    const responses = requests.map((r) => {
      const url = new URL(`https://x${r.path}`);
      return route(r.method, url.pathname, url.searchParams, r.body);
    });
    return { status: 207, body: { responses } };
  }
  return { status: 404, body: { code: "rest_no_route", message: `No route for ${method} ${path}` } };
}

beforeEach(() => {
  calls.length = 0;
  fake = {
    me: { id: 1, name: "Admin", slug: "admin", roles: ["administrator"], capabilities: { edit_theme_options: true, manage_options: true } },
    menus: [{ id: 7, name: "Principale", slug: "principale", locations: ["primary"] }],
    places: { primary: { name: "primary", description: "Menu principale", menu: 7 }, footer: { name: "footer", description: "Footer", menu: 0 } },
    items: [{ id: 70, menus: 7, title: "Home", url: "/", parent: 0, menu_order: 1 }],
    batch: true,
    refuse: null,
    nextId: 100,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      const url = new URL(input);
      const path = url.pathname.replace(/^\/wp-json/, "");
      const answer = route(init.method ?? "GET", path, url.searchParams, init.body ? JSON.parse(init.body as string) : undefined);
      return json(answer.body, answer.status, path === "/wp/v2/menu-items" ? { "x-wp-totalpages": "1" } : {});
    }),
  );
  env.WP_APP_PASSWORD = "abcd efgh ijkl mnop qrst uvwx";
});
afterEach(() => vi.unstubAllGlobals());

const steps = (check: Awaited<ReturnType<typeof checkWordPress>>) => check.steps.map((s) => [s.step, s.ok]);

describe("is this WordPress ready for the Hub's menus?", () => {
  it("reads it all and writes nothing: the access, the menus, the places, the items, the pages, the batch endpoint", async () => {
    const check = await checkWordPress();
    expect(check.ok).toBe(true);
    expect(steps(check)).toEqual([
      ["access", true],
      ["menus", true],
      ["places", true],
      ["items", true],
      ["pages", true],
      ["batch", true],
    ]);
    expect(check.steps[0].detail).toBe("Signed in as Admin (administrator): may change menus.");
    expect(check.steps[2].detail).toBe("Menu principale (primary): menu 7; Footer (footer): none");
    // The batch is asked about with an empty one: nothing is written.
    expect(calls.filter((c) => !c.startsWith("GET"))).toEqual(["POST /batch/v1"]);
    expect(fake.items).toHaveLength(1);
  });

  it("says when nothing is set up, and asks nothing", async () => {
    env.WP_APP_PASSWORD = undefined;
    const check = await checkWordPress();
    expect(check).toMatchObject({ ok: false, steps: [{ step: "access", ok: false, detail: expect.stringContaining("WP_APP_PASSWORD") }] });
    expect(calls).toEqual([]);
  });

  it("stops at a user who may not change menus, saying who it is", async () => {
    fake.me = { ...fake.me, name: "Shop", roles: ["shop_manager"], capabilities: { manage_woocommerce: true } };
    const check = await checkWordPress();
    expect(steps(check)).toEqual([["access", false]]);
    expect(check.steps[0].detail).toBe("Signed in as Shop (shop_manager), who may not change menus: it needs an administrator (edit_theme_options).");
  });

  it("names a block theme, with no places for menus, and a site whose batches are off", async () => {
    fake.places = {};
    fake.batch = false;
    const check = await checkWordPress();
    expect(check.ok).toBe(false);
    expect(check.steps.find((s) => s.step === "places")).toMatchObject({ ok: false, detail: expect.stringContaining("block theme") });
    expect(check.steps.find((s) => s.step === "batch")).toMatchObject({ ok: true, detail: expect.stringContaining("one request at a time") });
  });

  it("proves every write on a menu of its own, and leaves nothing behind", async () => {
    const check = await checkWordPress({ write: true });
    expect(steps(check).slice(6)).toEqual([
      ["write: menu", true],
      ["write: items", true],
      ["write: renumber", true],
      ["write: rename", true],
      ["write: delete items", true],
      ["write: delete menu", true],
    ]);
    expect(check.ok).toBe(true);
    expect(fake.menus.map((m) => m.name)).toEqual(["Principale"]);
    expect(fake.items.map((i) => i.title)).toEqual(["Home"]);
  });

  it("deletes its menu when a write fails, and says which", async () => {
    fake.refuse = "POST /batch/v1";
    // The empty batch of the read-only part is refused too: the check carries on all the same.
    const check = await checkWordPress({ write: true });
    expect(check.ok).toBe(false);
    expect(check.steps.find((s) => s.step === "write: items")).toMatchObject({ ok: false });
    expect(check.steps.at(-1)).toMatchObject({ step: "write: delete menu", ok: true });
    expect(fake.menus.map((m) => m.name)).toEqual(["Principale"]);
  });
});
