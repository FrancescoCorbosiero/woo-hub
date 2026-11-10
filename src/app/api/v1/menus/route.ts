import type { NextRequest } from "next/server";
import { listMenus } from "@/server/api/menus";
import { serve } from "@/server/api/v1";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/menus — the site's navigation menus: id, name, slug, the
 * theme's places that show each (`locations`), how many items. Needs
 * WP_APP_USER and WP_APP_PASSWORD on the Hub (docs/menus.md).
 */
export function GET(req: NextRequest) {
  return serve(req, "read", () => listMenus());
}
