import "server-only";
import type { CatalogStore } from "./service";
import { getFreshBySkus, getAnyBySkus, upsertCatalog, countCatalog } from "./repo";

/** DB-backed CatalogStore used in production (tests inject a fake). */
export const dbCatalogStore: CatalogStore = {
  getFresh: getFreshBySkus,
  getAny: getAnyBySkus,
  // What a KicksDB fetch brought: every row refreshed, fetchedAt moved (the default).
  upsert: async (market, products) => {
    await upsertCatalog(market, products);
  },
  count: countCatalog,
};
