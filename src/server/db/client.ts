import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * A single shared pool. In dev, Next's hot-reload re-evaluates modules, so we
 * stash the pool on globalThis to avoid exhausting Postgres connections.
 */
const globalForDb = globalThis as unknown as { __pgPool?: Pool };

const pool = globalForDb.__pgPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.__pgPool = pool;

/**
 * An idle client that loses its connection (Postgres restarted, a network
 * blip) makes the pool emit "error"; without a listener Node treats it as an
 * uncaught exception. The pool drops that client and opens a new one on the
 * next query, so logging it is enough.
 */
function createPool(): Pool {
  const p = new Pool({ connectionString: env.DATABASE_URL });
  p.on("error", (e) => console.error(`[db] idle client error: ${e.message}`));
  return p;
}

export const db = drizzle(pool, { schema });
export { schema };
