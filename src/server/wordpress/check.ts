import "server-only";
import { env } from "@/lib/env";
import { VetrinaError } from "@/server/vetrina/source";
import { wordpressConfigured, wp, type WpMenuItem } from "./client";

/**
 * Is this WordPress ready for the Hub's menus? Asked of the live site over
 * the same wp/v2 client the Menu tab uses, step by step, each step saying
 * what it found: the access (who the Hub signs in as, and whether menus are
 * theirs to change), the menus, the theme's places, every item, the pages,
 * the batch endpoint. Read-only.
 *
 * With `write`, a round trip on a menu of its own, made for the check and
 * on no place of the theme — items made (one under another), read back,
 * renumbered in a batch, renamed, deleted, the menu deleted — so a
 * staging (or the live) site proves the writes before the owner's first
 * one. The menu goes in the end whatever happens; a step that leaves it
 * behind says so, by name.
 *
 * Nothing here is filed in the log: it is a check, not an action.
 */

export interface CheckStep {
  step: string;
  ok: boolean;
  /** What it found, or why it failed (WordPress's own words). */
  detail: string;
  ms: number;
}

export interface WordPressCheck {
  /** Every step passed. */
  ok: boolean;
  site: string | null;
  write: boolean;
  steps: CheckStep[];
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const rawTitle = (item: WpMenuItem) => (typeof item.title === "string" ? item.title : (item.title.raw ?? ""));

/** A step, timed: its detail, or its failure's. */
async function step(steps: CheckStep[], name: string, run: () => Promise<string>): Promise<boolean> {
  const started = Date.now();
  try {
    steps.push({ step: name, ok: true, detail: await run(), ms: Date.now() - started });
    return true;
  } catch (e) {
    steps.push({ step: name, ok: false, detail: messageOf(e), ms: Date.now() - started });
    return false;
  }
}

/** A check that failed in its own terms: the step's detail says why. */
const fail = (message: string) => new VetrinaError("failed", message);

export async function checkWordPress({ write = false }: { write?: boolean } = {}): Promise<WordPressCheck> {
  const steps: CheckStep[] = [];
  const site = env.WOO_BASE_URL ?? null;
  const done = (): WordPressCheck => ({ ok: steps.every((s) => s.ok), site, write, steps });

  if (!wordpressConfigured()) {
    steps.push({ step: "access", ok: false, detail: "WP_APP_USER and WP_APP_PASSWORD are not set (docs/menus.md#setup).", ms: 0 });
    return done();
  }

  const signedIn = await step(steps, "access", async () => {
    const me = await wp.me();
    const can = Boolean(me.capabilities.edit_theme_options);
    const who = `Signed in as ${me.name || me.slug} (${me.roles.join(", ") || "no role"})`;
    if (!can) throw fail(`${who}, who may not change menus: it needs an administrator (edit_theme_options).`);
    return `${who}: may change menus.`;
  });
  // Nothing else answers without the access.
  if (!signedIn) return done();

  await step(steps, "menus", async () => {
    const menus = await wp.menus();
    return menus.length === 0 ? "No menus yet." : `${menus.length} menus: ${menus.map((m) => m.name).join(", ")}.`;
  });
  await step(steps, "places", async () => {
    const places = Object.entries(await wp.locations());
    if (places.length === 0) throw fail("The theme has no places for menus: a block theme, whose navigation the Hub does not change.");
    return places.map(([slug, p]) => `${p.description || slug} (${slug}): ${p.menu ? `menu ${p.menu}` : "none"}`).join("; ");
  });
  await step(steps, "items", async () => {
    const items = await wp.allItems();
    const invalid = items.filter((i) => i.invalid).length;
    return `${items.length} items across the menus${invalid > 0 ? `, ${invalid} leading to something gone` : ""}.`;
  });
  await step(steps, "pages", async () => `${(await wp.pages()).length} published pages.`);
  await step(steps, "batch", async () =>
    (await wp.batchAvailable())
      ? "WordPress's batch endpoint answers: writes go 25 at a time."
      : "No batch endpoint (turned off): writes go one request at a time, slower but the same.",
  );

  if (write) await roundTrip(steps);
  return done();
}

/** Every write the Hub makes, on a menu of the check's own, deleted in the end. */
async function roundTrip(steps: CheckStep[]): Promise<void> {
  const name = `Store Hub check ${new Date().toISOString().slice(0, 19).replace("T", " ")}`;
  let menuId: number | null = null;
  try {
    await step(steps, "write: menu", async () => {
      menuId = (await wp.createMenu(name)).id;
      return `Made «${name}» (${menuId}), on no place of the theme.`;
    });
    if (menuId == null) return;
    const id: number = menuId;

    let made: WpMenuItem[] = [];
    const created = await step(steps, "write: items", async () => {
      const top = await wp.createMenuItems([
        { menus: id, type: "custom", url: "/", title: "Check A", parent: 0, menu_order: 1 },
        { menus: id, type: "custom", url: "#", title: "Check B", parent: 0, menu_order: 2 },
      ]);
      const refused = top.find((o) => !o.ok);
      if (refused && !refused.ok) throw refused.error;
      const parent = top[1].ok ? (top[1].body as { id: number }).id : 0;
      const [child] = await wp.createMenuItems([{ menus: id, type: "custom", url: "/check", title: "Check C", parent, menu_order: 3 }]);
      if (!child.ok) throw child.error;
      made = await wp.menuItems(id);
      if (made.length !== 3) throw fail(`Made 3 items, read back ${made.length}.`);
      const c = made.find((i) => rawTitle(i) === "Check C");
      if (!c || c.parent !== parent) throw fail("The item made under another came back elsewhere.");
      return "Made 3 items, one under another, and read them back as made.";
    });

    if (created) {
      await step(steps, "write: renumber", async () => {
        const a = made.find((i) => rawTitle(i) === "Check A")!;
        const b = made.find((i) => rawTitle(i) === "Check B")!;
        const outcomes = await wp.updateMenuItems([
          { id: b.id, body: { menu_order: 1 } },
          { id: a.id, body: { menu_order: 3 } },
        ]);
        const refused = outcomes.find((o) => !o.ok);
        if (refused && !refused.ok) throw refused.error;
        const now = await wp.menuItems(id);
        const order = now.map((i) => rawTitle(i));
        if (order[0] !== "Check B") throw fail(`Renumbered, read back in this order: ${order.join(", ")}.`);
        return "Renumbered in one batch and read back in the new order.";
      });
      await step(steps, "write: rename", async () => {
        const a = made.find((i) => rawTitle(i) === "Check A")!;
        const [renamed] = await wp.updateMenuItems([{ id: a.id, body: { title: "Check A2" } }]);
        if (!renamed.ok) throw renamed.error;
        const now = (await wp.menuItems(id)).find((i) => i.id === a.id);
        if (!now || rawTitle(now) !== "Check A2") throw fail("Renamed, but the label read back is not the new one.");
        return "Renamed an item and read the new label back.";
      });
      await step(steps, "write: delete items", async () => {
        const child = made.find((i) => rawTitle(i) === "Check C")!;
        const [gone] = await wp.deleteMenuItems([child.id]);
        if (!gone.ok) throw gone.error;
        const left = await wp.menuItems(id);
        if (left.some((i) => i.id === child.id)) throw fail("Deleted an item, but it is still there.");
        return "Deleted an item for good.";
      });
    }
  } finally {
    if (menuId != null) {
      const id: number = menuId;
      await step(steps, "write: delete menu", async () => {
        await wp.deleteMenu(id);
        return `Deleted «${name}» with what was left in it.`;
      }).then((deleted) => {
        if (!deleted) steps[steps.length - 1].detail += ` — the menu «${name}» is left on the site: delete it in Appearance › Menus.`;
      });
    }
  }
}
