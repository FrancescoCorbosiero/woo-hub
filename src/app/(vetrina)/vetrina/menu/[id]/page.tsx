import type { Metadata } from "next";
import { getServerDictionary } from "@/i18n/server";
import { MenuScreen } from "@/components/vetrina/menus/MenuScreen";
import { menuId } from "@/server/api/menus";
import { attempt } from "@/server/vetrina/service";
import { getMenuSource, menuDigest } from "@/server/wordpress/menus/source";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerDictionary();
  return { title: `${t.vetrinaCatalog.menus.title} — Store Hub` };
}

/** One menu of the site, its items top to bottom: read live from WordPress on every visit, with the fingerprint each write is checked against. */
export default async function MenuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await attempt(async () => {
    // The menu and the theme's places read together: three requests to WordPress.
    const { menu, places } = await (await getMenuSource()).menuAndPlaces(menuId(id));
    return { menu, digest: menuDigest(menu), places };
  });
  return <MenuScreen result={result} />;
}
