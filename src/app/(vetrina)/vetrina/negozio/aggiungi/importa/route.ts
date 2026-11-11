import { NextResponse, type NextRequest } from "next/server";
import { runAdd } from "@/server/actions/vetrina-add";
import { crossOrigin } from "@/server/http/same-origin";

export const dynamic = "force-dynamic";
// A batch creates up to 25 products on the live store, after asking KicksDB about the ones the Hub lacks.
export const maxDuration = 300;

/**
 * One batch of "Aggiungi prodotti"'s one tap (src/server/add-products/add.ts):
 * Publish's request and answer, so the publish screens' run drives it
 * (src/lib/publish-run.ts), under the Vetrina's own path.
 */
export async function POST(req: NextRequest) {
  // Same-origin only: being signed in must not let another site's page create products through this browser.
  if (crossOrigin(req)) return NextResponse.json({ ok: false, error: "cross-origin request refused" }, { status: 403 });
  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  return NextResponse.json(await runAdd(input), { headers: { "Cache-Control": "no-store" } });
}
