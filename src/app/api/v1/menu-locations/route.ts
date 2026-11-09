import type { NextRequest } from "next/server";
import { listPlaces } from "@/server/api/menus";
import { serve } from "@/server/api/v1";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/menu-locations — the places the theme has for a menu (its
 * header's, its footer's…): `slug` (what menuLocation takes), `name`, and the
 * `menu` each shows (`{ id, name }`, or null). None at all: a block theme,
 * whose navigation is not these menus. See docs/menus.md.
 */
export function GET(req: NextRequest) {
  return serve(req, "read", () => listPlaces());
}
