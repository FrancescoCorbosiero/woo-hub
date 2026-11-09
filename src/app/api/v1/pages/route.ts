import type { NextRequest } from "next/server";
import { listPages } from "@/server/api/menus";
import { serve } from "@/server/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/pages — the site's published pages (id, title, parent, url): what a menu item can lead to. See docs/menus.md. */
export function GET(req: NextRequest) {
  return serve(req, "read", () => listPages());
}
