"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Navbar, Page, Preloader, Link as KLink } from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import { blockConfig } from "@/config";
import { describeRule } from "@/lib/collections/describe";
import { railCategory } from "@/lib/collections/rail";
import type { RailCollection } from "@/lib/collections/types";
import { editableFields } from "@/lib/vetrina/fields";
import { railKeyToParam } from "@/lib/vetrina/order";
import { skuKey } from "@/lib/skus";
import type { FieldValues, HomeBlock, RailSummary } from "@/lib/vetrina/types";
import type { VetrinaHome, VetrinaResult } from "@/server/vetrina/service";
import { publishVetrinaBlock } from "@/server/actions/vetrina";
import { ErrorState } from "./ErrorState";
import { railHealth } from "./rail-health";
import { FieldsSheet } from "./FieldsSheet";
import { ActivityLink } from "./catalog/act/ActivityLink";
import { useOperationSettled } from "./catalog/act/operations-context";
import { OrderLines, Warning } from "./catalog/act/icons";
import { railCatalogHref } from "./catalog/sheet/links";
import { TabbarSpacer } from "./catalog/TabbarSpacer";
import { useOrderSourceSheets } from "./catalog/sources/SourceOrderSheet";
import { Stack } from "./catalog/term/glyphs";
import { useStandalone } from "./sheet-mount";
import { ChevronLeft, ChevronRight, External, Funnel, Lock, Pin, Refresh } from "./icons";

type StaticBlock = Extract<HomeBlock, { kind: "static" }>;

/** The fields of a block the customer may edit here; empty when none. */
function staticFields(block: HomeBlock): string[] {
  if (block.kind !== "static" || !block.fields || !block.attrsHash) return [];
  return editableFields(block.name, blockConfig(block.name).edit.fields, block.fields);
}

/**
 * "La tua homepage": every block of the page in order. Product rails are
 * cards showing what the site shows right now; static blocks are thin rows
 * so the page still reads like the real one.
 */
export function HomeScreen({ result }: { result: VetrinaResult<VetrinaHome> }) {
  const { t } = useI18n();
  const router = useRouter();
  const v = t.vetrina;
  // An action that ended — or its "Annulla", from the log this tab opens — may have moved the page:
  // a pin (a new revision of the homepage, so a block saved from the old one would be refused), a
  // product hidden or put on sale (the cards' health line and prices). Read the page again.
  useOperationSettled(() => router.refresh());

  // A block's texts, edited in a sheet and saved straight to the site.
  const [editingPath, setEditingPath] = React.useState<string | null>(null);
  const editing = result.ok
    ? (result.data.home.blocks.find((b): b is StaticBlock => b.kind === "static" && b.path === editingPath) ?? null)
    : null;
  // The catalog's order sources are reached from here too: the Vetrina's first screen.
  const sourceSheets = useOrderSourceSheets();
  const blockLabel = (block: HomeBlock) =>
    blockConfig(block.name).label ?? v.blocks[block.name] ?? v.blocks.other;

  async function saveBlock(block: StaticBlock, fields: FieldValues): Promise<boolean> {
    if (!result.ok || !block.attrsHash) return false;
    const res = await publishVetrinaBlock({
      path: block.path,
      blockName: block.name,
      expectedModifiedGmt: result.data.home.modifiedGmt,
      expectedAttrsHash: block.attrsHash,
      fields: Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, value.trim()])),
    });
    if (!res.ok) {
      toast.error(v.errors[res.code] ?? res.error);
      if (res.code === "stale") router.refresh();
      return res.code === "stale";
    }
    toast.success(result.data.source === "fixture" ? v.section.savedDemo : v.section.saved);
    router.refresh();
    return true;
  }

  return (
    <Page>
      <HomeNavbar
        subtitle={result.ok && result.data.source === "fixture" ? v.demo : undefined}
        refresh={
          <KLink iconOnly onClick={() => router.refresh()} aria-label={v.refresh}>
            <Refresh className="h-5 w-5" />
          </KLink>
        }
        right={
          <>
            <KLink iconOnly onClick={sourceSheets.manage} aria-label={t.vetrinaCatalog.sources.open} aria-haspopup="dialog">
              <OrderLines className="h-6 w-6" />
            </KLink>
            <ActivityLink />
          </>
        }
      />

      {!result.ok ? (
        <ErrorState code={result.code} error={result.error} />
      ) : (
        // No bottom room of its own: TabbarSpacer leaves it, the safe area included.
        <div className="space-y-3 px-4 pb-1 pt-1">
          <p className="px-1 text-[15px] leading-snug opacity-60">{v.home.intro}</p>
          <a
            href={result.data.home.link}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-1 text-[15px] font-medium text-primary"
          >
            {v.viewSite}
            <External className="h-4 w-4" />
          </a>
          {result.data.home.blocks.map((block) => (
            <HomeRow
              key={block.path}
              block={block}
              label={blockLabel(block)}
              locks={result.data.locks}
              collections={result.data.collections}
              onEdit={() => setEditingPath(block.path)}
            />
          ))}
        </div>
      )}
      <TabbarSpacer />

      <FieldsSheet
        open={editing != null}
        title={editing ? v.section.blockSheetTitle(blockLabel(editing)) : ""}
        blockName={editing?.name ?? ""}
        fieldKeys={editing ? staticFields(editing) : []}
        values={editing?.fields ?? {}}
        submitLabel={v.section.save}
        busyLabel={v.section.saving}
        onSubmit={(fields) => (editing ? saveBlock(editing, fields) : true)}
        onClose={() => setEditingPath(null)}
      />
      {sourceSheets.sheets}
    </Page>
  );
}

