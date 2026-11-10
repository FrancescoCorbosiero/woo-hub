import "server-only";
import { z } from "zod";
import { parsePrincipals } from "@/lib/actors";
import { isTimeZone, parseTimes } from "@/lib/schedule";

/**
 * The ONLY place process.env is read. Everything else imports the typed `env`
 * or the derived `connectionFromEnv()`. Validated once at module load; a missing
 * or malformed secret fails fast instead of surfacing as a confusing runtime 401.
 */
/**
 * An optional secret, tolerant of the way hosting panels and compose files
 * pass "unset": KICKS_SECRET= with nothing after it is absent, not a
 * zero-length key that should crash the app at boot.
 */
const optionalSecret = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().min(1).optional(),
);

/** An optional setting where a blank value (X= in a compose file) means unset. */
const blankIsUnset = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema);

const parsesAsTimes = (value: string) => {
  try {
    parseTimes(value);
    return true;
  } catch {
    return false;
  }
};

const EnvSchema = z.object({
  // KicksDB
  // Optional: a shop that sells only supplier-feed products (GoldenSneakers)
  // has no KicksDB account. Without it every KicksDB-backed path degrades to
  // "no data from this source" instead of failing the app.
  KICKS_SECRET: optionalSecret,
  KICKS_BASE_URL: z.url().default("https://api.kicks.dev/v3"),

  // WooCommerce REST — powers the live sync (pull store state, push prices).
  // Optional: without them the Sync tab explains what to configure, and the
  // hidden file round-trip flow (/preview) still works.
  WOO_BASE_URL: z.url().optional(),
  WOO_CONSUMER_KEY: z.string().optional(),
  WOO_CONSUMER_SECRET: z.string().optional(),

  // WordPress's own REST API (wp/v2: navigation menus, pages), which Woo's
  // keys cannot reach: a WordPress administrator's username (or email) and
  // an Application Password of theirs (Users › Profile › Application
  // Passwords; the spaces WordPress shows may stay). The site is
  // WOO_BASE_URL's. Optional: without them the menus say what to set.
  WP_APP_USER: optionalSecret,
  WP_APP_PASSWORD: optionalSecret,

  // Shared secret for the scheduled endpoints (/api/cron/*). Unset = disabled.
  CRON_SECRET: z.string().optional(),

  // The Hub's programmatic API (/api/v1/*): its callers, one bearer token
  // each, with what each may do (src/lib/actors.ts, docs/api.md#tokens):
  //   name:token:scopes[,name:token:scopes…]   scopes: read+propose+confirm+undo+admin
  // e.g. an assistant read+propose; confirm only on a token a person keeps.
  // HUB_API_TOKEN, the single token from before, stays a caller of its own
  // ("legacy") with every scope. Neither set = the API is disabled (503).
  HUB_API_TOKEN: z.string().min(24).optional(),
  HUB_API_TOKENS: blankIsUnset(z.string().optional()),

  // The one process that writes in the background (src/server/writer.ts,
  // docs/deploy.md): the scheduler, the catalog's actions, the automatic
  // categories, the Sync tab's live apply. "writer" (default) runs them;
  // "web" serves the screens and the API but refuses them — for any second
  // process on this shop's database, which must never become a second writer.
  HUB_ROLE: blankIsUnset(z.enum(["writer", "web"]).optional()),

  // In-app scheduler (src/server/scheduler.ts): the process runs the
  // scheduled syncs at all. Default: on in production, off in dev; set
  // explicitly to override either way. WHAT they do and WHEN is a setting of
  // the Hub (Feeds tab › Automatic sync), not of the environment.
  SCHEDULER: z.enum(["on", "off"]).optional(),

  // --- Former settings -------------------------------------------------
  // What the scheduled syncs do used to be set here, a variable each. It is
  // now the Automatic sync settings on the Feeds tab (AppConfig.automation,
  // src/lib/automation.ts), stored with the rest of the config and followed
  // within a minute. These variables are read only as the settings' STARTING
  // values, until the owner first saves them; never after. Still checked here,
  // so a deploy that sets one boots as it always did.
  AUTO_REPAIR: z.enum(["on", "off"]).optional(),
  SCHEDULER_TIMES: blankIsUnset(
    z
      .string()
      .refine((v) => parsesAsTimes(v), "SCHEDULER_TIMES is a list of HH:MM times, e.g. 04:30 or 04:30,13:30")
      .optional(),
  ),
  SCHEDULER_TIMEZONE: blankIsUnset(
    z.string().refine((v) => isTimeZone(v), "SCHEDULER_TIMEZONE is an IANA time zone, e.g. Europe/Rome").optional(),
  ),
  SCHEDULER_ORDERS_MINUTES: blankIsUnset(z.coerce.number().int().min(0).max(1440).optional()),
  SCHEDULER_HEARTBEAT_URL: blankIsUnset(z.url().optional()),
  SCHEDULER_FEEDS_MINUTES: blankIsUnset(
    z.coerce
      .number()
      .int()
      .refine((v) => v === 0 || (v >= 5 && v <= 720), "SCHEDULER_FEEDS_MINUTES is 0 (off) or 5–720 minutes")
      .optional(),
  ),
  SCHEDULER_FEEDS_HEARTBEAT_URL: blankIsUnset(z.url().optional()),
  SCHEDULER_COLLECTIONS_MINUTES: blankIsUnset(z.coerce.number().int().min(0).max(1440).optional()),
  COLLECTIONS_MAX_CHANGES: blankIsUnset(z.coerce.number().int().min(1).optional()),
  AUTO_SYNC: z.enum(["on", "off"]).optional(),
  AUTO_SYNC_MAX_CHANGES: blankIsUnset(z.coerce.number().int().min(1).optional()),
  AUTO_SYNC_STORE_MAX_CHANGES: blankIsUnset(z.coerce.number().int().min(1).optional()),
  // ---------------------------------------------------------------------

  // GoldenSneakers feed — the flat-assortment endpoint (include VAT/markup
  // query params there: presented_price arrives FINAL) and its bearer token.
  // Optional: without them the Feeds tab falls back to manual JSON upload.
  GS_FEED_URL: z.url().optional(),
  GS_FEED_TOKEN: z.string().optional(),

  // Where the Vetrina reads the homepage: the live site (golden-hive-blocks'
  // wc-gh/v1 API, authenticated with the WOO_* keys) or an in-memory demo
  // shop. Overrides hub.config.ts, so local dev can use the demo untouched.
  VETRINA_SOURCE: z.enum(["wordpress", "fixture"]).optional(),
  // The Vetrina's own address (e.g. vetrina.resellpiacenza.shop): the same
  // app answers there with the Vetrina only — "/" is its home, the operator
  // tabs stay on the Hub's address. Unset = no split.
  VETRINA_HOST: z
    .string()
    .regex(/^[a-z0-9.-]+$/i, "VETRINA_HOST is a bare hostname, e.g. vetrina.example.com")
    .optional(),

  // Sign-in is Authelia's, in front of the app (docs/auth.md): Caddy adds
  // this secret to every request it lets through, and src/proxy.ts refuses
  // the rest. It is read there from process.env; this only checks its shape
  // at boot. Letters and digits only: it is written into a Caddy label.
  // Unset = open app (local dev).
  AUTH_PROXY_SECRET: blankIsUnset(
    z
      .string()
      .regex(/^[A-Za-z0-9]{32,}$/, "AUTH_PROXY_SECRET is 32 or more letters and digits: openssl rand -hex 32")
      .optional(),
  ),

  // Persistence
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),

  // App
  DEFAULT_MARKET: z.string().default("IT"),
}).superRefine((e, ctx) => {
  // The API's callers, read whole at boot: a wrong entry stops the app here, not as a 401 later.
  const callers = parsePrincipals(e.HUB_API_TOKENS, e.HUB_API_TOKEN);
  if (!callers.ok) ctx.addIssue({ code: "custom", path: ["HUB_API_TOKENS"], message: callers.error });
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();

/**
 * Build the ConnectionConfig (from core/config.ts) out of env. Secrets live here
 * and only here — never in the persisted AppConfig rows.
 */
export function connectionFromEnv() {
  return {
    kicksDbApiKey: env.KICKS_SECRET ?? "",
    woo: {
      baseUrl: env.WOO_BASE_URL ?? "",
      consumerKey: env.WOO_CONSUMER_KEY ?? "",
      consumerSecret: env.WOO_CONSUMER_SECRET ?? "",
    },
    marketToCurrency: { IT: "EUR", US: "USD", GB: "GBP", DE: "EUR" } as Record<string, string>,
  };
}
