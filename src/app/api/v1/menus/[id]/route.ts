import type { NextRequest } from "next/server";
import { menuId, readMenu } from "@/server/api/menus";
import { serve } from "@/server/api/v1";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/menus/{id} — a menu's items top to bottom (parent, depth,
 * place among its siblings, what each leads to, its label) and the menu's
 * `digest`, an action's `expected`. See docs/menus.md.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return serve(req, "read", () => readMenu(menuId(id)));
}
