"use server";

import { z } from "zod";
import { patchAutomation } from "@/server/automation/settings";
import { attempt, type VetrinaResult } from "@/server/vetrina/service";
import { readShopOverview, type ShopOverview } from "@/server/vetrina/shop";
import type { AutomationField } from "@/lib/automation";
import type { SyncNowAnswer } from "@/server/scheduler";
import { signedInActor } from "./signed-in";

/**
 * The Vetrina's "Negozio" tab (src/server/vetrina/shop.ts): read it, sync
 * the store now, and change the few Automatic sync settings it shows. The
 * rest of them, and the review of a sync, stay in the Hub.
 */

export async function getShopOverview(): Promise<VetrinaResult<ShopOverview>> {
  return attempt(() => readShopOverview());
}

/**
 * "Sincronizza ora": started in the background (the scheduler's run by hand);
 * the tab follows it with getShopOverview until it ends.
 */
export async function startShopSync(): Promise<VetrinaResult<{ answer: SyncNowAnswer; overview: ShopOverview }>> {
  return attempt(async () => {
    const { syncNow } = await import("@/server/scheduler");
    const answer = syncNow();
    if (answer.started) {
      const by = await signedInActor();
      console.log(`[vetrina] sync started by hand${by ? ` by ${by.name}` : ""}`);
    }
    return { answer, overview: await readShopOverview() };
  });
}

/** The settings the tab changes, one or a few at a time; the others stay as they are. */
const SettingsPatch = z
  .object({
    storeSync: z.boolean(),
    feedsEveryMinutes: z.number(),
    dailyStoreSync: z.boolean(),
    dailyTimes: z.array(z.string()),
  })
  .partial()
  .strict();

export type ShopSettingsPatch = z.infer<typeof SettingsPatch>;

export async function saveShopSettings(
  patch: ShopSettingsPatch,
): Promise<VetrinaResult<ShopOverview> | { ok: false; code: "invalid"; error: string; invalid: AutomationField[] }> {
  const parsed = SettingsPatch.safeParse(patch);
  if (!parsed.success) return { ok: false, code: "invalid", error: "invalid input", invalid: [] };
  const saved = await attempt(() => patchAutomation(parsed.data));
  if (!saved.ok) return saved;
  if (!saved.data.ok) return { ok: false, code: "invalid", error: "invalid settings", invalid: saved.data.invalid };
  const by = await signedInActor();
  console.log(`[settings] Automatic sync settings changed from the Vetrina${by ? ` by ${by.name}` : ""}: ${Object.keys(parsed.data).join(", ")}`);
  return attempt(() => readShopOverview());
}
