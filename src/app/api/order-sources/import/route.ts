import { NextResponse, type NextRequest } from "next/server";
import { importSourceSkus } from "@/server/actions/vetrina-order-sources";
import { crossOrigin } from "@/server/http/same-origin";

export const dynamic = "force-dynamic";
// A slice is a few products made on the live store, their sizes and photos.
export const maxDuration = 300;

/**
 * One slice of the comparison's "Importa" (the Vetrina), as a plain request
 * rather than a server action: an action holds the router's queue, and a
 * page change would wait behind a slice of product creation (as Publish's
 * own /api/publish explains). Answers { ok, data } or { ok: false, code, error }.
 */
export async function POST(req: NextRequest) {
  if (crossOrigin(req)) return NextResponse.json({ ok: false, code: "forbidden", error: "cross-origin request refused" }, { status: 403 });
  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ ok: false, code: "invalid", error: "invalid JSON" }, { status: 400 });
  }
  return NextResponse.json(await importSourceSkus(input), { headers: { "Cache-Control": "no-store" } });
}
