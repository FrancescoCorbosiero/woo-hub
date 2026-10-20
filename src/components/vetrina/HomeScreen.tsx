"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Navbar, Page, Preloader, Link as KLink } from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import { blockConfig } from "@/config";
import { railSourceOf } from "@/lib/vetrina/sections";
import type { FieldValues, HomeBlock, RailSummary } from "@/lib/vetrina/types";
import type { VetrinaHome, VetrinaResult } from "@/server/vetrina/service";
import { publishVetrinaBlock } from "@/server/actions/vetrina";
import { ErrorState } from "./ErrorState";
import { FieldsSheet } from "./FieldsSheet";
import { HomeRow, staticFields, type StaticBlock } from "./HomeRow";
import { ActivityLink } from "./catalog/act/ActivityLink";
import { useOperationSettled } from "./catalog/act/operations-context";
import { FILL } from "./catalog/act/parts";
import { Plus } from "./catalog/act/icons";
import { TabbarSpacer } from "./catalog/TabbarSpacer";
import { SortArrows } from "./catalog/term/glyphs";
import { ArrangeSheet, type ArrangeRequest } from "./sections/ArrangeSheet";
import { NewSectionSheet, type NewSectionRequest } from "./sections/NewSectionSheet";
import { cardId } from "./sections/RailCard";
import { SectionMenu } from "./sections/SectionMenu";
import { SourceSheet, type SourceRequest } from "./sections/SourceSheet";
import { useStandalone } from "./sheet-mount";
import { ChevronLeft, External, Refresh } from "./icons";

