"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import {
  Actions,
  ActionsButton,
  ActionsGroup,
  ActionsLabel,
  Block,
  Button,
  Dialog,
  DialogButton,
  Link as KLink,
  Navbar,
  NavbarBackLink,
  Page,
  Preloader,
  Segmented,
  SegmentedButton,
  Toggle,
} from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import { skuKey } from "@/lib/skus";
import {
  buildRows,
  countChanges,
  hide,
  pinToTop,
  pinsAfterPlacing,
  show,
  unpin,
  type EditorRow,
} from "@/lib/vetrina/order";
import type { BlockConfig } from "@/config";
import { describeRule } from "@/lib/collections/describe";
import { railCategory } from "@/lib/collections/rail";
import type { RailCollection } from "@/lib/collections/types";
import { isListed, railTaxonomy, toProductCard, type CatalogProduct } from "@/lib/vetrina/catalog";
import { changedFields, editableFields, SWITCH_FIELD, switchable } from "@/lib/vetrina/fields";
import { railSourceOf } from "@/lib/vetrina/sections";
import type { HiddenReason, ProductCard, RailDetail, RailFallback, SectionDraft } from "@/lib/vetrina/types";
import type { VetrinaRail, VetrinaResult } from "@/server/vetrina/service";
import { loadVetrinaRail, publishVetrinaRail } from "@/server/actions/vetrina";
import { Plus } from "./catalog/act/icons";
import { isActive, outcomeOf, type Outcome } from "./catalog/act/model";
import { useOperations, useOperationSettled } from "./catalog/act/operations-context";
import type { OrderTerm } from "./catalog/act/OrderSheet";
import { ReorderSheet } from "./catalog/act/ReorderSheet";
import { railCatalogHref, sectionHref } from "./catalog/sheet/links";
import { RankingActions } from "./catalog/sources/RankingActions";
import { useOrderSourceSheets } from "./catalog/sources/SourceOrderSheet";
import { Folder, Stack, Tag } from "./catalog/term/glyphs";
import { ProductPicker, type PickedProduct, type PickerSection, type PickPlace } from "./sections/ProductPicker";
import { SourceSheet, type SourceRequest } from "./sections/SourceSheet";
import { CollectionSheet } from "./CollectionSheet";
import { ErrorState } from "./ErrorState";
import { FieldsSheet } from "./FieldsSheet";
import { HistorySheet } from "./HistorySheet";
import { ProductSheet } from "./ProductSheet";
import { formatFromPrice } from "./format";
import { ChevronRight, EyeOff, Funnel, Grip, Lock, More, Pin } from "./icons";
import { SEGMENTED_COLORS } from "./segmented";
import { edited, movedUnderDraft, movesSection } from "./section-reload";
import { useSectionCards } from "./section-editor/use-section-cards";
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

const stateOf = (rail: RailDetail): SectionDraft => ({
  pin: rail.pin,
  exclude: rail.exclude,
  fallback: rail.fallback,
  fields: rail.fields,
  limit: rail.limit,
});

const trimmed = (fields: Record<string, string>) =>
  Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, value.trim()]));


/** Products the shop does not show in any list: a pin of theirs waits, greyed, for the reason it gives. */
function hiddenReasonOf(product: CatalogProduct): HiddenReason {
  if (product.status !== "publish") return "unpublished";
  if (!isListed(product.visibility)) return "hidden";
  if (product.stockStatus === "outofstock") return "outofstock";
  return "not_in_section";
}

