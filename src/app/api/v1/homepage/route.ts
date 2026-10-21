import type { NextRequest } from "next/server";
import { readHomepage } from "@/server/api/reads";
import { serve } from "@/server/api/v1";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/homepage — the homepage top to bottom: each product section
 * with its key, what it shows, its switch, its pinned and hidden products
 * and the first ones the site shows; the other blocks with their editable
 * texts. See docs/api.md.
 */
export function GET(req: NextRequest) {
  return serve(req, () => readHomepage());
}
