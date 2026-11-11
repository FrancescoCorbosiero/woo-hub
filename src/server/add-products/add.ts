import "server-only";
import { ADD_BATCH, KICKSDB_UNREACHABLE, NOT_ON_KICKSDB } from "@/lib/add-products";
import { skuKey } from "@/lib/skus";
import { getSource as kicksdb, kicksdbConfigured } from "@/server/adapters/kicksdb";
import { joinCatalog } from "@/server/catalog/join";
import { demoMode } from "@/server/collections/store";
import { getActiveConfig } from "@/server/config/repo";
import { gsFeedStatus } from "@/server/feeds/owner";
import { getOverrides } from "@/server/overrides/repo";
import { catalogSpellings } from "@/server/vetrina/order-sources/compare-model";
import { words } from "@/server/vetrina/operations/words";
import { VetrinaError } from "@/server/vetrina/source";
import { wooConfigured } from "@/server/woo/client";
import { publishProducts, type PublishOptions, type PublishOutcome, type PublishProductReport } from "@/server/woo/publish";
import { isWriter, NOT_WRITER } from "@/server/writer";
import { rememberingSource } from "./kicks-memory";

/**
 * "Aggiungi prodotti", the one tap: the codes the look-up found are brought
 * in through Publish — a batch per request, as the publish screens run it
 * (src/lib/publish-run.ts). The feed's go straight to it (the feed owns
 * them); the rest join the Hub's catalog first, from KicksDB's answer the
 * look-up remembered, and are published from there with the margins'
 * prices. Publish keeps its own guarantees: a product the shop has is left
 * alone, a new one is created hidden and goes on sale with its first photo.
 *
 * A code that never reaches Publish — KicksDB has no such product, or did
 * not answer — comes back in the outcome all the same, with a code for the
 * screen to word (NOT_ON_KICKSDB, KICKSDB_UNREACHABLE).
 */
export async function addProducts(skus: readonly string[], options: PublishOptions): Promise<PublishOutcome> {
  if (demoMode()) throw new VetrinaError("invalid", words().add.demo, 400);
  if (!wooConfigured()) throw new VetrinaError("not_configured", words().term.notConfigured, 503);
  if (!options.dryRun && !isWriter()) throw new VetrinaError("not_configured", NOT_WRITER, 503);
  const asked = [...new Map(skus.map((s) => s.trim()).filter(Boolean).map((s) => [skuKey(s), s])).values()].slice(0, ADD_BATCH);

  const config = await getActiveConfig();
  const market = config.source.market;
  const overrides = await getOverrides().catch(() => null);
  const { owned } = await gsFeedStatus([...new Set(asked.flatMap(catalogSpellings))], market, overrides);
  const fromFeed = new Map<string, string>();
  const rest: string[] = [];
  for (const sku of asked) {
    const key = catalogSpellings(sku).find((k) => owned.has(k));
    if (key) fromFeed.set(sku, key);
    else rest.push(sku);
  }
  const joined = await joinCatalog(rest, market, kicksdbConfigured() ? rememberingSource(kicksdb(config)) : null);

  const toPublish = [...new Set([...fromFeed.values(), ...joined.resolved.values()])];
  const outcome: PublishOutcome =
    toPublish.length > 0
      ? await publishProducts(toPublish, options)
      : {
          auditId: "",
          identitySkipped: [],
          dryRun: options.dryRun,
          status: options.dryRun ? "dry_run" : "failed",
          products: [],
          created: 0,
          reimported: 0,
          completed: 0,
          variations: 0,
          skipped: 0,
          failed: 0,
        };
  const missing = [
    ...joined.notFound.map((sku) => notPublished(sku, NOT_ON_KICKSDB)),
    ...joined.unreachable.map((sku) => notPublished(sku, KICKSDB_UNREACHABLE)),
  ];
  return { ...outcome, products: [...outcome.products, ...missing], failed: outcome.failed + missing.length };
}

function notPublished(sku: string, error: string): PublishProductReport {
  return {
    sku: skuKey(sku),
    title: sku,
    action: "skip",
    storeProductId: null,
    permalink: null,
    sizes: [],
    unpricedSizes: [],
    skippedNoEu: 0,
    rejectedGtins: [],
    gtins: 0,
    images: 0,
    reason: null,
    error,
  };
}
