"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button, Chip } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { isListed, type ProductPlacement, type ProductSection } from "@/lib/vetrina/catalog";
import type { VetrinaErrorCode } from "@/lib/vetrina/types";
import { loadProductPlacement } from "@/server/actions/vetrina-catalog";
import { ChevronRight, EyeOff, Funnel, Pin } from "../../icons";
import { Check, House } from "../term/glyphs";
import { termHref } from "../term/list-model";
import { sectionHref } from "./links";

/**
 * A product's place in the shop, in its sheet: whether customers can see it,
 * its categories and brands, and the homepage sections showing it. Every chip
 * opens that screen, so the sheet is also a way into the catalog and the
 * section editor. Read-only for now: changing these comes with the bulk
 * actions.
 */

type State =
  | { phase: "loading" }
  | { phase: "ready"; placement: ProductPlacement }
  | { phase: "failed"; code: VetrinaErrorCode };

type Open = (e: React.MouseEvent, href: string) => void;

const HEADING = "mb-1.5 block px-1 text-[13px] font-semibold uppercase tracking-wide opacity-50";
const CARD = "divide-y divide-black/5 overflow-hidden rounded-2xl bg-white dark:divide-white/10 dark:bg-black/40";
const BAR = "block rounded-full bg-black/[0.08] dark:bg-white/15";
// The homepage's gold, as the catalog's rows mark it.
const GOLD = {
  fillBgIos: "bg-[#d4a017]/15",
  fillBgMaterial: "bg-[#d4a017]/15",
  fillTextIos: "text-[#8a6b00] dark:text-[#e8c35a]",
  fillTextMaterial: "text-[#8a6b00] dark:text-[#e8c35a]",
};

export function PlacementSection({
  productId,
  refreshKey = 0,
  onLeave,
  confirmLeave,
}: {
  productId: number;
  /** Changed when the product may have moved (its tags changed): read again, keeping what shows meanwhile. */
  refreshKey?: number;
  /** Closes the sheet: a chip closes it before opening another screen. */
  onLeave: () => void;
  /** Asked before leaving the screen; false stays (the section editor's unpublished changes). */
  confirmLeave?: () => boolean;
}) {
  const { t } = useI18n();
  const s = t.vetrinaCatalog.sheet;
  const [state, setState] = React.useState<State>({ phase: "loading" });
  const [tries, setTries] = React.useState(0);
  const open = useOpen(onLeave, confirmLeave);

  React.useEffect(() => {
    let alive = true;
    // A refresh that fails keeps what already shows: it was right a moment ago.
    const fail = (code: VetrinaErrorCode) => setState((prev) => (prev.phase === "ready" ? prev : { phase: "failed", code }));
    loadProductPlacement({ id: productId }).then(
      (res) => {
        if (!alive) return;
        if (res.ok) setState({ phase: "ready", placement: res.data });
        else fail(res.code);
      },
      () => {
        if (alive) fail("failed");
      },
    );
    return () => {
      alive = false;
    };
  }, [productId, refreshKey, tries]);

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
        <div className="flex items-center gap-3 rounded-2xl bg-white p-3 dark:bg-black/40">
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
  return (
    <section>
      <h3 className={HEADING}>{s.title}</h3>
      <div className={CARD}>
        <ShopState status={p.status} visibility={p.visibility} />

        <Group label={s.categories}>
          {p.categories.length === 0 ? (
            <Empty>{s.noCategories}</Empty>
          ) : (
            <Chips>
              {p.categories.map((c) => (
                <NavChip
                  key={c.id}
                  href={termHref("category", c.id)}
                  label={c.automatic ? `${c.path}, ${s.automatic}` : c.path}
                  onOpen={open}
                >
                  {c.automatic && <Funnel className="h-3.5 w-3.5 shrink-0 opacity-60" />}
                  <PathLabel path={c.path} />
                </NavChip>
              ))}
            </Chips>
          )}
        </Group>

        <Group label={s.brands}>
          {p.brands.length === 0 ? (
            <Empty>{s.noBrands}</Empty>
          ) : (
            <Chips>
              {p.brands.map((b) => (
                <NavChip key={b.id} href={termHref("brand", b.id)} label={b.name} onOpen={open}>
                  <span className="min-w-0 truncate">{b.name}</span>
                </NavChip>
              ))}
            </Chips>
          )}
        </Group>

        <Group label={s.homepage}>
          {p.sections.length === 0 ? (
            <Empty>{s.notInHomepage}</Empty>
          ) : (
            <Chips>
              {p.sections.map((section) => (
                <SectionChip key={section.key} section={section} onOpen={open} />
              ))}
            </Chips>
          )}
        </Group>
      </div>
      {p.categories.some((c) => c.automatic) && (
        <p className="mt-1.5 flex gap-1.5 px-1 text-[12px] leading-snug opacity-50">
          <Funnel className="mt-px h-3.5 w-3.5 shrink-0" />
          {s.automaticHint}
        </p>
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

/** Whether customers see it: its status when it is not published, then its visibility. */
function ShopState({ status, visibility }: { status: string; visibility: string }) {
  const { t } = useI18n();
  const s = t.vetrinaCatalog.sheet;
  const published = status === "publish";
  const listed = isListed(visibility);
  return (
    <div className="space-y-2 px-3 py-3 text-[15px] leading-snug">
      {!published && (
        <p className="flex items-center gap-2">
          <span className="shrink-0 rounded-md bg-black/[0.06] px-1.5 py-0.5 text-[13px] font-semibold dark:bg-white/10">
            {s.status[status] ?? s.status.other}
          </span>
          <span className="min-w-0 opacity-70">{s.unpublished}</span>
        </p>
      )}
      {(published || !listed) && (
        <p className="flex items-center gap-2">
          {listed ? (
            <Check className="h-[18px] w-[18px] shrink-0 text-green-600 dark:text-green-500" />
          ) : (
            <EyeOff className="h-[18px] w-[18px] shrink-0 opacity-60" />
          )}
          <span className="min-w-0">{listed ? s.visible : published ? s.hidden : s.hiddenUnpublished}</span>
        </p>
      )}
    </div>
  );
}

function Group({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1.5 pt-2.5">
      <div className="text-[13px] opacity-60">{label}</div>
      {children}
    </div>
  );
}

function Chips({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-wrap gap-x-2">{children}</ul>;
}

function Empty({ children }: { children: React.ReactNode }) {
  // As tall as a row of chips, so a group keeps its height either way.
  return <p className="py-2.5 text-[15px] leading-6 opacity-50">{children}</p>;
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
      <div className={`${CARD} motion-safe:animate-pulse`} aria-hidden>
        <div className="px-3 py-3">
          <span className={`${BAR} my-[3px] h-3.5 w-44`} />
        </div>
        {[["w-24", "w-32"], ["w-16"], ["w-28"]].map((widths, i) => (
          <Group key={i} label={<span className={`${BAR} my-1 h-3 w-16`} />}>
            <span className="flex gap-2">
              {widths.map((w) => (
                <span key={w} className={`${BAR} my-1.5 h-8 ${w}`} />
              ))}
            </span>
          </Group>
        ))}
      </div>
    </section>
  );
}