/**
 * The homepage tab's navbar: a large title named like its tab, the way back
 * to the Hub (not on the Vetrina's own address) and, folded, a title that
 * stays clear of the side buttons.
 */
function HomeNavbar({ subtitle, refresh, right }: { subtitle?: string; refresh: React.ReactNode; right: React.ReactNode }) {
  const { t } = useI18n();
  // On the Vetrina's own address the operator Hub is not served: no way back to it.
  const standalone = useStandalone();
  return (
    <Navbar
      large
      transparent
      centerTitle
      title={t.vetrinaCatalog.home.tabs.homepage}
      subtitle={subtitle}
      // Folded, the small title stays clear of the side buttons (Hub and refresh on the left, the log on the right).
      titleClassName={`truncate ${standalone ? "max-w-[calc(100%-176px)]" : "max-w-[calc(100%-272px)]"}`}
      subtitleClassName="truncate"
      // Refresh on the left, beside the way back, as on the Catalogo tab: switching tabs never moves it.
      left={
        <>
          {!standalone && (
            <KLink href="/" component="a" className="gap-0.5 !px-2">
              <ChevronLeft className="h-5 w-5" />
              {t.vetrina.backToHub}
            </KLink>
          )}
          {refresh}
        </>
      }
      right={right}
    />
  );
}

/**
 * The homepage tab while the site answers (it is read live on every visit):
 * the same navbar, then the shape of its cards, so switching tabs does not
 * make the title jump from small to large. For vetrina/loading.tsx.
 */
export function HomeScreenSkeleton() {
  const { t } = useI18n();
  const bar = "block rounded-full bg-black/[0.08] dark:bg-white/[0.12]";
  const box = "block rounded-xl bg-black/[0.05] dark:bg-white/10";
  return (
    <Page>
      <HomeNavbar
        refresh={
          <KLink iconOnly aria-label={t.vetrina.refresh}>
            <Preloader className="!h-5 !w-5" />
          </KLink>
        }
        right={
          <>
            <KLink iconOnly aria-label={t.vetrinaCatalog.sources.open}>
              <OrderLines className="h-6 w-6" />
            </KLink>
            <ActivityLink />
          </>
        }
      />
      <div aria-hidden className="space-y-3 px-4 pb-1 pt-1 motion-safe:animate-pulse">
        <div className="space-y-2 px-1 py-0.5">
          <span className={`${bar} h-3.5 w-[92%]`} />
          <span className={`${bar} h-3.5 w-[64%]`} />
        </div>
        <span className={`${bar} mx-1 h-3.5 w-24`} />
        {[0, 1, 2].map((card) => (
          <div key={card} className="overflow-hidden rounded-2xl bg-white px-4 pb-3.5 pt-3.5 shadow-sm dark:bg-[#1c1c1e]">
            <span className={`${bar} h-4 w-40`} />
            <div className="mt-3 flex gap-2 overflow-hidden pb-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className={`${box} h-[72px] w-[72px] shrink-0`} />
              ))}
            </div>
            <span className={`${bar} mt-2 h-3 w-28`} />
          </div>
        ))}
      </div>
      <TabbarSpacer />
    </Page>
  );
}

