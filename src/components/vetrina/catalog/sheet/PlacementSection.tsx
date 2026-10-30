"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button, Chip, List, ListItem, Preloader, Toggle } from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import { isListed, type ProductPlacement, type ProductSection } from "@/lib/vetrina/catalog";
import type { OperationInput, OperationTarget, OperationView } from "@/lib/vetrina/catalog-ops";
import type { VetrinaErrorCode } from "@/lib/vetrina/types";
import { loadProductPlacement } from "@/server/actions/vetrina-catalog";
import type { VetrinaResult } from "@/server/vetrina/service";
import { ChevronRight, Close, Funnel, Pin } from "../../icons";
import { ActSheets, type ActRequest } from "../act/ActSheets";
import { Plus } from "../act/icons";
import { isActive } from "../act/model";
import { OperationsContext, useOperationSettled } from "../act/operations-context";
import { House } from "../term/glyphs";
import { termHref } from "../term/list-model";
import { ConfirmDialog, type ConfirmRequest } from "./ConfirmDialog";
import { sectionHref } from "./links";
import { HEADING, ROW, ROW_INNER, ROWS, SHEET_CARD, SHEET_LIST, SHEET_LIST_COLORS } from "./look";
import {
  isWorking,
  pendingFrom,
  removingFrom,
  saleAfter,
  shopState,
  visibilitySwitch,
  type PendingAction,
} from "./placement-model";

/**
 * A product's place in the shop, in its sheet, and the actions on this one
 * product: whether customers see it (a switch), its categories (a manual one
 * comes off with its ×, "+ Categoria" adds one), its brands, the homepage
 * sections showing it ("Metti in homepage"), its sale — and, under them,
 * "Elimina il prodotto" for one the shop no longer sells (none for the
 * supplier's feed's: the feed would put it back). Every chip still
 * opens its screen, so the sheet is also a way into the catalog and the
 * section editor.
 *
 * The actions are the catalog's own (../act): previewed, run in the
 * background, followed by the pill, undone with "Annulla". Hiding the
 * product, or taking it out of a category, asks first with the preview's
 * warnings (the homepage sections it leaves), and so does deleting it,
 * which closes the sheet once started; showing it again is the exact
 * way back, so it starts at once. The rest open the action sheets. When an
 * action ends, the section reads the product again and tells the sheet
 * (onActed).
 */

type State =
  | { phase: "loading" }
  | { phase: "ready"; placement: ProductPlacement }
  | { phase: "failed"; code: VetrinaErrorCode };

type Open = (e: React.MouseEvent, href: string) => void;

const BAR = "block rounded-full bg-black/[0.08] dark:bg-white/15";
/** Konsta's secondary text, for the lines under a row's name. */
const SECONDARY = "text-black/55 dark:text-white/55";
// The homepage's gold, as the catalog's rows mark it.
const GOLD = {
  fillBgIos: "bg-[#d4a017]/15",
  fillBgMaterial: "bg-[#d4a017]/15",
  fillTextIos: "text-[#8a6b00] dark:text-[#e8c35a]",
  fillTextMaterial: "text-[#8a6b00] dark:text-[#e8c35a]",
};
// "+ Categoria", "+ Metti in homepage": filled, where the chips that open a screen are outlined.
const ADD = {
  fillBgIos: "bg-black/[0.06] dark:bg-white/10",
  fillBgMaterial: "bg-black/[0.06] dark:bg-white/10",
  fillTextIos: "text-black dark:text-white",
  fillTextMaterial: "text-black dark:text-white",
};
/** The switch reaches 44px with an invisible margin: only it flips, as in iOS Settings, never the row's words. */
const SWITCH_TARGET = "relative before:absolute before:-inset-x-2 before:-inset-y-2 before:content-['']";
// iOS's green for a switch that is on: the app's primary is black, and white in dark mode, where the thumb would vanish.
const SWITCH = {
  checkedBgIos: "bg-[#34c759]",
  checkedBgMaterial: "bg-[#248a3d]",
  checkedBorderMaterial: "border-[#248a3d]",
  checkedThumbBgMaterial: "bg-white",
};