/** A switch in the iOS green: Konsta's own takes the primary, which turns white in dark mode. */
const TOGGLE_COLORS = { checkedBgIos: "bg-[#34c759] dark:bg-[#30d158]" };

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
  const ops = useOperations();

  // The rail as the server last described it, and the customer's draft over it.
  const [base, setBase] = React.useState<RailDetail>(initial.rail);
  const [draft, setDraft] = React.useState<SectionDraft>(() => stateOf(initial.rail));
  const saved = React.useMemo(() => stateOf(base), [base]);
  // The order, plus the section's texts and size: one draft, one publish.
  const fieldsChanged = changedFields(saved.fields, draft.fields);
  const resized = saved.limit !== draft.limit;
  const dirty = edited(saved, draft);
  const orderChanges = countChanges(saved, draft);
  const changes = { ...orderChanges, total: orderChanges.total + fieldsChanged.length + (resized ? 1 : 0) };

  // Automatic order per fallback: the server computes it once, the phone reuses it.
  const [visibleByFallback, setVisibleByFallback] = React.useState<Record<string, number[]>>({
    [initial.rail.previewFallback]: initial.rail.visible,
  });
  const siteVisible = visibleByFallback[draft.fallback] ?? base.visible;
  const loadingFallback = visibleByFallback[draft.fallback] == null;

  // Products added from the catalog, until published — those that join the section's category then
  // are shown where they will be, the others (sold out, hidden) wait greyed with their reason.
  const [added, setAdded] = React.useState<Map<number, PickedProduct>>(() => new Map());
  const visible = React.useMemo(() => {
    const shown = new Set(siteVisible);
    const joining = draft.pin.filter((id) => {
      const a = added.get(id);
      return (
        a?.joins &&
        !shown.has(id) &&
        a.product.status === "publish" &&
        isListed(a.product.visibility) &&
        (a.product.stockStatus !== "outofstock" || !base.hideOutOfStock)
      );
    });
    return joining.length > 0 ? [...siteVisible, ...joining] : siteVisible;
  }, [siteVisible, draft.pin, added, base.hideOutOfStock]);

  // The rule filling the rail's category, when it is automatic.
  const [collection, setCollection] = React.useState<RailCollection | null>(initial.collection);
  const [reasons, setReasons] = React.useState(
    () => new Map<number, HiddenReason>(initial.rail.hidden.map((h) => [h.id, h.reason])),
  );

  // The draft as it is now, for an answer that arrives after the customer changed it.
  const latestDraft = React.useRef(draft);
  React.useEffect(() => {
    latestDraft.current = draft;
  }, [draft]);

  const rows = React.useMemo(() => buildRows(visible, draft), [visible, draft]);
  const rowById = React.useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  // Drag: the list moves freely while dragging; the pins are decided on drop,
  // against the list as it was when the drag began — so a drag that ends
  // where it started changes nothing.
  const [dragIds, setDragIds] = React.useState<number[] | null>(null);
  const drag = React.useRef<{ rows: EditorRow[]; id: number; ids: number[] } | null>(null);

  const [shown, setShown] = React.useState(options.pageSize);
  const orderIds = dragIds ?? rows.map((r) => r.id);
  const renderIds = orderIds.slice(0, shown);

  // Cards for the rows on screen and the hidden products: those the section came with, the others asked for.
  const { cards, locks, absorb, refresh, setLock } = useSectionCards(
    { cards: [...initial.rail.items, ...initial.rail.hidden], locks: initial.locks },
    [...renderIds, ...draft.exclude],
  );

  const adoptRail = React.useCallback(
    (data: VetrinaRail) => {
      setBase(data.rail);
      setVisibleByFallback((prev) => ({ ...prev, [data.rail.previewFallback]: data.rail.visible }));
      setReasons(new Map(data.rail.hidden.map((h) => [h.id, h.reason])));
      setCollection(data.collection);
      absorb([...data.rail.items, ...data.rail.hidden], data.locks);
    },
    [absorb],
  );

  /**
   * The category's members moved (its rule changed, a product's tags did):
   * read the rail again, and every automatic order cached so far is stale.
   * A draft with nothing unpublished becomes the fresh rail; one with the
   * customer's own changes keeps them — they are his — and he hears that
   * the section changed under them, to look before publishing.
   */
  const reloadMembers = React.useCallback(async () => {
    // The rail the draft was made over, as it was when asked: what "unedited" is measured against.
    const before = saved;
    const shownBefore = base.visible;
    const fresh = await loadVetrinaRail({ key: railKey, fallback: draft.fallback });
    if (!fresh.ok) {
      toast.error(t.vetrina.errors[fresh.code] ?? fresh.error);
      return;
    }
    setVisibleByFallback({ [fresh.data.rail.previewFallback]: fresh.data.rail.visible });
    adoptRail(fresh.data);
    // The draft as it is now: the customer may have changed it while the rail was read.
    if (!edited(before, latestDraft.current)) setDraft(stateOf(fresh.data.rail));
    // Said only when the section really moved under the draft: its pins, hidden ones, texts, or products.
    else if (
      movedUnderDraft({ state: before, shown: shownBefore }, { state: stateOf(fresh.data.rail), shown: fresh.data.rail.visible })
    ) {
      toast(v.changedMeanwhile);
    }
  }, [railKey, draft.fallback, saved, base.visible, adoptRail, t, v]);

  // Actions this editor started itself (the category its new products join): it reads the section after publishing.
  const ownOps = React.useRef(new Set<string>());
  // An action that ended — from a toast's "Annulla", the log, a product's sheet — may have moved this section:
  // a pin, a product hidden or shown, one put in or out of its category, the shop's positions.
  useOperationSettled((view) => {
    if (ownOps.current.has(view.id)) return;
    if (movesSection(view.kind)) void reloadMembers();
  });

  // A fallback we have no automatic order for yet: ask the site (nothing is saved).
  React.useEffect(() => {
    if (!loadingFallback) return;
    let cancelled = false;
    loadVetrinaRail({ key: railKey, fallback: draft.fallback }).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        toast.error(t.vetrina.errors[res.code] ?? res.error);
        return;
      }
      setVisibleByFallback((prev) => ({ ...prev, [draft.fallback]: res.data.rail.visible }));
      absorb([...res.data.rail.items, ...res.data.rail.hidden], res.data.locks);
    });
    return () => {
      cancelled = true;
    };
  }, [loadingFallback, draft.fallback, railKey, absorb, t]);

  // Leaving with unpublished changes asks first.
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function commit(next: SectionDraft, message: string) {
    if (next.pin.length > options.maxPins) {
      toast.error(v.limitReached(options.maxPins));
      return;
    }
    const before = draft;
    setDraft(next);
    toast.dismiss();
    toast(message, { action: { label: v.undo, onClick: () => setDraft(before) }, duration: 4000 });
  }

  function onDragStart(id: number) {
    drag.current = { rows, id, ids: rows.map((r) => r.id) };
    setDragIds(drag.current.ids);
  }
  function onReorder(subset: number[]) {
    const d = drag.current;
    if (!d) return;
    d.ids = [...subset, ...d.ids.slice(subset.length)];
    setDragIds(d.ids);
  }
  function onDragEnd() {
    const d = drag.current;
    drag.current = null;
    setDragIds(null);
    if (!d) return;
    const from = d.rows.findIndex((r) => r.id === d.id);
    const to = d.ids.indexOf(d.id);
    if (to < 0 || from === to) return;
    commit({ ...draft, pin: pinsAfterPlacing(d.rows, d.id, to) }, v.moved.dragged);
  }

  // Positions and the fold, over the order being shown (ghosts take no place).
  const positions = new Map<number, number>();
  let visibleCount = 0;
  let foldAfter: number | null = null;
  for (const id of orderIds) {
    if (rowById.get(id)?.kind === "ghost") continue;
    visibleCount += 1;
    positions.set(id, visibleCount);
    if (visibleCount === draft.limit) foldAfter = id;
  }

  // Menus and sheets.
  const [menuFor, setMenuFor] = React.useState<number | null>(null);
  const [sectionMenu, setSectionMenu] = React.useState(false);
  const [positionFor, setPositionFor] = React.useState<number | null>(null);
  const [positionValue, setPositionValue] = React.useState("");
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [looksOpen, setLooksOpen] = React.useState(false);
  const [productFor, setProductFor] = React.useState<number | null>(null);
  const [ruleOpen, setRuleOpen] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [joining, setJoining] = React.useState(false);
  const [stale, setStale] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(openPicker);
  const [sourceOpen, setSourceOpen] = React.useState(false);
  const [reorderTerm, setReorderTerm] = React.useState<OrderTerm | null>(null);
  const [rankingsOpen, setRankingsOpen] = React.useState(false);
  const sourceSheets = useOrderSourceSheets();

  // Opened with the picker from the homepage: the address forgets it, so a reload does not open it again.
  React.useEffect(() => {
    if (openPicker) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [openPicker]);

  const menuCard = menuFor != null ? (cards.get(menuFor) ?? added.get(menuFor)?.product) : undefined;
  const menuRow = menuFor != null ? rowById.get(menuFor) : undefined;

  function placeAt(id: number, position: number) {
    // Position N = the N-th product the site shows; ghosts are skipped.
    let seen = 0;
    let index = rows.length - 1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].kind === "ghost") continue;
      seen += 1;
      if (seen === position) {
        index = i;
        break;
      }
    }
    commit({ ...draft, pin: pinsAfterPlacing(rows, id, index) }, v.moved.position(position));
  }

  /**
   * Products added from the catalog that are not in the section's category
   * yet go into it first — a section shows its category's products only —
   * as one "Categoria +" the log keeps, with its "Annulla". Answers how that
   * ended; the section is published only after it is done.
   */
  async function joinCategory(ids: number[], categoryId: number): Promise<Outcome | "refused"> {
    const res = await ops.start({ kind: "categorize", target: { kind: "ids", ids }, categoryId });
    if (!res.ok) {
      toast.error(res.error);
      return "refused";
    }
    const id = res.data.id;
    ownOps.current.add(id);
    if (!isActive(res.data)) return outcomeOf("running", res.data) ?? "done";
    return new Promise((resolve) => {
      const off = ops.subscribe((view, outcome) => {
        if (view.id !== id) return;
        off();
        resolve(outcome);
      });
    });
  }

  async function publish() {
    setPublishing(true);
    try {
      const shown = new Set(base.visible);
      const joiners =
        fill === "category" && categoryId != null ? draft.pin.filter((id) => added.get(id)?.joins && !shown.has(id)) : [];
      if (joiners.length > 0 && categoryId != null) {
        setJoining(true);
        const outcome = await joinCategory(joiners, categoryId);
        setJoining(false);
        if (outcome !== "done") {
          if (outcome !== "refused") toast.error(pk.joinFailed);
          return;
        }
        // In the category now: a second publish (after a refusal) does not put them in again.
        setAdded((prev) => {
          const next = new Map(prev);
          for (const id of joiners) {
            const a = next.get(id);
            if (a) next.set(id, { ...a, joins: false });
          }
          return next;
        });
      }
      const res = await publishVetrinaRail({
        key: railKey,
        expectedModifiedGmt: base.modifiedGmt,
        expectedAttrsHash: base.attrsHash,
        ...draft,
      });
      if (res.ok) {
        const fresh = await loadVetrinaRail({ key: railKey });
        if (fresh.ok) {
          adoptRail(fresh.data);
          setDraft(stateOf(fresh.data.rail));
          setAdded(new Map());
        }
        // The homepage the back button returns to is the router's copy from before: read again.
        router.refresh();
        toast.dismiss();
        toast.success(demo ? v.publishedDemo : v.published, {
          action: base.pageLink
            ? { label: t.vetrina.viewSite, onClick: () => window.open(base.pageLink, "_blank", "noreferrer") }
            : undefined,
        });
        return;
      }
      if (res.code === "stale") {
        // Someone changed the page: take the new version, keep the draft.
        const fresh = await loadVetrinaRail({ key: railKey, fallback: draft.fallback });
        if (fresh.ok) adoptRail(fresh.data);
        setStale(true);
        return;
      }
      toast.error(t.vetrina.errors[res.code] ?? res.error);
    } finally {
      setPublishing(false);
      setJoining(false);
    }
  }

  // Texts and size: what the config allows and the site's plugin supports.
  const s = t.vetrina.section;
  const fieldKeys = editableFields(RAIL_BLOCK, options.edit.fields, base.fields);
  const canResize = options.edit.limit && base.editable && Object.keys(base.fields).length > 0;
  const canEditLooks = fieldKeys.length > 0 || canResize;
  const shownTitle = "title" in draft.fields ? draft.fields.title : base.title;
  const shownEyebrow = "eyebrow" in draft.fields ? draft.fields.eyebrow : base.eyebrow;

  const hiddenIds = draft.exclude;
  const termName = base.terms.map((term) => term.name).join(", ");
  // Only a rail showing exactly one category can be filled by a rule.
  const categoryId = railCategory(base);

  // What fills the section: what may join it from the catalog, and what it shows in words.
  const source = railSourceOf(base);
  const taxonomy = railTaxonomy(base.taxonomy);
  const oneTerm = taxonomy && base.terms.length === 1 ? { taxonomy, id: base.terms[0].id, name: base.terms[0].name } : null;
  const fill: PickerSection["fill"] | null =
    oneTerm?.taxonomy === "category"
      ? collection
        ? "automatic"
        : "category"
      : oneTerm?.taxonomy === "brand"
        ? "brand"
        : source && "list" in source
          ? source.list === "sale"
            ? "sale"
            : "list"
          : null;
  const canAdd = fill != null && options.edit.pins && base.editable;
  const pickerSection: PickerSection = { title: shownTitle || base.key, fill: fill ?? "list", term: oneTerm };
  // Where each product the section shows sits now, for the picker's "In sezione · #3".
  const shownPlaces = positions;
  const pickedCards = React.useMemo(() => new Map([...added].map(([id, a]) => [id, toProductCard(a.product)])), [added]);
  const cardOf = (id: number) => cards.get(id) ?? pickedCards.get(id);

  /** The products picked in the catalog, pinned on top (or after the pins), in the order picked. */
  function addFromCatalog(picked: PickedProduct[], place: PickPlace) {
    if (picked.length === 0) return;
    const ids = picked.map((p) => p.product.id);
    const others = draft.pin.filter((id) => !ids.includes(id));
    const pin = place === "top" ? [...ids, ...others] : [...others, ...ids];
    setAdded((prev) => {
      const next = new Map(prev);
      for (const p of picked) next.set(p.product.id, p);
      return next;
    });
    commit({ ...draft, pin, exclude: draft.exclude.filter((id) => !ids.includes(id)) }, pk.added(ids.length));
  }

  // The section's switch, in the draft: published with the rest.
  const canSwitch = powers.switchOff && switchable(RAIL_BLOCK, true, base.fields);
  const switchedOn = (draft.fields[SWITCH_FIELD] ?? "") !== "yes";

  const sourceRequest: SourceRequest | null = sourceOpen
    ? {
        key: railKey,
        title: shownTitle || base.key,
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
  const shows = !source
    ? base.atts.tag
      ? sx.shows.tag(base.atts.tag)
      : base.terms.length > 1
        ? sx.shows.terms(termName)
        : sx.shows.fixed
    : "list" in source
      ? (sx.shows.list[source.list] ?? source.list)
      : source.taxonomy === "category"
        ? sx.shows.category(oneTerm?.name ?? source.slug)
        : sx.shows.brand(oneTerm?.name ?? source.slug);
  const ShowsIcon = !source || "list" in source ? Stack : source.taxonomy === "brand" ? Tag : Folder;
  const auto = t.vetrina.auto;
  // A section showing exactly one category or brand opens it in the catalog.
  const catalogHref = railCatalogHref(base);
  // Leaving with unpublished changes asks first, as the back link does.
  const confirmLeave = () => !dirty || window.confirm(v.leaveConfirm);
  const fallbackChoices = options.fallbacks.includes(draft.fallback) ? options.fallbacks : [...options.fallbacks, draft.fallback];

  return (
    <Page>
      <Navbar
        title={shownTitle || base.key}
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

      {/* What the section shows, and "Cambia" to show something else. */}
      <div className="px-4 pb-3 pt-3">
        <div className="flex w-full items-center gap-3 rounded-2xl bg-white py-3 pe-2 ps-4 text-left shadow-sm dark:bg-[#1c1c1e]">
          <ShowsIcon className="h-5 w-5 shrink-0 opacity-60" />
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold uppercase tracking-wide opacity-50">{sx.shows.label}</span>
            <span className="block text-[15px] font-medium leading-snug">{shows}</span>
            <span className="mt-0.5 block text-[13px] leading-snug opacity-60">
              {oneTerm ? sx.shows.count(base.terms[0].count, visibleCount) : sx.shows.visible(visibleCount)}
            </span>
          </span>
          {powers.source && (
            <Button
              small
              rounded
              tonal
              inline
              onClick={() => setSourceOpen(true)}
              aria-label={sx.shows.changeLabel(shownTitle || base.key)}
              className="!h-9 shrink-0 !px-3.5"
            >
              {sx.shows.change}
            </Button>
          )}
        </div>
        {!base.editable && <p className="mt-2 px-1 text-[15px]">{v.readOnly}</p>}
      </div>

      {canSwitch && (
        <div className="px-4 pb-3">
          <div className="flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm dark:bg-[#1c1c1e]">
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">{sx.switch.label}</span>
              <span className={`mt-0.5 block text-[13px] leading-snug ${switchedOn ? "opacity-60" : "text-amber-700 dark:text-amber-400"}`}>
                {switchedOn ? sx.switch.on : sx.switch.off}
              </span>
            </span>
            <Toggle
              checked={switchedOn}
              colors={TOGGLE_COLORS}
              aria-label={sx.switch.label}
              onChange={() =>
                commit(
                  { ...draft, fields: { ...draft.fields, [SWITCH_FIELD]: switchedOn ? "yes" : "" } },
                  switchedOn ? sx.switch.draftOff : sx.switch.draftOn,
                )
              }
            />
          </div>
        </div>
      )}

      {categoryId != null && (
        <div className="px-4 pb-3">
          <button
            type="button"
            onClick={() => setRuleOpen(true)}
            className="flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3 text-left shadow-sm transition-opacity active:opacity-60 dark:bg-[#1c1c1e]"
          >
            <Funnel className={`h-5 w-5 shrink-0 ${collection?.enabled ? "text-[#b8860b]" : "opacity-40"}`} />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold uppercase tracking-wide opacity-50">
                {collection ? (collection.enabled ? auto.card : auto.paused) : auto.make}
              </span>
              <span className="block text-[15px] font-medium leading-snug">
                {collection ? describeRule(collection, t.collections.words) : auto.makeHint}
              </span>
              {collection && (
                <span
                  className={`mt-0.5 block text-[13px] leading-snug ${
                    collection.enabled && (collection.held || collection.lastError) ? "text-amber-700 dark:text-amber-400" : "opacity-60"
                  }`}
                >
                  {!collection.enabled
                    ? auto.cardPaused
                    : collection.held
                      ? auto.heldHint
                      : collection.lastError
                        ? auto.problem
                        : collection.members != null
                          ? `${auto.members(collection.members)} · ${auto.cardHint}`
                          : auto.cardHint}
                </span>
              )}
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 opacity-30" />
          </button>
        </div>
      )}

      {canEditLooks && (
        <div className="px-4 pb-3">
          <button
            type="button"
            onClick={() => setLooksOpen(true)}
            className="flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3 text-left shadow-sm transition-opacity active:opacity-60 dark:bg-[#1c1c1e]"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold uppercase tracking-wide opacity-50">{s.open}</span>
              <span className="block truncate text-[15px] font-medium">
                {[shownEyebrow, shownTitle].filter(Boolean).join(" · ") || base.key}
              </span>
            </span>
            {(fieldsChanged.length > 0 || resized) && <span className="h-2 w-2 shrink-0 rounded-full bg-[#d4a017]" aria-hidden />}
            <ChevronRight className="h-5 w-5 shrink-0 opacity-30" />
          </button>
        </div>
      )}

      {options.edit.fallback && base.editable && (
        <div className="px-4 pb-3">
          <div className="rounded-2xl bg-white px-4 pb-3 pt-3 shadow-sm dark:bg-[#1c1c1e]">
            <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide opacity-50">
              {sx.auto.title}
              {loadingFallback && <Preloader className="!h-4 !w-4" />}
            </div>
            <Segmented strong rounded colors={SEGMENTED_COLORS}>
              {fallbackChoices.map((f) => (
                <SegmentedButton
                  key={f}
                  active={draft.fallback === f}
                  onClick={() => draft.fallback !== f && commit({ ...draft, fallback: f }, sx.auto.moved(v.fallbacks[f] ?? f))}
                >
                  {v.fallbacks[f] ?? f}
                </SegmentedButton>
              ))}
            </Segmented>
            {/* "Negozio" follows the shop's own positions: changed right here, for the section's category or brand. */}
            {draft.fallback === "menu_order" && (
              <>
                <p className="mt-2.5 text-[13px] leading-snug opacity-60">{oneTerm ? sx.auto.shop(oneTerm.name) : sx.auto.shopAny}</p>
                {oneTerm && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      small
                      rounded
                      tonal
                      inline
                      className="!h-9 !px-3.5"
                      onClick={() =>
                        setReorderTerm({ taxonomy: oneTerm.taxonomy, id: oneTerm.id, name: oneTerm.name, count: base.terms[0].count })
                      }
                    >
                      {sx.auto.arrange(oneTerm.name)}
                    </Button>
                    <Button small rounded tonal inline className="!h-9 !px-3.5" onClick={() => setRankingsOpen(true)}>
                      {sx.auto.ranking}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {canAdd && (
        <div className="flex items-center gap-3 px-5 pb-2 pt-1">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold uppercase tracking-wide opacity-50">{pk.listTitle}</span>
          <Button
            small
            rounded
            inline
            onClick={() => setPickerOpen(true)}
            aria-label={pk.openLabel(shownTitle || base.key)}
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
        onReorder={onReorder}
        className="mx-4 overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-[#1c1c1e]"
      >
        {renderIds.map((id) => (
          <RailRow
            key={id}
            id={id}
            card={cardOf(id)}
            kind={rowById.get(id)?.kind ?? "auto"}
            position={positions.get(id) ?? null}
            reason={reasons.get(id) ?? (added.has(id) ? hiddenReasonOf(added.get(id)!.product) : undefined)}
            added={added.has(id) ? (added.get(id)!.joins && oneTerm ? oneTerm.name : true) : false}
            locked={(locks[skuKey(cardOf(id)?.sku ?? "")] ?? 0) > 0}
            fold={foldAfter === id ? v.fold(base.limit) : null}
            draggable={options.edit.pins && base.editable}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onOpen={setMenuFor}
          />
        ))}
      </Reorder.Group>

      {orderIds.length > shown && (
        <Block className="!my-3">
          <Button clear large onClick={() => setShown((s) => s + options.pageSize)}>
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

      {hiddenIds.length > 0 && (
        <>
          <div className="px-5 pb-1.5 pt-6 text-[13px] font-semibold uppercase tracking-wide opacity-50">
            {v.hiddenTitle}
          </div>
          <ul className="mx-4 overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-[#1c1c1e]">
            {hiddenIds.map((id) => {
              const card = cards.get(id);
              return (
                <li key={id} className="flex items-center gap-3 border-b border-black/5 px-3 py-2.5 last:border-0 dark:border-white/10">
                  <Thumb card={card} dim />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[15px] leading-snug opacity-60">{card?.name ?? `#${id}`}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-[13px] opacity-50">
                      <EyeOff className="h-3.5 w-3.5" />
                      {v.reasons.excluded}
                    </div>
                  </div>
                  {options.edit.exclude && (
                    <Button small rounded tonal inline onClick={() => commit(show(draft, id), v.moved.shown)}>
                      {v.showAgain}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* Room for the publish bar. */}
      <div className="h-[calc(env(safe-area-inset-bottom)+120px)]" />

      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ y: 120 }}
            animate={{ y: 0 }}
            exit={{ y: 120 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
            className="fixed inset-x-0 bottom-0 z-30 border-t border-black/10 bg-white/85 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 backdrop-blur-xl dark:border-white/10 dark:bg-black/80"
          >
            <div className="mx-auto flex max-w-xl items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{v.changes(changes.total || 1)}</span>
              <Button
                clear
                inline
                rounded
                disabled={publishing}
                onClick={() => window.confirm(v.discardConfirm) && setDraft(saved)}
              >
                {v.discard}
              </Button>
              <Button
                rounded
                inline
                large
                disabled={publishing}
                onClick={publish}
                colors={{ fillTextIos: "text-white dark:text-black", fillTextMaterial: "text-white dark:text-black" }}
                className="min-w-32"
              >
                {/* Joining the category first: its toast says so; the button stays short. */}
                {joining || publishing ? v.publishing : v.publish}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Row actions. */}
      <Actions opened={menuFor != null} onBackdropClick={() => setMenuFor(null)}>
        <ActionsGroup>
          <ActionsLabel>{menuCard?.name ?? ""}</ActionsLabel>
          {options.edit.pins && base.editable && menuFor != null && (
            <>
              <ActionsButton
                onClick={() => {
                  commit({ ...draft, pin: pinToTop(draft.pin, menuFor) }, v.moved.top);
                  setMenuFor(null);
                }}
              >
                {v.actions.top}
              </ActionsButton>
              <ActionsButton
                onClick={() => {
                  setPositionValue(String(positions.get(menuFor) ?? 1));
                  setPositionFor(menuFor);
                  setMenuFor(null);
                }}
              >
                {v.actions.position}
              </ActionsButton>
              {menuRow && menuRow.kind !== "auto" && (
                <ActionsButton
                  onClick={() => {
                    commit({ ...draft, pin: unpin(draft.pin, menuFor) }, v.moved.unpinned);
                    setMenuFor(null);
                  }}
                >
                  {v.actions.unpin}
                </ActionsButton>
              )}
            </>
          )}
          {options.edit.exclude && base.editable && menuFor != null && (
            <ActionsButton
              onClick={() => {
                commit(hide(draft, menuFor), v.moved.hidden);
                setMenuFor(null);
              }}
            >
              {v.actions.hide}
            </ActionsButton>
          )}
          {menuFor != null && (
            <ActionsButton
              onClick={() => {
                setProductFor(menuFor);
                setMenuFor(null);
              }}
            >
              {v.actions.prices}
            </ActionsButton>
          )}
          {menuCard?.permalink && (
            <ActionsButton
              onClick={() => {
                window.open(menuCard.permalink, "_blank", "noreferrer");
                setMenuFor(null);
              }}
            >
              {v.actions.openSite}
            </ActionsButton>
          )}
        </ActionsGroup>
        <ActionsGroup>
          <ActionsButton bold onClick={() => setMenuFor(null)}>
            {v.actions.cancel}
          </ActionsButton>
        </ActionsGroup>
      </Actions>

      {/* Section menu. */}
      <Actions opened={sectionMenu} onBackdropClick={() => setSectionMenu(false)}>
        <ActionsGroup>
          <ActionsLabel>{shownTitle || base.key}</ActionsLabel>
          {canAdd && (
            <ActionsButton
              onClick={() => {
                setSectionMenu(false);
                setPickerOpen(true);
              }}
            >
              {sx.menu.addProducts}
            </ActionsButton>
          )}
          {powers.source && (
            <ActionsButton
              onClick={() => {
                setSectionMenu(false);
                setSourceOpen(true);
              }}
            >
              {sx.menu.change}
            </ActionsButton>
          )}
          {canEditLooks && (
            <ActionsButton
              onClick={() => {
                setSectionMenu(false);
                setLooksOpen(true);
              }}
            >
              {s.open}
            </ActionsButton>
          )}
          {categoryId != null && (
            <ActionsButton
              onClick={() => {
                setSectionMenu(false);
                setRuleOpen(true);
              }}
            >
              {auto.menu}
            </ActionsButton>
          )}
          {catalogHref && (
            <ActionsButton
              onClick={() => {
                setSectionMenu(false);
                if (confirmLeave()) router.push(catalogHref);
              }}
            >
              {t.vetrinaCatalog.sheet.openInCatalog}
            </ActionsButton>
          )}
          <ActionsButton
            onClick={() => {
              setSectionMenu(false);
              setHistoryOpen(true);
            }}
          >
            {v.menu.history}
          </ActionsButton>
          {options.edit.pins && base.editable && draft.pin.length > 0 && (
            <ActionsButton
              onClick={() => {
                setSectionMenu(false);
                commit({ ...draft, pin: [] }, v.moved.reset);
              }}
            >
              {v.menu.reset}
            </ActionsButton>
          )}
          {base.pageLink && (
            <ActionsButton
              onClick={() => {
                window.open(base.pageLink, "_blank", "noreferrer");
                setSectionMenu(false);
              }}
            >
              {v.menu.viewSite}
            </ActionsButton>
          )}
          {base.terms[0]?.link && (
            <ActionsButton
              onClick={() => {
                window.open(base.terms[0].link ?? "", "_blank", "noreferrer");
                setSectionMenu(false);
              }}
            >
              {v.menu.category}
            </ActionsButton>
          )}
        </ActionsGroup>
        <ActionsGroup>
          <ActionsButton bold onClick={() => setSectionMenu(false)}>
            {v.actions.cancel}
          </ActionsButton>
        </ActionsGroup>
      </Actions>

      {/* Move to position N. */}
      <Dialog
        opened={positionFor != null}
        onBackdropClick={() => setPositionFor(null)}
        title={v.positionTitle}
        content={
          <input
            type="number"
            inputMode="numeric"
            enterKeyHint="done"
            min={1}
            max={visibleCount}
            value={positionValue}
            onChange={(e) => setPositionValue(e.target.value)}
            aria-label={v.positionHint(visibleCount)}
            placeholder={v.positionHint(visibleCount)}
            className="mt-2 w-full rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2.5 text-center text-[20px] font-semibold tabular-nums outline-none dark:border-white/15 dark:bg-white/10"
          />
        }
        buttons={
          <>
            <DialogButton onClick={() => setPositionFor(null)}>{v.actions.cancel}</DialogButton>
            <DialogButton
              strong
              onClick={() => {
                const n = Math.round(Number(positionValue));
                if (positionFor != null && n >= 1) placeAt(positionFor, Math.min(n, visibleCount));
                setPositionFor(null);
              }}
            >
              {v.positionConfirm}
            </DialogButton>
          </>
        }
      />

      {/* The page changed under us: publish again over the new version? */}
      <Dialog
        opened={stale}
        onBackdropClick={() => setStale(false)}
        title={v.stale.title}
        content={v.stale.body}
        buttons={
          <>
            <DialogButton onClick={() => setStale(false)}>{v.stale.close}</DialogButton>
            <DialogButton
              strong
              onClick={() => {
                setStale(false);
                void publish();
              }}
            >
              {v.stale.retry}
            </DialogButton>
          </>
        }
      />

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
        onLocksChanged={setLock}
        onPricesChanged={(id) => {
          refresh(id);
          // The homepage's cards show the old price until read again.
          router.refresh();
        }}
        onTagsChanged={() => void reloadMembers()}
        confirmLeave={confirmLeave}
        demo={demo}
      />

      <CollectionSheet
        termId={ruleOpen ? categoryId : null}
        termName={termName}
        onClose={() => setRuleOpen(false)}
        onChanged={() => void reloadMembers()}
      />

      {canAdd && (
        <ProductPicker
          open={pickerOpen}
          section={pickerSection}
          shown={shownPlaces}
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
          // Shown elsewhere, it may have another key: its editor opens on it, fresh.
          router.replace(sectionHref(key));
          router.refresh();
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

function Thumb({ card, dim }: { card?: ProductCard; dim?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the shop's own thumbnail sizes
    <img
      src={card?.image || undefined}
      alt=""
      loading="lazy"
      draggable={false}
      className={`h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-black/[0.04] object-contain text-[0px] dark:bg-white/10 ${dim ? "opacity-50" : ""}`}
    />
  );
}

function RailRow({
  id,
  card,
  kind,
  position,
  reason,
  added,
  locked,
  fold,
  draggable,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  id: number;
  card?: ProductCard;
  kind: EditorRow["kind"];
  position: number | null;
  reason?: HiddenReason;
  /** Added from the catalog, not published yet; a name: it joins that category when published. */
  added: boolean | string;
  locked: boolean;
  fold: string | null;
  draggable: boolean;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
  onOpen: (id: number) => void;
}) {
  const { t, locale } = useI18n();
  const v = t.vetrina.editor;
  const controls = useDragControls();
  const ghost = kind === "ghost";

  return (
    <Reorder.Item
      as="li"
      value={id}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => onDragStart(id)}
      onDragEnd={onDragEnd}
      whileDrag={{ scale: 1.02, boxShadow: "0 12px 32px -12px rgba(0,0,0,0.35)" }}
      className="relative select-none border-b border-black/5 bg-white last:border-0 dark:border-white/10 dark:bg-[#1c1c1e]"
    >
      <div className="flex items-center gap-3 py-2 pl-3 pr-1">
        <span className="w-6 shrink-0 text-right text-[13px] font-medium tabular-nums opacity-50">
          {position ?? "–"}
        </span>
        <button
          type="button"
          onClick={() => onOpen(id)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-60"
        >
          <Thumb card={card} dim={ghost} />
          <span className="min-w-0 flex-1">
            <span className={`line-clamp-2 text-[15px] font-medium leading-snug ${ghost ? "opacity-50" : ""}`}>
              {card?.name ?? "…"}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
              {card && <span className="tabular-nums opacity-60">{formatFromPrice(card, v.from, locale)}</span>}
              {added && (
                <span className="rounded-md bg-[#d4a017]/15 px-1.5 text-[11px] font-semibold leading-5 text-[#8a6b00] dark:text-[#e8c35a]">
                  {t.vetrinaCatalog.picker.newBadge}
                </span>
              )}
              {kind !== "auto" && (
                <span className="inline-flex items-center gap-0.5 font-semibold text-amber-700 dark:text-amber-400">
                  <Pin className="h-3 w-3" />
                  {v.pinned}
                </span>
              )}
              {locked && <Lock className="h-3.5 w-3.5 opacity-60" />}
            </span>
            {typeof added === "string" && !ghost && (
              <span className="mt-0.5 block text-[13px] leading-snug text-[#8a6b00] dark:text-[#e8c35a]">
                {t.vetrinaCatalog.picker.willJoin(added)}
              </span>
            )}
            {ghost && (
              <span className="mt-0.5 block text-[13px] text-orange-600 dark:text-orange-400">
                {v.reasons[reason ?? "unknown"] ?? v.reasons.unknown}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          aria-label={v.rowMenu}
          onClick={() => onOpen(id)}
          className="grid h-11 w-9 shrink-0 place-items-center opacity-40 active:opacity-20"
        >
          <More className="h-5 w-5" />
        </button>
        {draggable && (
          <div
            role="button"
            aria-label={v.dragHandle}
            onPointerDown={(e) => {
              e.preventDefault();
              controls.start(e);
            }}
            style={{ touchAction: "none" }}
            className="grid h-12 w-10 shrink-0 cursor-grab place-items-center opacity-35 active:cursor-grabbing"
          >
            <Grip className="h-5 w-5" />
          </div>
        )}
      </div>
      {fold && (
        <div className="flex items-center gap-2 px-4 pb-2 pt-1 text-[12px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
          <span className="h-px flex-1 bg-current opacity-40" />
          {fold}
          <span className="h-px flex-1 bg-current opacity-40" />
        </div>
      )}
    </Reorder.Item>
  );
}
