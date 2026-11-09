import type { Metadata } from "next";
import { getServerDictionary } from "@/i18n/server";
import { MenusHome } from "@/components/vetrina/menus/MenusHome";
import { listMenus } from "@/server/api/menus";
import { attempt } from "@/server/vetrina/service";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerDictionary();
  return { title: `${t.vetrinaCatalog.menus.title} — Store Hub` };
}

/** "Menu": the site's navigation menus, read live from WordPress on every visit. */
export default async function MenusPage() {
  const result = await attempt(() => listMenus());
  return <MenusHome result={result} />;
}
