import "server-only";
import { z } from "zod";
import { requestJson } from "@/server/adapters/http";
import { restRoot } from "./client";

/**
 * Which SEO plugin the shop runs, and the product fields it reads its
 * Google title and description from. Read off the site's REST index — public,
 * no sign-in: every active plugin with a REST API lists its namespace there
 * (Rank Math's rankmath/v1, Yoast's yoast/v1). The product carries the
 * values as meta, written with the product itself through WooCommerce.
 */

export type SeoPlugin = "rankmath" | "yoast" | null;

const Index = z.looseObject({ namespaces: z.array(z.string()).default([]) });

/** A plugin is not switched every minute: read once an hour, a failed read retried sooner. */
const KNOWN_MS = 60 * 60_000;
const RETRY_MS = 5 * 60_000;

const g = globalThis as { __storeHubSeoPlugin?: { plugin: SeoPlugin; at: number; ok: boolean } };

/** The plugin, from the namespaces the REST index lists. Rank Math first, if a site runs both. */
export function pluginOf(namespaces: readonly string[]): SeoPlugin {
  if (namespaces.some((n) => n.startsWith("rankmath/"))) return "rankmath";
  if (namespaces.some((n) => n.startsWith("yoast/"))) return "yoast";
  return null;
}

export async function seoPlugin(now = Date.now()): Promise<SeoPlugin> {
  // No shop's address (the demo shop, a Hub without WooCommerce): no site to ask.
  if (!/^https?:\/\//i.test(restRoot())) return null;
  const known = g.__storeHubSeoPlugin;
  if (known && now - known.at < (known.ok ? KNOWN_MS : RETRY_MS)) return known.plugin;
  try {
    const index = Index.parse(
      await requestJson(`${restRoot()}/`, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" }, {
        attempts: 2,
        backoffMs: 300,
        timeoutMs: 15_000,
      }),
    );
    const plugin = pluginOf(index.namespaces);
    g.__storeHubSeoPlugin = { plugin, at: now, ok: true };
    return plugin;
  } catch (e) {
    console.warn(`[seo] the site's REST index could not be read: ${e instanceof Error ? e.message : String(e)}`);
    g.__storeHubSeoPlugin = { plugin: known?.plugin ?? null, at: now, ok: false };
    return known?.plugin ?? null;
  }
}

/** The meta a product carries its Google title and description in, for this plugin: the empty ones are left out. */
export function seoMeta(plugin: SeoPlugin, seo: { title: string; description: string }): { key: string; value: string }[] {
  const keys =
    plugin === "rankmath"
      ? { title: "rank_math_title", description: "rank_math_description" }
      : plugin === "yoast"
        ? { title: "_yoast_wpseo_title", description: "_yoast_wpseo_metadesc" }
        : null;
  if (!keys) return [];
  const out: { key: string; value: string }[] = [];
  if (seo.title.trim()) out.push({ key: keys.title, value: seo.title.trim() });
  if (seo.description.trim()) out.push({ key: keys.description, value: seo.description.trim() });
  return out;
}
