"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Reorder } from "motion/react";
import { Block, Button, Link as KLink, Navbar, NavbarBackLink, Page } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { BlockConfig } from "@/config";
import { railCategory } from "@/lib/collections/rail";
import { skuKey } from "@/lib/skus";
import { railTaxonomy, toProductCard } from "@/lib/vetrina/catalog";
import { changedFields, editableFields, SWITCH_FIELD, switchable } from "@/lib/vetrina/fields";
import { buildRows, hide, pinToTop, pinsAfterPlacing, show, unpin } from "@/lib/vetrina/order";
import {
  hiddenReasonOf,
  layoutRows,
  rowIndexOfPosition,
  sectionFill,
  visibleWithJoiners,
  withPicked,
} from "@/lib/vetrina/section-editor";
import { railSourceOf } from "@/lib/vetrina/sections";
import type { RailFallback } from "@/lib/vetrina/types";
import type { VetrinaRail, VetrinaResult } from "@/server/vetrina/service";
import { Plus } from "./catalog/act/icons";
import type { OrderTerm } from "./catalog/act/OrderSheet";
import { ReorderSheet } from "./catalog/act/ReorderSheet";
import { railCatalogHref, sectionHref } from "./catalog/sheet/links";
import { RankingActions } from "./catalog/sources/RankingActions";
import { useOrderSourceSheets } from "./catalog/sources/SourceOrderSheet";
import { ProductPicker, type PickedProduct, type PickerSection, type PickPlace } from "./sections/ProductPicker";
import { SourceSheet, type SourceRequest } from "./sections/SourceSheet";
import { CollectionSheet } from "./CollectionSheet";
import { ErrorState } from "./ErrorState";
import { FieldsSheet } from "./FieldsSheet";
import { HistorySheet } from "./HistorySheet";
import { ProductSheet } from "./ProductSheet";
import { More } from "./icons";
import { PositionDialog, StaleDialog } from "./section-editor/dialogs";
import { HiddenProducts } from "./section-editor/HiddenProducts";
import { PublishBar } from "./section-editor/PublishBar";
import { RailRow } from "./section-editor/RailRow";
import { RowActions } from "./section-editor/RowActions";
import { SectionActions } from "./section-editor/SectionActions";
import { AutoOrderCard, LooksCard, RuleCard, ShowsCard, SwitchCard, type OneTerm } from "./section-editor/SectionCards";
import { useRowDrag } from "./section-editor/use-row-drag";
import { useMissingCards, useSectionCards } from "./section-editor/use-section-cards";
import { useSectionDraft } from "./section-editor/use-section-draft";
import { useSectionPublish } from "./section-editor/use-section-publish";
import { useSectionRail } from "./section-editor/use-section-rail";
import { useBack } from "./use-back";

export interface EditorOptions {
  fallbacks: RailFallback[];
  edit: BlockConfig["edit"];
  maxPins: number;
  maxLimit: number;
  pageSize: number;
}

const RAIL_BLOCK = "golden-hive/shortcode-wrapper";

/**
 * The rail editor: the rail as a list, in the order the site will show it.
 *
 * Pinned products ("fissati") come first, in the customer's order; the rest
 * follow automatically. Drag from the grip — or use the ⋯ sheet — to pin;
 * nothing reaches the site until "Pubblica". The order is recomputed on the
 * phone with the site's own rule (lib/vetrina/order.ts), so what the list
 * shows is what the homepage will render.
 *
 * The screen composes its parts (section-editor/): the draft and its undo,
 * the site's word on the section, the cards, the publish; the decisions
 * themselves are pure (lib/vetrina/section-editor.ts).
 */
export function RailEditor({
  railKey,
  initial,
  options,
  openPicker = false,
}: {
  railKey: string;
  initial: VetrinaResult<VetrinaRail>;
  options: EditorOptions;
  /** Opened from the homepage's "Aggiungi prodotti": the catalog's picker opens at once. */
  openPicker?: boolean;
}) {
  const { t } = useI18n();
  if (!initial.ok) {
    return (
      <Page>
        <Navbar title={t.vetrina.title} left={<BackLink dirty={false} />} />
        <ErrorState code={initial.code} error={initial.error} />
      </Page>
    );
  }
  // Keyed: a section pointed elsewhere is a new key, and its editor starts from the section as it is now.
  return <Editor key={railKey} railKey={railKey} initial={initial.data} options={options} openPicker={openPicker} />;
}

