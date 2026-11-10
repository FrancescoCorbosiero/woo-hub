#!/usr/bin/env node
// The real-SQL suites (*.db.test.ts) on a throwaway database, made fresh:
// dropped, created again and migrated, then the suites run one file at a
// time — each empties the tables it uses, so two files at once empty each
// other's. Refused unless the database is on this machine and named for
// tests, so a mistyped DATABASE_URL can never empty a real one. The shop they
// talk to is the suites' stand-in (https://example.com), and no feed or
// KicksDB key goes along, whatever this shell has set.
//
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/hub_test npm run test:db
//   DATABASE_URL=… npm run test:db -- proposals.db     (some suites only)

import { execFileSync, spawnSync } from "node:child_process";
import pg from "pg";

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error("test-db: DATABASE_URL is not set");
const url = new URL(raw);
const name = decodeURIComponent(url.pathname.slice(1));

// The suites themselves run only against localhost or 127.0.0.1.
if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
  throw new Error(`test-db: refusing ${url.hostname}: the test database must be on this machine (localhost, 127.0.0.1)`);
}
if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(name)) {
  throw new Error(`test-db: refusing "${name}": the test database's name must contain "test"`);
}

const admin = new URL(url);
admin.pathname = "/postgres";
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
try {
  await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${name}"`);
} finally {
  await client.end();
}

const env = {
  ...process.env,
  RUN_DB_TESTS: "1",
  REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  // The stand-in shop the suites expect (sync.db.test.ts reads https://example.com), never a real one.
  WOO_BASE_URL: "https://example.com",
  WOO_CONSUMER_KEY: "ck_test",
  WOO_CONSUMER_SECRET: "cs_test",
};
for (const key of ["KICKS_SECRET", "GS_FEED_URL", "GS_FEED_TOKEN", "HUB_ROLE"]) delete env[key];

execFileSync(process.execPath, ["scripts/migrate.mjs"], { stdio: "inherit", env });
const filters = process.argv.length > 2 ? process.argv.slice(2) : ["db.test"];
const run = spawnSync("npx", ["vitest", "run", "--no-file-parallelism", ...filters], { stdio: "inherit", env });
process.exit(run.status ?? 1);
