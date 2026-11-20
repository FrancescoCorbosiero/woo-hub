import type { Metadata } from "next";
import { getServerDictionary } from "@/i18n/server";
import { PageScreen } from "@/components/vetrina/pages/PageScreen";
import { automationNow } from "@/server/automation/settings";
import { attempt } from "@/server/vetrina/service";
import { VetrinaError } from "@/server/vetrina/source";
import { openPage } from "@/server/wordpress/pages/service";
import { getPageSource } from "@/server/wordpress/pages/source";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerDictionary();
  return { title: `${t.vetrinaCatalog.pages.title} — Store Hub` };
}

function pageId(id: string): number {
  const n = Number(id);
  if (!/^\d{1,10}$/.test(id) || !Number.isSafeInteger(n) || n <= 0) throw new VetrinaError("not_found", "No such page.", 404);
  return n;
}

/** One page: its block markup as stored, read live on every visit, with the version a save is checked against. */
export default async function PageEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await attempt(async () => openPage(await getPageSource(), pageId(id)));
  return <PageScreen result={result} timeZone={automationNow().timeZone} />;
}
