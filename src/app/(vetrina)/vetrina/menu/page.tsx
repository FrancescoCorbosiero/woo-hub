import type { Metadata } from "next";
import { getServerDictionary } from "@/i18n/server";
import { MenusHome } from "@/components/vetrina/menus/MenusHome";
import { getMenuSource } from "@/server/wordpress/menus/source";
import { attempt } from "@/server/vetrina/service";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerDictionary();
  return { title: `${t.vetrinaCatalog.menus.title} — Store Hub` };
}

/** "Menu": the site's navigation menus and the theme's places, read live from WordPress on every visit. */
export default async function MenusPage() {
  // One read of the menus and the places together: three requests to WordPress.
  const result = await attempt(async () => (await getMenuSource()).overview());
  return <MenusHome result={result} />;
}
