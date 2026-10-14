import "server-only";
import { eq, sql } from "drizzle-orm";
import type { AppConfig } from "@core/config";
import { db } from "@/server/db/client";
import { config as configTable } from "@/server/db/schema";
import { connectionFromEnv } from "@/lib/env";
import { DEFAULT_TAXONOMY, buildDefaultConfig, goldenSneakersPassthroughRule } from "./defaults";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The pool, or one transaction's connection. */
type Executor = typeof db | Tx;

/**
 * Returns the active AppConfig with its ConnectionConfig (secrets) always taken
 * from env — never from the persisted row. If no active config exists yet, the
 * default is seeded and returned.
 */
export async function getActiveConfig(): Promise<AppConfig> {
  return readActiveConfig(db);
}

async function readActiveConfig(ex: Executor): Promise<AppConfig> {
  const connection = connectionFromEnv();
  const rows = await ex.select().from(configTable).where(eq(configTable.isActive, true)).limit(1);

  if (rows.length === 0) {
    const fresh = buildDefaultConfig(connection);
    await ex.insert(configTable).values({ name: "default", data: stripSecrets(fresh), isActive: true });
    return fresh;
  }

  // Overlay env secrets onto the stored (secret-free) config. The GS
  // passthrough rule is ensured at read time so configs stored before the
  // feed existed keep working without a manual Reset.
  return {
    ...rows[0].data,
    pricingRules: ensureOutlierGuard(ensureGsRule(rows[0].data.pricingRules)),
    // Configs stored before the Taxonomies tab existed carry no taxonomy
    // section; they get the shipped default rather than an undefined that
    // every reader would have to guard against.
    taxonomy: ensureTaxonomy(rows[0].data.taxonomy),
    connection,
  };
}

function ensureTaxonomy(stored: AppConfig["taxonomy"] | undefined): AppConfig["taxonomy"] {
  if (!stored) return DEFAULT_TAXONOMY;
  return {
    useSourceTree: stored.useSourceTree ?? DEFAULT_TAXONOMY.useSourceTree,
    defaultCategory: stored.defaultCategory ?? DEFAULT_TAXONOMY.defaultCategory,
    rules: stored.rules ?? [],
    write: { ...DEFAULT_TAXONOMY.write, ...(stored.write ?? {}) },
  };
}

function ensureGsRule(rules: AppConfig["pricingRules"]): AppConfig["pricingRules"] {
  const hasGs = rules.some((r) => r.scope.source === "goldensneakers");
  return hasGs ? rules : [...rules, goldenSneakersPassthroughRule()];
}

/**
 * Same read-time retrofit for the pricing safety nets: configs stored before
 * minMarginFixed / outlierFloorPercent existed get the defaults on their
 * catch-all rule (guaranteed 20€ margin over the ask; bad-data net at 40% of
 * the product median) and explicit 0 on GS rules — supplier presented prices
 * are final, margin included upstream. An operator's explicit value,
 * including 0, is always respected.
 */
function ensureOutlierGuard(rules: AppConfig["pricingRules"]): AppConfig["pricingRules"] {
  return rules.map((r) => {
    const out = { ...r };
    if (r.scope.source === "goldensneakers") {
      out.outlierFloorPercent = r.outlierFloorPercent ?? 0;
      out.minMarginFixed = r.minMarginFixed ?? 0;
      return out;
    }
    if (Object.keys(r.scope).length === 0) {
      out.outlierFloorPercent = r.outlierFloorPercent ?? 40;
      out.minMarginFixed = r.minMarginFixed ?? 20;
    }
    return out;
  });
}

/** Never persist secrets: blank out the ConnectionConfig before writing to DB. */
export function stripSecrets(cfg: AppConfig): AppConfig {
  return {
    ...cfg,
    connection: {
      kicksDbApiKey: "",
      woo: { baseUrl: cfg.connection.woo.baseUrl, consumerKey: "", consumerSecret: "" },
      marketToCurrency: cfg.connection.marketToCurrency,
    },
  };
}

/** Delete all stored config rows so the next read re-seeds from defaults.ts. */
export async function clearConfig(): Promise<void> {
  await db.delete(configTable);
}

/**
 * Every change to the stored config, one at a time: read the config as it is
 * NOW, let `change` derive the next one from it, write that — all under one
 * lock, so two editors never build on the same old copy.
 *
 * The config is ONE jsonb document, and the rule list inside it has more than
 * one editor: the Margins tab saves the whole list, the pricing bar the
 * general rule, the Vetrina's "Ricarico" one store term's rule. A plain read
 * then save let the slower of two writers drop the other's change without a
 * word — a margin set from the phone, gone on the next Margins-tab save, and
 * the next sync writing the old prices back. A transaction-scoped advisory
 * lock queues the writers (as the snapshot's withSnapshotWriteLock does);
 * each reads what the previous one committed.
 *
 * `change` returns the config to write, or null to leave it as it is. It may
 * await (a margin files its undo record before the rule is saved), but it
 * holds the lock while it does: keep it short. Returns the config as the next
 * read will see it — the read-time retrofits (the GoldenSneakers rule, the
 * safety nets) applied to what was written — or, when nothing was, the one
 * read: what an editor holds to compare against later.
 */
export async function updateActiveConfig(
  change: (current: AppConfig) => AppConfig | null | Promise<AppConfig | null>,
): Promise<AppConfig> {
  return db.transaction(async (tx) => {
    await lockConfig(tx);
    const current = await readActiveConfig(tx);
    const next = await change(current);
    if (next == null) return current;
    await writeActiveConfig(tx, next);
    return readActiveConfig(tx);
  });
}

async function lockConfig(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('store-hub:config'))`);
}

/**
 * Persist a whole config (secrets stripped); insert if none exists. A blind
 * write — it keeps nothing another writer saved since `cfg` was read — so the
 * app's editors go through updateActiveConfig; this is for seeding and tests.
 * It still waits for a change in flight.
 */
export async function saveActiveConfig(cfg: AppConfig): Promise<void> {
  await db.transaction(async (tx) => {
    await lockConfig(tx);
    await writeActiveConfig(tx, cfg);
  });
}

async function writeActiveConfig(ex: Executor, cfg: AppConfig): Promise<void> {
  const rows = await ex
    .select({ id: configTable.id })
    .from(configTable)
    .where(eq(configTable.isActive, true))
    .limit(1);
  if (rows.length) {
    await ex
      .update(configTable)
      .set({ data: stripSecrets(cfg), updatedAt: new Date() })
      .where(eq(configTable.id, rows[0].id));
  } else {
    await ex.insert(configTable).values({ name: "default", data: stripSecrets(cfg), isActive: true });
  }
}