function HomeRow({
  block,
  label,
  locks,
  collections,
  onEdit,
}: {
  block: HomeBlock;
  label: string;
  locks: Record<string, number>;
  collections: Record<number, RailCollection>;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const config = blockConfig(block.name);
  if (config.show === "hidden") return null;

  if (block.kind === "rail" && config.show === "rail") {
    const category = railCategory(block.rail);
    return <RailCard rail={block.rail} locks={locks} collection={category != null ? (collections[category] ?? null) : null} />;
  }

  const summary = block.kind === "static" ? block.summary : null;
  const editable = staticFields(block).length > 0;
  const title = block.kind === "static" ? (block.fields?.title ?? summary?.title ?? null) : null;
  const inner = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate opacity-70">
          {label}
          {summary?.items != null && <span className="opacity-80"> · {t.vetrina.home.items(summary.items)}</span>}
        </span>
        {editable && title && <span className="block truncate text-[13px] font-medium">{title}</span>}
      </span>
      {editable ? (
        <span className="shrink-0 rounded-full bg-black/5 px-2.5 py-0.5 text-[12px] font-medium dark:bg-white/10">
          {t.vetrina.section.edit}
        </span>
      ) : (
        <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[12px] opacity-60 dark:bg-white/10">
          {t.vetrina.home.fromSite}
        </span>
      )}
    </>
  );
  const frame = "flex w-full items-center gap-3 rounded-2xl border border-black/5 px-4 py-3 text-left text-[15px] dark:border-white/10";
  return editable ? (
    <button type="button" onClick={onEdit} className={`${frame} transition-opacity active:opacity-60`}>
      {inner}
    </button>
  ) : (
    <div className={frame}>{inner}</div>
  );
}