/**
 * Back to where the editor was opened from — the homepage, or a category's
 * screen in the catalog — or the homepage when there is none (a link from
 * outside). An arrow alone: the screen behind is not always the homepage,
 * and the section's title keeps its room.
 */
function BackLink({ dirty }: { dirty: boolean }) {
  const { t } = useI18n();
  const back = useBack("/vetrina");
  return (
    <NavbarBackLink
      onClick={() => {
        if (dirty && !window.confirm(t.vetrina.editor.leaveConfirm)) return;
        back();
      }}
      aria-label={t.vetrinaCatalog.term.back}
    />
  );
}

const trimmed = (fields: Record<string, string>) =>
  Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, value.trim()]));

function Editor({
  railKey,
  initial,
  options,
  openPicker,
}: {
  railKey: string;
  initial: VetrinaRail;
  options: EditorOptions;
  openPicker: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const v = t.vetrina.editor;
  const sx = t.vetrinaCatalog.sections;
  const pk = t.vetrinaCatalog.picker;
  const demo = initial.source === "fixture";
  const powers = initial.powers;

  // The rail as the server last described it, the owner's draft over it, the cards, the site's word on it.
  const section = useSectionDraft(initial.rail, options.maxPins);
  const { base, draft, setDraft, saved, dirty, changes, fieldsChanged, resized, commit } = section;
  const store = useSectionCards({ cards: [...initial.rail.items, ...initial.rail.hidden], locks: initial.locks });
  const { cards, locks } = store;
  const rail = useSectionRail(railKey, initial, section, store.absorb);
  const { collection, reasons } = rail;

  // Products added from the catalog, until published — those that join the section's category then
  // are shown where they will be, the others (sold out, hidden) wait greyed with their reason.
  const [added, setAdded] = React.useState<Map<number, PickedProduct>>(() => new Map());
  const visible = React.useMemo(
    () => visibleWithJoiners(rail.siteVisible, draft.pin, added, base.hideOutOfStock),
    [rail.siteVisible, draft.pin, added, base.hideOutOfStock],
  );

  const rows = React.useMemo(() => buildRows(visible, draft), [visible, draft]);
  const rowById = React.useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const drag = useRowDrag(rows, (pin) => commit({ ...draft, pin }, v.moved.dragged));

  const [shown, setShown] = React.useState(options.pageSize);
  const orderIds = drag.dragIds ?? rows.map((r) => r.id);
  const renderIds = orderIds.slice(0, shown);
  // Cards for the rows on screen and the hidden products: those the section came with, the others asked for.
  useMissingCards(store, [...renderIds, ...draft.exclude]);
  // Positions and the fold, over the order being shown (ghosts take no place).
  const { positions, visibleCount, foldAfter } = layoutRows(orderIds, (id) => rowById.get(id)?.kind, draft.limit);

  // Leaving with unpublished changes asks first.
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Menus and sheets.
  const [menuFor, setMenuFor] = React.useState<number | null>(null);
  const [sectionMenu, setSectionMenu] = React.useState(false);
  const [positionFor, setPositionFor] = React.useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [looksOpen, setLooksOpen] = React.useState(false);
  const [productFor, setProductFor] = React.useState<number | null>(null);
  const [ruleOpen, setRuleOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(openPicker);
  const [sourceOpen, setSourceOpen] = React.useState(false);
  const [reorderTerm, setReorderTerm] = React.useState<OrderTerm | null>(null);
  const [rankingsOpen, setRankingsOpen] = React.useState(false);
  const sourceSheets = useOrderSourceSheets();

  // Opened with the picker from the homepage: the address forgets it, so a reload does not open it again.
  React.useEffect(() => {
    if (openPicker) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [openPicker]);

  // What fills the section: what may join it from the catalog, and what it shows in words.
  const categoryId = railCategory(base);
  const source = railSourceOf(base);
  const taxonomy = railTaxonomy(base.taxonomy);
  const oneTerm: OneTerm | null =
    taxonomy && base.terms.length === 1 ? { taxonomy, id: base.terms[0].id, name: base.terms[0].name } : null;
  const fill = sectionFill(oneTerm, collection != null, source);
  const canAdd = fill != null && options.edit.pins && base.editable;

  const pub = useSectionPublish({
    railKey,
    section,
    rail,
    added,
    joinTo: fill === "category" ? categoryId : null,
    onJoined: (ids) =>
      setAdded((prev) => {
        const next = new Map(prev);
        for (const id of ids) {
          const a = next.get(id);
          if (a) next.set(id, { ...a, joins: false });
        }
        return next;
      }),
    onPublished: () => setAdded(new Map()),
    demo,
  });

  // Texts and size: what the config allows and the site's plugin supports.
  const s = t.vetrina.section;
  const fieldKeys = editableFields(RAIL_BLOCK, options.edit.fields, base.fields);
  const canResize = options.edit.limit && base.editable && Object.keys(base.fields).length > 0;
  const canEditLooks = fieldKeys.length > 0 || canResize;
  const shownTitle = "title" in draft.fields ? draft.fields.title : base.title;
  const shownEyebrow = "eyebrow" in draft.fields ? draft.fields.eyebrow : base.eyebrow;
  const title = shownTitle || base.key;
  const termName = base.terms.map((term) => term.name).join(", ");

  const pickerSection: PickerSection = { title, fill: fill ?? "list", term: oneTerm };
  const pickedCards = React.useMemo(() => new Map([...added].map(([id, a]) => [id, toProductCard(a.product)])), [added]);
  const cardOf = (id: number) => cards.get(id) ?? pickedCards.get(id);

  /** The products picked in the catalog, pinned on top (or after the pins), in the order picked. */
  function addFromCatalog(picked: PickedProduct[], place: PickPlace) {
    if (picked.length === 0) return;
    setAdded((prev) => {
      const next = new Map(prev);
      for (const p of picked) next.set(p.product.id, p);
      return next;
    });
    commit(withPicked(draft, picked.map((p) => p.product.id), place), pk.added(picked.length));
  }

  /** Position N = the N-th product the site shows; ghosts are skipped. */
  function placeAt(id: number, position: number) {
    commit({ ...draft, pin: pinsAfterPlacing(rows, id, rowIndexOfPosition(rows, position)) }, v.moved.position(position));
  }

  // The section's switch, in the draft: published with the rest.
  const canSwitch = powers.switchOff && switchable(RAIL_BLOCK, true, base.fields);
  const switchedOn = (draft.fields[SWITCH_FIELD] ?? "") !== "yes";

  const sourceRequest: SourceRequest | null = sourceOpen
    ? {
        key: railKey,
        title,
        current: source,
        expectedModifiedGmt: base.modifiedGmt,
        expectedAttrsHash: base.attrsHash,
        button: { text: base.button.text },
        before: source
          ? { source, title: base.title, buttonUrl: base.button.url, pin: base.pin, exclude: base.exclude, fallback: base.fallback }
          : null,
        unpublished: dirty ? changes.total : 0,
      }
    : null;
  // A section showing exactly one category or brand opens it in the catalog.
  const catalogHref = railCatalogHref(base);
  // Leaving with unpublished changes asks first, as the back link does.
  const confirmLeave = () => !dirty || window.confirm(v.leaveConfirm);
  const fallbackChoices = options.fallbacks.includes(draft.fallback) ? options.fallbacks : [...options.fallbacks, draft.fallback];
  const menuCard = menuFor != null ? (cards.get(menuFor) ?? added.get(menuFor)?.product) : undefined;
  const menuRow = menuFor != null ? rowById.get(menuFor) : undefined;

  return (
    <Page>
      <Navbar
        title={title}
        subtitle={shownEyebrow || undefined}
        // Clear of the back arrow and the menu, however long the section's title.
        titleClassName="max-w-[calc(100%-152px)] truncate"
        subtitleClassName="truncate"
        left={<BackLink dirty={dirty} />}
        right={
          <KLink onClick={() => setSectionMenu(true)} aria-label={v.menu.title}>
            <More className="h-6 w-6" />
          </KLink>
        }
      />

      <ShowsCard
        rail={base}
        source={source}
        oneTerm={oneTerm}
        visibleCount={visibleCount}
        title={title}
        onChange={powers.source ? () => setSourceOpen(true) : null}
      />
      {canSwitch && (
        <SwitchCard
          on={switchedOn}
          onToggle={() =>
            commit(
              { ...draft, fields: { ...draft.fields, [SWITCH_FIELD]: switchedOn ? "yes" : "" } },
              switchedOn ? sx.switch.draftOff : sx.switch.draftOn,
            )
          }
        />
      )}
      {categoryId != null && <RuleCard collection={collection} onOpen={() => setRuleOpen(true)} />}
      {canEditLooks && (
        <LooksCard
          text={[shownEyebrow, shownTitle].filter(Boolean).join(" · ") || base.key}
          changed={fieldsChanged.length > 0 || resized}
          onOpen={() => setLooksOpen(true)}
        />
      )}
      {options.edit.fallback && base.editable && (
        <AutoOrderCard
          fallback={draft.fallback}
          choices={fallbackChoices}
          loading={rail.loadingFallback}
          oneTerm={oneTerm}
          onFallback={(f) => commit({ ...draft, fallback: f }, sx.auto.moved(v.fallbacks[f] ?? f))}
          onArrange={() =>
            oneTerm && setReorderTerm({ taxonomy: oneTerm.taxonomy, id: oneTerm.id, name: oneTerm.name, count: base.terms[0].count })
          }
          onRanking={() => setRankingsOpen(true)}
        />
      )}

      {canAdd && (
        <div className="flex items-center gap-3 px-5 pb-2 pt-1">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold uppercase tracking-wide opacity-50">{pk.listTitle}</span>
          <Button
            small
            rounded
            inline
            onClick={() => setPickerOpen(true)}
            aria-label={pk.openLabel(title)}
            colors={{ fillTextIos: "text-white dark:text-black", fillTextMaterial: "text-white dark:text-black" }}
            className="!h-9 shrink-0 gap-1 !px-3.5"
          >
            <Plus className="h-4 w-4" />
            {pk.open}
          </Button>
        </div>
      )}

      <Reorder.Group
        as="ul"
        axis="y"
        values={renderIds}
        onReorder={drag.onReorder}
        className="mx-4 overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-[#1c1c1e]"
      >
        {renderIds.map((id) => {
          const picked = added.get(id);
          return (
            <RailRow
              key={id}
              id={id}
              card={cardOf(id)}
              kind={rowById.get(id)?.kind ?? "auto"}
              position={positions.get(id) ?? null}
              reason={reasons.get(id) ?? (picked ? hiddenReasonOf(picked.product) : undefined)}
              added={picked ? (picked.joins && oneTerm ? oneTerm.name : true) : false}
              locked={(locks[skuKey(cardOf(id)?.sku ?? "")] ?? 0) > 0}
              fold={foldAfter === id ? v.fold(base.limit) : null}
              draggable={options.edit.pins && base.editable}
              onDragStart={drag.onDragStart}
              onDragEnd={drag.onDragEnd}
              onOpen={setMenuFor}
            />
          );
        })}
      </Reorder.Group>

      {orderIds.length > shown && (
        <Block className="!my-3">
          <Button clear large onClick={() => setShown((n) => n + options.pageSize)}>
            {v.loadMore}
          </Button>
        </Block>
      )}

      {canAdd && (
        <div className="px-4 pt-4">
          <Button large rounded tonal onClick={() => setPickerOpen(true)} className="w-full gap-1.5">
            <Plus className="h-5 w-5" />
            {pk.openLong}
          </Button>
        </div>
      )}

      <HiddenProducts
        ids={draft.exclude}
        cards={cards}
        onShow={options.edit.exclude ? (id) => commit(show(draft, id), v.moved.shown) : null}
      />

      {/* Room for the publish bar. */}
      <div className="h-[calc(env(safe-area-inset-bottom)+120px)]" />

      <PublishBar
        open={dirty}
        changes={changes.total}
        busy={pub.publishing || pub.joining}
        onDiscard={() => window.confirm(v.discardConfirm) && setDraft(saved)}
        onPublish={pub.publish}
      />

      <RowActions
        open={menuFor != null}
        name={menuCard?.name ?? ""}
        permalink={menuCard?.permalink}
        canPin={options.edit.pins && base.editable}
        pinned={menuRow != null && menuRow.kind !== "auto"}
        canHide={options.edit.exclude && base.editable}
        onClose={() => setMenuFor(null)}
        onTop={() => menuFor != null && commit({ ...draft, pin: pinToTop(draft.pin, menuFor) }, v.moved.top)}
        onPosition={() => setPositionFor(menuFor)}
        onUnpin={() => menuFor != null && commit({ ...draft, pin: unpin(draft.pin, menuFor) }, v.moved.unpinned)}
        onHide={() => menuFor != null && commit(hide(draft, menuFor), v.moved.hidden)}
        onPrices={() => setProductFor(menuFor)}
      />

      <SectionActions
        open={sectionMenu}
        title={title}
        onClose={() => setSectionMenu(false)}
        onAddProducts={canAdd ? () => setPickerOpen(true) : null}
        onChangeSource={powers.source ? () => setSourceOpen(true) : null}
        onLooks={canEditLooks ? () => setLooksOpen(true) : null}
        onRule={categoryId != null ? () => setRuleOpen(true) : null}
        onCatalog={catalogHref ? () => confirmLeave() && router.push(catalogHref) : null}
        onHistory={() => setHistoryOpen(true)}
        onReset={
          options.edit.pins && base.editable && draft.pin.length > 0 ? () => commit({ ...draft, pin: [] }, v.moved.reset) : null
        }
        pageLink={base.pageLink}
        termLink={base.terms[0]?.link ?? null}
      />

      <PositionDialog
        open={positionFor != null}
        initial={positionFor != null ? (positions.get(positionFor) ?? 1) : 1}
        max={visibleCount}
        onCancel={() => setPositionFor(null)}
        onConfirm={(position) => {
          if (positionFor != null) placeAt(positionFor, position);
          setPositionFor(null);
        }}
      />

      <StaleDialog open={pub.stale} onClose={pub.closeStale} onRetry={() => void pub.publish()} />

      <HistorySheet
        open={historyOpen}
        railKey={railKey}
        current={saved}
        onClose={() => setHistoryOpen(false)}
        onRestore={(state) => {
          setHistoryOpen(false);
          commit({ ...draft, ...state }, v.moved.restored);
        }}
      />

      <FieldsSheet
        open={looksOpen}
        title={s.sheetTitle}
        blockName={RAIL_BLOCK}
        fieldKeys={fieldKeys}
        values={draft.fields}
        limit={canResize ? { value: draft.limit, max: Math.max(options.maxLimit, draft.limit) } : undefined}
        preview
        submitLabel={s.apply}
        onSubmit={(fields, limit) => {
          const next = { ...draft, fields: { ...draft.fields, ...trimmed(fields) }, limit: limit ?? draft.limit };
          const texts = changedFields(draft.fields, next.fields).length > 0;
          if (texts || next.limit !== draft.limit) {
            commit(next, texts ? s.applied : s.resized(next.limit));
          }
          return true;
        }}
        onClose={() => setLooksOpen(false)}
      />

      <ProductSheet
        card={productFor != null ? (cardOf(productFor) ?? null) : null}
        onClose={() => setProductFor(null)}
        onLocksChanged={store.setLock}
        onPricesChanged={(id) => {
          store.refresh(id);
          // The homepage's cards show the old price until read again.
          router.refresh();
        }}
        onTagsChanged={() => void rail.reloadMembers()}
        confirmLeave={confirmLeave}
        demo={demo}
      />

      <CollectionSheet
        termId={ruleOpen ? categoryId : null}
        termName={termName}
        onClose={() => setRuleOpen(false)}
        onChanged={() => void rail.reloadMembers()}
      />

      {canAdd && (
        <ProductPicker
          open={pickerOpen}
          section={pickerSection}
          shown={positions}
          pinned={new Set(draft.pin)}
          room={Math.max(0, options.maxPins - draft.pin.length)}
          maxPins={options.maxPins}
          onClose={() => setPickerOpen(false)}
          onAdd={addFromCatalog}
        />
      )}

      <SourceSheet
        request={sourceRequest}
        lists={powers.lists}
        onClose={() => setSourceOpen(false)}
        onChanged={(key) => {
          // A new source is a new key: its editor opens on it, read fresh by the navigation itself
          // (a refresh right after it would cancel it).
          router.replace(sectionHref(key));
        }}
      />

      <ReorderSheet term={reorderTerm} onClose={() => setReorderTerm(null)} />
      {oneTerm && (
        <RankingActions
          open={rankingsOpen}
          termName={oneTerm.name}
          onClose={() => setRankingsOpen(false)}
          onUse={(ranking) =>
            sourceSheets.apply(ranking, { taxonomy: oneTerm.taxonomy, id: oneTerm.id, name: oneTerm.name, count: base.terms[0].count })
          }
          onManage={sourceSheets.manage}
        />
      )}
      {sourceSheets.sheets}
    </Page>
  );
}
