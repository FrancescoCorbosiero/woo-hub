// The end-to-end tests' database, made fresh: dropped, created again and
// migrated before the server starts. Refused unless it is on this machine and
// named for e2e, so a mistyped DATABASE_URL can never empty a real database.

import { execFileSync } from "node:child_process";
import pg from "pg";

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error("prepare-db: DATABASE_URL is not set");
const url = new URL(raw);
const name = decodeURIComponent(url.pathname.slice(1));

if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
  throw new Error(`prepare-db: refusing ${url.hostname}: the e2e database must be local`);
}
if (!/^[a-z0-9_]*e2e[a-z0-9_]*$/.test(name)) {
  throw new Error(`prepare-db: refusing "${name}": the e2e database's name must contain "e2e"`);
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

execFileSync("npx", ["drizzle-kit", "migrate"], { stdio: "inherit", env: process.env });
console.log(`prepare-db: ${name} is fresh`);