export function PlacementSection({
  productId,
  name = "",
  stockStatus,
  onSale = false,
  price,
  refreshKey = 0,
  onLeave,
  confirmLeave,
  onActed,
}: {
  productId: number;
  /** The product's name: what the action sheets say they act on. */
  name?: string;
  /** In stock or not, from the store's card: "Visibile · esaurito". */
  stockStatus?: string;
  /** On sale now, from the store's card: the Saldo row offers "Togli il saldo". */
  onSale?: boolean;
  /** The price on the site, written out, for the Saldo row. */
  price?: string;
  /** Changed when the product may have moved (its tags changed): read again, keeping what shows meanwhile. */
  refreshKey?: number;
  /** Closes the sheet: a chip closes it before opening another screen. */
  onLeave: () => void;
  /** Asked before leaving the screen; false stays (the section editor's unpublished changes). */
  confirmLeave?: () => boolean;
  /** An action started here ended (or its undo did): the screen behind reads the product again. */
  onActed?: (view: OperationView) => void;
}) {
  const { t } = useI18n();
  const s = t.vetrinaCatalog.sheet;
  // The catalog's tracker, mounted in the Vetrina's shell. Without it the section only shows.
  const ops = React.useContext(OperationsContext);
  const [state, setState] = React.useState<State>({ phase: "loading" });
  const [tries, setTries] = React.useState(0);
  // Bumped when an action ends: the product is read again.
  const [version, setVersion] = React.useState(0);
  const [pending, setPending] = React.useState<PendingAction[]>([]);
  // The switch's new position while its action is being started.
  const [flipping, setFlipping] = React.useState<boolean | null>(null);
  const [act, setAct] = React.useState<ActRequest | null>(null);
  const [confirm, setConfirm] = React.useState<ConfirmRequest | null>(null);
  // On sale or not after a sale from here, until the store's card (onSale) says so too.
  const [saleNow, setSaleNow] = React.useState<boolean | null>(null);
  const [cardOnSale, setCardOnSale] = React.useState(onSale);
  if (cardOnSale !== onSale) {
    setCardOnSale(onSale);
    setSaleNow(null);
  }
  // Actions started here, kept while the sheet is open: their "Annulla" is heard too.
  const mine = React.useRef(new Set<string>());
  const open = useOpen(onLeave, confirmLeave);

  React.useEffect(() => {
    let alive = true;
    // A refresh that fails keeps what already shows: it was right a moment ago.
    const fail = (code: VetrinaErrorCode) => setState((prev) => (prev.phase === "ready" ? prev : { phase: "failed", code }));
    // Read after they ended, the actions shown as done are now simply what the product is.
    const absorb = () => setPending((list) => (list.some((p) => p.settled) ? list.filter((p) => !p.settled) : list));
    loadProductPlacement({ id: productId }).then(
      (res) => {
        if (!alive) return;
        if (res.ok) setState({ phase: "ready", placement: res.data });
        else fail(res.code);
        absorb();
      },
      () => {
        if (!alive) return;
        fail("failed");
        absorb();
      },
    );
    return () => {
      alive = false;
    };
  }, [productId, refreshKey, tries, version]);

  // Any action that ends may have moved this product — one started before the sheet opened, too.
  useOperationSettled((view) => {
    setVersion((v) => v + 1);
    if (!mine.current.has(view.id)) return;
    setPending((list) => list.map((p) => (p.id === view.id ? { ...p, settled: true } : p)));
    if (view.kind === "sale" || view.kind === "unsale") setSaleNow(saleAfter(view));
    onActed?.(view);
  });

  const target: OperationTarget = { kind: "ids", ids: [productId] };

  /** An action started here: shown under way until the product is read again after it. */
  function follow(view: OperationView, input: OperationInput | null) {
    mine.current.add(view.id);
    const over = !isActive(view);
    setPending((list) => [...list, pendingFrom(view, input, over)]);
    // Over before its answer came back: the tracker told the screens before we knew it was ours.
    if (over) {
      setVersion((v) => v + 1);
      if (view.kind === "sale" || view.kind === "unsale") setSaleNow(saleAfter(view));
      onActed?.(view);
    }
  }

  async function start(input: OperationInput): Promise<VetrinaResult<OperationView>> {
    if (!ops) return { ok: false, code: "failed", error: t.vetrina.errors.failed };
    const res = await ops.start(input);
    if (res.ok) follow(res.data, input);
    return res;
  }

  function setVisible(on: boolean) {
    if (!on) {
      // Asked first, with the preview: which homepage sections lose it, before anything happens.
      setConfirm({ input: { kind: "hide", target }, ...s.confirm.hide });
      return;
    }
    // Shown again: the way back from a hide, at once (and undoable like any action) — as it was before
    // that hide, "only in search" or "only in the catalog" included.
    setFlipping(true);
    void start({ kind: "show", target, restore: true }).then((res) => {
      setFlipping(null);
      if (!res.ok) toast.error(res.error);
    });
  }

  if (state.phase === "loading") return <Skeleton />;

  if (state.phase === "failed") {
    const message =
      state.code === "not_found"
        ? s.notFound
        : state.code === "not_configured"
          ? t.vetrina.errors.not_configured
          : s.failed;
    return (
      <section>
        <h3 className={HEADING}>{s.title}</h3>
        <div className={`${SHEET_CARD} flex items-center gap-3 p-3 ps-4`}>
          <p className="min-w-0 flex-1 text-[14px] leading-snug opacity-70">{message}</p>
          <Button
            rounded
            tonal
            inline
            className="!h-11 shrink-0 !px-4"
            onClick={() => {
              setState({ phase: "loading" });
              setTries((n) => n + 1);
            }}
          >
            {s.retry}
          </Button>
        </div>
      </section>
    );
  }

  const p = state.placement;
  const can = ops != null;
  const published = p.status === "publish";
  const shown = visibilitySwitch(isListed(p.visibility), pending, flipping);
  const shop = shopState(s, { status: p.status, visibility: p.visibility, stockStatus });
  const removing = removingFrom(pending);
  const saleBusy = isWorking(pending, "sale", "unsale");
  const sale = saleNow ?? onSale;
  // The card's price is from before the sale changed, until the card is read again.
  const salePrice = saleNow == null || saleNow === onSale ? price : undefined;

  return (
    <section>
      <h3 className={HEADING}>{s.title}</h3>
      <List strong inset dividers colors={SHEET_LIST_COLORS} className={SHEET_LIST}>
        {!published && (
          <ListItem
            strongTitle={false}
            media={
              <span className="rounded-md bg-black/[0.06] px-1.5 py-0.5 text-[13px] font-semibold dark:bg-white/10">
                {s.status[p.status] ?? s.status.other}
              </span>
            }
            title={<span className="block text-[15px] leading-snug">{s.unpublished}</span>}
          />
        )}

        {/* Only the switch flips: a tap on the row's words does nothing, as in iOS Settings. */}
        <ListItem
          strongTitle={false}
          title={
            <span className="block py-0.5">
              <span className="block text-[16px] leading-tight">{s.visibleSwitch}</span>
              <span className={`mt-1 flex items-center gap-1.5 text-[14px] leading-snug ${SECONDARY}`}>
                {shown.going ? (
                  <>
                    <Preloader className="!h-3.5 !w-3.5 shrink-0" />
                    {shown.going === "hide" ? s.hiding : s.showing}
                  </>
                ) : (
                  <span className="min-w-0">
                    {shop.shown}
                    {shop.stock && (
                      <>
                        {" · "}
                        <span className={shop.soldOut ? "text-orange-700 dark:text-orange-400" : ""}>{shop.stock}</span>
                      </>
                    )}
                    {shop.hidden && published && <span className="block">{s.linkOnly}</span>}
                  </span>
                )}
              </span>
            </span>
          }
          after={
            <Toggle
              className={SWITCH_TARGET}
              colors={SWITCH}
              checked={shown.on}
              disabled={!can || shown.busy}
              onChange={() => setVisible(!shown.on)}
              aria-label={s.visibleSwitch}
            />
          }
        />

        <GroupRow label={s.categories} busy={isWorking(pending, "categorize")}>
          {p.categories.length === 0 && <Empty>{s.noCategories}</Empty>}
          {p.categories.map((c) => (
            <CategoryChip
              key={c.id}
              category={c}
              onOpen={open}
              removing={removing.has(c.id)}
              onRemove={
                can && !c.automatic
                  ? () =>
                      setConfirm({
                        input: { kind: "uncategorize", target, categoryId: c.id },
                        title: s.confirm.uncategorize.title(c.name),
                        body: s.confirm.uncategorize.body(c.name),
                        confirm: s.confirm.uncategorize.confirm,
                      })
                  : undefined
              }
            />
          ))}
          {can && (
            <AddChip
              label={s.addCategory}
              ariaLabel={s.addCategoryLabel}
              onClick={() => setAct({ kind: "category", target, label: name, has: p.categories.map((c) => c.id) })}
            />
          )}
        </GroupRow>

        <GroupRow label={s.brands}>
          {p.brands.length === 0 && <Empty>{s.noBrands}</Empty>}
          {p.brands.map((b) => (
            <NavChip key={b.id} href={termHref("brand", b.id)} label={b.name} onOpen={open}>
              <span className="min-w-0 truncate">{b.name}</span>
            </NavChip>
          ))}
        </GroupRow>

        <GroupRow label={s.homepage} busy={isWorking(pending, "pin")}>
          {p.sections.length === 0 && <Empty>{s.notInHomepage}</Empty>}
          {p.sections.map((section) => (
            <SectionChip key={section.key} section={section} onOpen={open} />
          ))}
          {can && <AddChip label={s.pin} onClick={() => setAct({ kind: "pin", target, label: name })} />}
        </GroupRow>

        <ListItem
          strongTitle={false}
          innerClassName="!py-2"
          title={
            <span className="block py-1">
              <span className={`block text-[16px] leading-tight ${sale ? "text-red-700 dark:text-red-400" : ""}`}>
                {sale ? s.sale.on : s.sale.title}
              </span>
              <span className={`mt-1 flex min-h-5 items-center gap-1.5 text-[14px] leading-snug ${SECONDARY}`}>
                {saleBusy && <Preloader className="!h-3.5 !w-3.5 shrink-0" />}
                <span className="min-w-0">
                  {saleBusy ? s.sale.working : sale ? (salePrice ? s.sale.price(salePrice) : s.sale.onNow) : s.sale.none}
                </span>
              </span>
            </span>
          }
          after={
            can && (
              <Button
                rounded
                tonal
                inline
                disabled={saleBusy}
                className="!h-11 shrink-0 !px-4"
                onClick={() => setAct({ kind: sale ? "unsale" : "sale", target, label: name })}
              >
                {sale ? s.sale.stop : s.sale.start}
              </Button>
            )
          }
        />
      </List>

      {p.categories.some((c) => c.automatic) && (
        <p className="mt-1.5 flex gap-1.5 px-1 text-[12px] leading-snug opacity-50">
          <Funnel className="mt-px h-3.5 w-3.5 shrink-0" />
          {s.automaticHint}
        </p>
      )}

      {p.fromFeed ? (
        <p className="mt-1.5 px-1 text-[12px] leading-snug opacity-50">{s.fromFeed}</p>
      ) : (
        can && (
          <button
            type="button"
            onClick={() => setConfirm({ input: { kind: "delete", target }, ...s.confirm.delete })}
            className={`${SHEET_CARD} mt-4 flex h-12 w-full items-center justify-center text-[16px] text-red-600 transition-opacity active:opacity-50 dark:text-red-400`}
          >
            {s.deleteProduct}
          </button>
        )
      )}

      {ops && (
        <>
          <ActSheets request={act} onClose={() => setAct(null)} onStarted={(view) => follow(view, null)} />
          <ConfirmDialog
            request={confirm}
            onCancel={() => setConfirm(null)}
            onConfirm={async (request) => {
              const res = await start(request.input);
              if (!res.ok) return res.error;
              setConfirm(null);
              // The product is on its way out: the pill and the toast's "Annulla" take it from here.
              if (request.input.kind === "delete") onLeave();
              return null;
            }}
          />
        </>
      )}
    </section>
  );
}

