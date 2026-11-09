import type { NextRequest } from "next/server";
import { serve } from "@/server/api/v1";
import { checkWordPress } from "@/server/wordpress/check";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/menus/check — is this WordPress ready for the Hub's menus?
 * The access, the menus, the theme's places, the items, the pages, the
 * batch endpoint, step by step; read-only. See docs/menus.md.
 */
export function GET(req: NextRequest) {
  return serve(req, "read", () => checkWordPress());
}

/**
 * POST /api/v1/menus/check { "write": true } — the same, then a round trip
 * of writes on a menu made for the check, on no place of the theme, and
 * deleted in the end. Admin only: it writes to the site.
 */
export function POST(req: NextRequest) {
  return serve(req, "admin", async (request) => {
    const body = (await request.json().catch(() => ({}))) as { write?: unknown };
    return checkWordPress({ write: body.write === true });
  });
}