/**
 * "La tua homepage": every block of the page in order. Product rails are
 * cards showing what the site shows right now; static blocks are thin rows
 * so the page still reads like the real one. The sections themselves are
 * the owner's too, as far as the config and the site's plugin allow: a new
 * one, their places ("Sposta le sezioni"), and each card's "⋯" — what it
 * shows, up, down, its switch, taking it away — and its "Aggiungi prodotti".
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
  const blockLabel = (block: HomeBlock) =>
    blockConfig(block.name).label ?? v.blocks[block.name] ?? v.blocks.other;

  // The sections themselves: the menu of one, a new one, their places, what one shows.
  const sx = t.vetrinaCatalog.sections;
  const data = result.ok ? result.data : null;
  const rails = React.useMemo(() => (data ? data.home.blocks.flatMap((b) => (b.kind === "rail" ? [b.rail] : [])) : []), [data]);
  const keys = React.useMemo(() => rails.map((r) => r.key), [rails]);
  const [menuRail, setMenuRail] = React.useState<RailSummary | null>(null);
  const [arrangeOpen, setArrangeOpen] = React.useState(false);
  const [newAfter, setNewAfter] = React.useState<{ after: string | null } | null>(null);
  const [sourceRail, setSourceRail] = React.useState<RailSummary | null>(null);
  const canPin = blockConfig("golden-hive/shortcode-wrapper").edit.pins;

  // A new section, once the page is read again: brought into view, ringed for a moment. Until then its
  // key may name another section (one showing the same thing, renumbered by the new one), so it waits
  // for the page with one section more.
  const [highlight, setHighlight] = React.useState<{ key: string; sections: number } | null>(null);
  const ringed = highlight && keys.length !== highlight.sections && keys.includes(highlight.key) ? highlight.key : null;
  React.useEffect(() => {
    if (!ringed) return;
    document.getElementById(cardId(ringed))?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = setTimeout(() => setHighlight(null), 2400);
    return () => clearTimeout(timer);
  }, [ringed]);

  const arrangeRequest: ArrangeRequest | null =
    arrangeOpen && data
      ? {
          sections: rails.map((r) => ({
            key: r.key,
            title: r.title.trim() || r.key,
            eyebrow: r.eyebrow,
            switchedOff: r.switchedOff,
            thumbs: r.products.slice(0, 2).map((p) => p.image),
          })),
          modifiedGmt: data.home.modifiedGmt,
        }
      : null;
  const newRequest: NewSectionRequest | null =
    newAfter && data
      ? {
          sections: rails.map((r) => ({ key: r.key, title: r.title.trim() || r.key, limit: r.limit })),
          after: newAfter.after,
          modifiedGmt: data.home.modifiedGmt,
        }
      : null;
  const sourceRequest: SourceRequest | null = (() => {
    if (!sourceRail || !data) return null;
    const current = railSourceOf(sourceRail);
    return {
      key: sourceRail.key,
      title: sourceRail.title.trim() || sourceRail.key,
      current,
      expectedModifiedGmt: data.home.modifiedGmt,
      expectedAttrsHash: sourceRail.attrsHash,
      button: { text: sourceRail.button.text },
      before: current
        ? {
            source: current,
            title: sourceRail.title,
            buttonUrl: sourceRail.button.url,
            pin: sourceRail.pin,
            exclude: sourceRail.exclude,
            fallback: sourceRail.fallback,
          }
        : null,
    };
  })();

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
        right={<ActivityLink />}
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
          {/* The sections themselves: their places, a new one. */}
          {((result.data.powers.move && rails.length > 1) || (result.data.powers.add && rails.length > 0)) && (
            <div className="flex gap-2">
              {result.data.powers.move && rails.length > 1 && (
                <Button rounded tonal onClick={() => setArrangeOpen(true)} className="!h-11 flex-1 gap-1.5 !px-3">
                  <SortArrows className="h-4 w-4 shrink-0" />
                  <span className="truncate">{sx.arrange.open}</span>
                </Button>
              )}
              {result.data.powers.add && rails.length > 0 && (
                <Button rounded colors={FILL} onClick={() => setNewAfter({ after: null })} className="!h-11 flex-1 gap-1 !px-3">
                  <Plus className="h-4 w-4 shrink-0" />
                  <span className="truncate">{sx.add.open}</span>
                </Button>
              )}
            </div>
          )}
          {result.data.home.blocks.map((block) => (
            <React.Fragment key={block.path}>
              <HomeRow
                block={block}
                label={blockLabel(block)}
                locks={result.data.locks}
                collections={result.data.collections}
                onEdit={() => setEditingPath(block.path)}
                onMenu={setMenuRail}
                highlighted={block.kind === "rail" && block.rail.key === ringed}
                canPin={canPin}
              />
              {/* Right after the last section: a new one goes there. */}
              {result.data.powers.add && block.kind === "rail" && block.rail.key === keys[keys.length - 1] && (
                <Button large rounded tonal onClick={() => setNewAfter({ after: block.rail.key })} className="w-full gap-1.5">
                  <Plus className="h-5 w-5" />
                  {sx.add.open}
                </Button>
              )}
            </React.Fragment>
          ))}
          {result.data.powers.pluginOutdated && <p className="px-1 text-[13px] leading-snug opacity-50">{sx.outdated}</p>}
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

      {data && (
        <>
          <SectionMenu
            rail={menuRail}
            keys={keys}
            modifiedGmt={data.home.modifiedGmt}
            powers={data.powers}
            canPin={canPin}
            siteLink={data.home.link}
            onClose={() => setMenuRail(null)}
            onChangeSource={setSourceRail}
            onAddBelow={(key) => setNewAfter({ after: key })}
          />
          <ArrangeSheet request={arrangeRequest} onClose={() => setArrangeOpen(false)} />
          <NewSectionSheet
            request={newRequest}
            lists={data.powers.lists}
            onClose={() => setNewAfter(null)}
            onAdded={(key, sections) => setHighlight({ key, sections })}
          />
          <SourceSheet request={sourceRequest} lists={data.powers.lists} onClose={() => setSourceRail(null)} />
        </>
      )}
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
        right={<ActivityLink />}
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
