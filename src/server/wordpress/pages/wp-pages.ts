import "server-only";
import { hubConfig } from "@/config";
import type { BlockTypeSpec, PageRead, PageSummary } from "@/lib/pages/types";
import { decodeEntities } from "@/server/collections/index-rows";
import { getVetrinaSource } from "@/server/vetrina/source";
import { restRoot, wp, type WpPage, type WpPageEdit } from "../client";
import { accessOf, markupDigest, type PageSource, type StoredPage } from "./source";

/**
 * The live site's pages, over WordPress's own REST API (../client.ts),
 * signed in with the Application Password (WP_APP_USER, WP_APP_PASSWORD).
 */

const titleText = (title: WpPage["title"]) => decodeEntities(typeof title === "string" ? title : (title.raw ?? title.rendered));

/** WordPress's admin, beside its REST root. */
function adminUrl(path: string): string {
  return `${restRoot().replace(/\/wp-json$/, "")}/wp-admin/${path}`;
}

function readOf(page: WpPageEdit): PageRead {
  return {
    id: page.id,
    title: titleText(page.title),
    url: page.link,
    status: page.status,
    markup: page.content.raw,
    version: { modifiedGmt: page.modified_gmt, digest: markupDigest(page.content.raw) },
  };
}

export function wordpressPages(): PageSource {
  return {
    kind: "wordpress",

    async list(): Promise<PageSummary[]> {
      return (await wp.pages()).map((p) => ({ id: p.id, title: titleText(p.title), parent: p.parent, url: p.link }));
    },

    async read(id) {
      return readOf(await wp.page(id));
    },

    async save(id, markup): Promise<StoredPage> {
      const page = await wp.savePage(id, markup);
      const latest = page._links?.["predecessor-version"]?.[0]?.id;
      return {
        markup: page.content.raw,
        url: page.link,
        version: { modifiedGmt: page.modified_gmt, digest: markupDigest(page.content.raw) },
        revisions: page._links?.["version-history"]?.[0]?.count ?? null,
        revisionsUrl: latest ? adminUrl(`revision.php?revision=${latest}`) : null,
      };
    },

    async blockTypes(namespace): Promise<BlockTypeSpec[]> {
      return (await wp.blockTypes(namespace)).map((b) => ({
        name: b.name,
        title: b.title || b.name,
        attributes: Object.fromEntries(Object.entries(b.attributes ?? {}).map(([k, a]) => [k, { type: a.type, enum: a.enum }])),
      }));
    },

    async access() {
      const me = await wp.me();
      return accessOf(me.name || me.slug, me.capabilities);
    },

    async vetrinaPageId() {
      const page = hubConfig.vetrina.page;
      if (page !== "front") return page.id;
      // The plugin says which page is the front page, with the shop's Woo keys: reading
      // wp/v2/settings would need the Application Password's user to manage options.
      try {
        const id = (await (await getVetrinaSource()).capabilities()).frontPageId;
        return id > 0 ? id : null;
      } catch {
        return null;
      }
    },
  };
}
