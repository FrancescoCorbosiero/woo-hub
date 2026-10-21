import type { NextRequest } from "next/server";
import { serve } from "@/server/api/v1";
import { describeActions } from "@/server/vetrina/operations/registry";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/actions — every action the Vetrina can do, described for a
 * script or an assistant: what it does, how it is undone, an example, and
 * its input as JSON Schema. See docs/api.md.
 */
export function GET(req: NextRequest) {
  return serve(req, async () => ({ actions: describeActions() }));
}
