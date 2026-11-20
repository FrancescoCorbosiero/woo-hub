import "server-only";
import type { PageRead } from "@/lib/pages/types";
import { VetrinaError } from "@/server/vetrina/source";
import { DEMO_BLOCK_TYPES } from "./demo-registry";
import { markupDigest, type PageSource, type StoredPage } from "./source";

/**
 * The demo shop's pages (VETRINA_SOURCE=fixture), held in memory, with
 * WordPress's rules for a save over wp/v2/pages: the markup is stored as
 * sent, the modified time moves (to the second), and a revision is kept.
 * The block registry is golden-hive-blocks' own (5.17.0's block.json files,
 * as WordPress's block-types endpoint answers them: __fixtures__).
 *
 * The front page here is not the homepage the Vetrina's demo edits (that
 * one is a model of the page, not markup): saving it changes this copy only.
 * Nothing is written anywhere; a restart puts the pages back.
 */

const SITE = "https://demo.shop";

interface DemoPage {
  id: number;
  title: string;
  parent: number;
  slug: string;
  markup: string;
  modified: number;
  revisions: number;
}

const para = (text: string) => `<!-- wp:paragraph -->\n<p>${text}</p>\n<!-- /wp:paragraph -->`;

const HOME = `<!-- wp:golden-hive/hero-carousel {"slides":[{"image":"${SITE}/wp-content/uploads/drop.jpg","eyebrow":"NUOVA COLLEZIONE","title":"IL DROP DI NOVEMBRE","buttonText":"SCOPRI","buttonUrl":"/categoria-prodotto/novita/"}]} /-->

<!-- wp:golden-hive/trust-badges /-->

<!-- wp:group {"layout":{"type":"constrained","contentSize":"1600px"}} -->
<div class="wp-block-group"><!-- wp:golden-hive/shortcode-wrapper {"eyebrow":"Selezione","title":"IN TENDENZA","shortcode":"[gh_product_rail category='in-tendenza' limit='12']"} /-->

<!-- wp:golden-hive/shortcode-wrapper {"eyebrow":"Fino al 50%","title":"SALDI","shortcode":"[gh_product_rail category='saldi-sneakers-outlet' limit='18' columns='4']","backgroundColor":"gray"} /--></div>
<!-- /wp:group -->

<!-- wp:golden-hive/faq-schema {"items":[{"question":"Fate i resi?","answer":"<p>Sì, entro 14 giorni.</p>"}]} /-->

<!-- wp:golden-hive/whatsapp-button {"phoneNumber":"390000000000","iconOnly":true} /-->
`;

const ABOUT = `<!-- wp:golden-hive/about-hero {"eyebrow":"La storia","title":"NATI A PIACENZA","text":"Sneaker e streetwear, scelti uno a uno."} /-->

<!-- wp:golden-hive/authenticity-guarantee /-->

<!-- wp:golden-hive/store-visit /-->
`;

const CONTACTS = `<!-- wp:golden-hive/contact-info {"title":"Scrivici","phone":"+39 000 000 0000","email":"info@demo.shop"} /-->

<!-- wp:golden-hive/store-hours /-->
`;

const GUIDE = `<!-- wp:heading -->
<h2 class="wp-block-heading">Guida alle taglie</h2>
<!-- /wp:heading -->

${para("Trova la tua taglia EU nella tabella.")}

<!-- wp:table -->
<figure class="wp-block-table"><table><thead><tr><th>EU</th><th>US</th><th>CM</th></tr></thead><tbody><tr><td>42</td><td>8.5</td><td>26.5</td></tr></tbody></table></figure>
<!-- /wp:table -->
`;

function initial(): DemoPage[] {
  const at = Date.parse("2026-11-02T09:30:00Z");
  const page = (id: number, title: string, slug: string, markup: string): DemoPage => ({ id, title, parent: 0, slug, markup, modified: at + id * 60_000, revisions: 3 });
  return [
    page(1, "Home", "home", HOME),
    page(2, "Chi siamo", "chi-siamo", ABOUT),
    page(3, "Contatti", "contatti", CONTACTS),
    page(4, "Spedizioni e resi", "spedizioni-e-resi", para("Spediamo in 24/48 ore in tutta Italia.")),
    page(5, "Termini e condizioni", "termini-e-condizioni", para("Le condizioni di vendita del negozio.")),
    page(6, "Guida alle taglie", "guida-alle-taglie", GUIDE),
  ];
}

// Shared across server bundles, like the demo homepage.
const g = globalThis as { __pagesDemo?: DemoPage[] };
const pages = () => (g.__pagesDemo ??= initial());

/** WordPress's modified_gmt: to the second, no zone. */
const gmt = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().slice(0, 19);
const url = (p: DemoPage) => (p.id === 1 ? `${SITE}/` : `${SITE}/${p.slug}/`);

function find(id: number): DemoPage {
  const page = pages().find((p) => p.id === id);
  if (!page) throw new VetrinaError("not_found", `There is no page ${id}.`, 404);
  return page;
}

function readOf(p: DemoPage): PageRead {
  return { id: p.id, title: p.title, url: url(p), status: "publish", markup: p.markup, version: { modifiedGmt: gmt(p.modified), digest: markupDigest(p.markup) } };
}

/** Back to the pages as they always are (tests). */
export function resetDemoPages(): void {
  g.__pagesDemo = initial();
}

export function fixturePages(): PageSource {
  return {
    kind: "fixture",
    async list() {
      return pages()
        .map((p) => ({ id: p.id, title: p.title, parent: p.parent, url: url(p) }))
        .sort((a, b) => a.title.localeCompare(b.title, "it"));
    },
    async read(id) {
      return readOf(find(id));
    },
    async save(id, markup): Promise<StoredPage> {
      const page = find(id);
      page.markup = markup;
      // A later second than before, as two saves of one page are in WordPress.
      page.modified = Math.max(Date.now(), Math.floor(page.modified / 1000) * 1000 + 1000);
      page.revisions += 1;
      const read = readOf(page);
      return { markup, url: read.url, version: read.version, revisions: page.revisions, revisionsUrl: `${SITE}/wp-admin/revision.php?revision=${1000 + page.id * 100 + page.revisions}` };
    },
    async blockTypes(namespace) {
      return DEMO_BLOCK_TYPES.filter((b) => b.name.startsWith(`${namespace}/`));
    },
    async access() {
      return { user: "Demo", missing: [], filtered: false };
    },
    async vetrinaPageId() {
      return 1;
    },
  };
}