function RailCard({
  rail,
  locks,
  collection,
}: {
  rail: RailSummary;
  locks: Record<string, number>;
  /** The rule filling the rail's category, when it is automatic. */
  collection: RailCollection | null;
}) {
  const { t } = useI18n();
  const v = t.vetrina.home;
  const r = t.vetrinaCatalog.home.rail;
  const auto = t.vetrina.auto;
  const pinned = rail.pin.length;
  const hidden = rail.exclude.length;
  const health = railHealth(rail, r);
  // A section showing exactly one category or brand: its screen in the catalog, one tap away.
  const catalogHref = railCatalogHref(rail);
  const sectionHref = rail.editable ? `/vetrina/sezione/${railKeyToParam(rail.key)}` : null;

  const heading = (
    <div className="min-w-0 flex-1">
      {rail.eyebrow && (
        <div className="truncate text-[12px] font-semibold uppercase tracking-wide opacity-50">{rail.eyebrow}</div>
      )}
      {/* Two lines before it is cut: beside the "Catalogo" chip, one line would cut most titles short. */}
      <div className="line-clamp-2 break-words text-[19px] font-bold leading-tight">{rail.title || rail.key}</div>
      {collection && (
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px]">
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              !collection.enabled
                ? "bg-black/5 opacity-60 dark:bg-white/10"
                : collection.held || collection.lastError
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300"
                  : "bg-[#d4a017]/15 text-[#8a6b00] dark:text-[#e8c35a]"
            }`}
          >
            <Funnel className="h-3 w-3" />
            {!collection.enabled
              ? auto.paused
              : collection.held
                ? auto.held
                : collection.lastError
                  ? auto.problem
                  : auto.badge}
          </span>
          <span className="truncate opacity-60">{describeRule(collection, t.collections.words)}</span>
        </div>
      )}
    </div>
  );
  const chevron = rail.editable && <ChevronRight className="h-5 w-5 shrink-0 opacity-30" />;

  const content = (
    <>
      {rail.products.length === 0 ? (
        <p className="px-4 py-3 text-[15px] opacity-50">{v.empty}</p>
      ) : (
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {rail.products.slice(0, 12).map((p, i) => (
            <div key={p.id} className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- the shop's own thumbnail sizes */}
              <img
                src={p.image}
                alt={p.name}
                loading="lazy"
                className="h-[72px] w-[72px] overflow-hidden rounded-xl bg-black/[0.04] object-contain text-[0px] dark:bg-white/10"
              />
              <span className="absolute left-1 top-1 rounded-md bg-white/90 px-1 text-[11px] font-semibold tabular-nums text-black shadow-sm">
                {i + 1}
              </span>
              {(locks[skuKey(p.sku)] ?? 0) > 0 && (
                <span className="absolute bottom-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-black/80 text-white">
                  <Lock className="h-3 w-3" />
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {health && (
        <div className="flex items-center gap-1.5 px-4 pt-2 text-[13px] font-medium text-amber-700 dark:text-amber-400">
          <Warning className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">{r.health(health)}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-3.5 pt-2 text-[13px] opacity-60">
        <span>{v.inHomepage(Math.min(rail.limit, rail.products.length))}</span>
        {pinned > 0 && (
          <span className="inline-flex items-center gap-1">
            <Pin className="h-3.5 w-3.5 text-amber-600" />
            {v.pinned(pinned)}
          </span>
        )}
        {hidden > 0 && <span>{v.hidden(hidden)}</span>}
        {!rail.editable && <span>{v.fixedList}</span>}
      </div>
    </>
  );

  const frame = "block overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-[#1c1c1e]";

  if (!catalogHref) {
    const body = (
      <>
        <div className="flex items-center gap-2 px-4 pt-3.5">
          {heading}
          {chevron}
        </div>
        {content}
      </>
    );
    return sectionHref ? (
      <Link href={sectionHref} className={`${frame} active:opacity-80`}>
        {body}
      </Link>
    ) : (
      <div className={frame}>{body}</div>
    );
  }

  // With its catalog link the card is two links side by side (a link cannot
  // hold another): the section editor's — the title, the products, the
  // counts — and the catalog's. Pressing any part of the first dims the whole
  // card, as before.
  const toSection = (className: string, children: React.ReactNode, decorative = false) =>
    sectionHref ? (
      <Link
        href={sectionHref}
        className={`card-link ${className}`}
        tabIndex={decorative ? -1 : undefined}
        aria-hidden={decorative || undefined}
      >
        {children}
      </Link>
    ) : (
      <div className={className}>{children}</div>
    );

  return (
    <div className={`${frame} has-[.card-link:active]:opacity-80`}>
      <div className="flex items-center">
        {toSection("flex min-w-0 flex-1 items-center pe-2 ps-4 pt-3.5", heading)}
        <Link
          href={catalogHref}
          aria-label={r.catalogLabel(rail.terms[0]?.name ?? rail.title)}
          // A 44px target that takes no more room than the pill it holds.
          className={`-mb-2.5 mt-1 flex h-11 shrink-0 items-center transition-opacity active:opacity-50 ${chevron ? "" : "pe-3"}`}
        >
          <span className="inline-flex h-7 items-center gap-1 rounded-full bg-black/[0.06] px-2.5 text-[13px] font-semibold dark:bg-white/10">
            <Stack className="h-3.5 w-3.5 opacity-60" />
            {r.catalog}
          </span>
        </Link>
        {chevron && toSection("flex items-center self-stretch pe-4 ps-1.5 pt-3.5", chevron, true)}
      </div>
      {/* flow-root: the products' top margin stays inside the link, so the gap is tappable too. */}
      {toSection("flow-root", content)}
    </div>
  );
}