/**
 * A chip's tap: close the sheet, then open the screen inside the app. A
 * modified click opens the link the browser's way (a new tab), and a chip for
 * the screen already open only closes the sheet.
 */
function useOpen(onLeave: () => void, confirmLeave?: () => boolean): Open {
  const router = useRouter();
  const pathname = usePathname();
  return (e, href) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (href === pathname) {
      onLeave();
      return;
    }
    if (confirmLeave && !confirmLeave()) return;
    onLeave();
    router.push(href);
  };
}

/** A row of chips under its name, with the card's inset separator; a spinner while its action runs. */
function GroupRow({ label, busy = false, children }: { label: React.ReactNode; busy?: boolean; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <li className={ROW}>
      <div className={`${ROW_INNER} pb-1.5 pt-2.5`}>
        <div className={`flex items-center gap-1.5 text-[13px] ${SECONDARY}`}>
          {label}
          {busy && (
            <>
              <Preloader className="!h-3 !w-3" />
              <span>{t.vetrinaCatalog.sheet.working}</span>
            </>
          )}
        </div>
        <ul className="flex flex-wrap gap-x-2">{children}</ul>
      </div>
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  // As tall as a row of chips, so a group keeps its height either way.
  return <li className="py-2.5 pe-1 text-[15px] leading-6 opacity-50">{children}</li>;
}

/** A chip that opens another screen: outlined, with an arrow, inside a 44px-tall link. */
function NavChip({
  href,
  label,
  onOpen,
  colors,
  children,
}: {
  href: string;
  /** What a screen reader says: the chip's marks are only drawn. */
  label: string;
  onOpen: Open;
  colors?: typeof GOLD;
  children: React.ReactNode;
}) {
  return (
    <li className="min-w-0 max-w-full">
      <a
        href={href}
        aria-label={label}
        onClick={(e) => onOpen(e, href)}
        className="flex max-w-full py-1.5 transition-opacity active:opacity-60"
      >
        <Chip
          component="span"
          outline={!colors}
          colors={colors}
          className="!h-8 min-w-0 max-w-full gap-1.5 !pe-2 !ps-3 text-[14px] font-medium"
        >
          {children}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-40" />
        </Chip>
      </a>
    </li>
  );
}

/**
 * A category: its name opens its screen; a manual one also has a × that
 * takes the product out (asked first). An automatic one has none: its rule
 * decides, and the funnel says so. Both parts reach 44px with their
 * invisible margins, while the chip stays 32px.
 */
function CategoryChip({
  category,
  onOpen,
  removing,
  onRemove,
}: {
  category: ProductPlacement["categories"][number];
  onOpen: Open;
  removing: boolean;
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  const s = t.vetrinaCatalog.sheet;
  const href = termHref("category", category.id);
  return (
    <li className={`min-w-0 max-w-full py-1.5 transition-opacity ${removing ? "opacity-50" : ""}`}>
      <Chip component="span" outline className="!h-8 min-w-0 max-w-full !p-0 text-[14px] font-medium">
        <a
          href={href}
          aria-label={category.automatic ? `${category.path}, ${s.automatic}` : category.path}
          onClick={(e) => onOpen(e, href)}
          className={`relative flex h-full min-w-0 items-center gap-1.5 ps-3 transition-opacity before:absolute before:-inset-y-1.5 before:inset-x-0 active:opacity-60 ${onRemove ? "pe-0.5" : "pe-2"}`}
        >
          {category.automatic && <Funnel className="h-3.5 w-3.5 shrink-0 opacity-60" />}
          <PathLabel path={category.path} />
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-40" />
        </a>
        {onRemove && (
          <button
            type="button"
            aria-label={removing ? s.removing(category.name) : s.removeCategory(category.name)}
            disabled={removing}
            onClick={onRemove}
            className="relative grid h-full w-10 shrink-0 place-items-center transition-opacity before:absolute before:-inset-y-1.5 before:-end-1 before:start-0 active:opacity-40"
          >
            {removing ? (
              <Preloader className="!h-3.5 !w-3.5" />
            ) : (
              <span className="grid h-5 w-5 place-items-center rounded-full bg-black/[0.08] dark:bg-white/15">
                <Close className="h-3 w-3 opacity-70" />
              </span>
            )}
          </button>
        )}
      </Chip>
    </li>
  );
}

/** "+ Categoria", "+ Metti in homepage": opens the action's sheet. */
function AddChip({ label, ariaLabel, onClick }: { label: string; ariaLabel?: string; onClick: () => void }) {
  return (
    <li className="max-w-full">
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onClick}
        className="flex max-w-full py-1.5 transition-opacity active:opacity-60"
      >
        <Chip component="span" colors={ADD} className="!h-8 max-w-full gap-1 !pe-3 !ps-2.5 text-[14px] font-medium">
          <Plus className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">{label}</span>
        </Chip>
      </button>
    </li>
  );
}

/** "Saldi › Nike" with the parents dimmed; when room runs out the parents give way first. */
function PathLabel({ path }: { path: string }) {
  const cut = path.lastIndexOf(" › ");
  if (cut < 0) return <span className="min-w-0 truncate">{path}</span>;
  return (
    <span aria-hidden className="flex min-w-0 items-center">
      <span className="min-w-0 shrink-[4] truncate opacity-50">{path.slice(0, cut)}</span>
      <span className="shrink-0 px-1 opacity-50">›</span>
      <span className="min-w-0 truncate">{path.slice(cut + 3)}</span>
    </span>
  );
}

/** "TENDENZA #3", with a pin when the owner placed it there; opens the section editor. */
function SectionChip({ section, onOpen }: { section: ProductSection; onOpen: Open }) {
  const { t } = useI18n();
  const s = t.vetrinaCatalog.sheet;
  return (
    <NavChip
      href={sectionHref(section.key)}
      label={s.sectionLabel(section.title, section.position, section.pinned)}
      onOpen={onOpen}
      colors={GOLD}
    >
      <House className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{s.section(section.title, section.position)}</span>
      {section.pinned && <Pin className="h-3.5 w-3.5 shrink-0" />}
    </NavChip>
  );
}

/** The section's shape while it is read, so the sheet does not jump when it arrives. */
function Skeleton() {
  const { t } = useI18n();
  const s = t.vetrinaCatalog.sheet;
  return (
    <section aria-busy aria-label={s.loading}>
      <h3 className={HEADING}>{s.title}</h3>
      <ul className={`${SHEET_CARD} ${ROWS} motion-safe:animate-pulse`} aria-hidden>
        <li className={ROW}>
          <div className={`${ROW_INNER} flex items-center gap-3 py-3.5`}>
            <span className="flex-1">
              <span className={`${BAR} h-4 w-40`} />
              <span className={`${BAR} mt-2 h-3.5 w-28`} />
            </span>
            <span className={`${BAR} h-7 w-16`} />
          </div>
        </li>
        {[["w-24", "w-32"], ["w-16"], ["w-28"]].map((widths, i) => (
          <li key={i} className={ROW}>
            <div className={`${ROW_INNER} pb-1.5 pt-2.5`}>
              <span className={`${BAR} my-[3px] h-3 w-16`} />
              <span className="flex gap-2">
                {widths.map((w) => (
                  <span key={w} className={`${BAR} my-1.5 h-8 ${w}`} />
                ))}
              </span>
            </div>
          </li>
        ))}
        <li className={ROW}>
          <div className={`${ROW_INNER} flex items-center gap-3 py-2`}>
            <span className="flex-1 py-1">
              <span className={`${BAR} h-4 w-16`} />
              <span className={`${BAR} mt-2 h-3.5 w-24`} />
            </span>
            <span className={`${BAR} h-11 w-36`} />
          </div>
        </li>
      </ul>
    </section>
  );
}
