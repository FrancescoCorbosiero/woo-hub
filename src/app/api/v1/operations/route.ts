import type { NextRequest } from "next/server";
import { z } from "zod";
import { serve } from "@/server/api/v1";
import { listOperations } from "@/server/vetrina/operations/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/operations?limit=20 — the Vetrina's log, newest first: every
 * action, the catalog's and the homepage's, how it came (`via`), how it
 * went, and whether it can still be undone. See docs/api.md.
 */
const Query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

export function GET(req: NextRequest) {
  return serve(req, async () => listOperations(Query.parse(Object.fromEntries(req.nextUrl.searchParams)).limit));
}
