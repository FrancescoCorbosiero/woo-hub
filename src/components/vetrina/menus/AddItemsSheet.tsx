"use client";

import * as React from "react";
import useSWR from "swr";
import { useI18n } from "@/i18n/provider";
import type { SitePage } from "@/lib/menus/types";
import type { CatalogTerm } from "@/lib/vetrina/catalog";
import type { MenuNewItem } from "@/lib/vetrina/menu-ops";
import { loadSitePages } from "@/server/actions/vetrina-menus";
import { useCatalogOverview } from "../catalog/act/data";
import { matches } from "../catalog/act/model";
import {
  ActSheetFrame,
  FailedCard,
  LoadingRows,
  ModeSwitch,
  PickList,
  PickRow,
  PrimaryButton,
  SheetBody,
  SheetFooter,
  SheetHead,
  SheetSearch,
  useLastShown,
} from "../catalog/act/parts";
import { Check } from "../catalog/term/glyphs";
import { isMenuUrl, ItemBadge, TextField } from "./parts";
import { useMenuWrites } from "./use-menu-writes";

/**
 * "Aggiungi voci": the shop's categories and brands, the site's pages, or a
 * link, picked — as many as wanted, across the tabs — and added in the order
 * picked, at one place (the menu's bottom, or under an item). What the menu
 * holds already is marked, and can be added again. One write, with
 * "Annulla".
 */

export interface AddRequest {
  menuId: number;
  digest: string;
  /** The item they go under (0: the menu's top level), and its name. */
  parent: number;
  parentTitle: string | null;
  /** What the menu leads to already ("category:12", "page:2"). */
  present: ReadonlySet<string>;
}

type Tab = "category" | "brand" | "page" | "link";

interface Picked {
  key: string;
  item: MenuNewItem;
  name: string;
}

const MAX_ROWS = 150;
const collator = new Intl.Collator("it", { sensitivity: "base", numeric: true });
const PAGES = "vetrina:menu-pages";
const SWR_OPTIONS = { revalidateOnFocus: false, dedupingInterval: 30_000, shouldRetryOnError: false } as const;

async function fetchPages(): Promise<SitePage[]> {
  const res = await loadSitePages();
  if (!res.ok) throw new Error(res.error || res.code);
  return res.data;
}

/** The site's pages, read once a while (as the catalog's lists are). */
export const useSitePages = (enabled = true) => useSWR(enabled ? PAGES : null, fetchPages, SWR_OPTIONS);

export function AddItemsSheet({ request, onClose }: { request: AddRequest | null; onClose: () => void }) {
  const shown = useLastShown(request);
  return (
    <ActSheetFrame open={request != null} onClose={onClose}>
      {shown && <AddContent key={`${shown.menuId}:${shown.parent}`} request={shown} onClose={onClose} />}
    </ActSheetFrame>
  );
}

function AddContent({ request, onClose }: { request: AddRequest; onClose: () => void }) {
  const { t } = useI18n();
  const a = t.vetrinaCatalog.menus.add;
  const writes = useMenuWrites();
  const [tab, setTab] = React.useState<Tab>("category");
  const [text, setText] = React.useState("");
  const [picked, setPicked] = React.useState<Picked[]>([]);
  const [url, setUrl] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [tried, setTried] = React.useState(false);

  const linkStarted = url.trim() !== "" || label.trim() !== "";
  const linkOk = isMenuUrl(url) && label.trim() !== "";
  const link: Picked | null = linkOk ? { key: `link:${url.trim()}`, item: { kind: "link", url: url.trim(), label: label.trim() }, name: label.trim() } : null;
  const all = link ? [...picked, link] : picked;

  const toggle = (row: Picked) =>
    setPicked((now) => (now.some((p) => p.key === row.key) ? now.filter((p) => p.key !== row.key) : [...now, row]));

  async function add() {
    if (linkStarted && !linkOk) {
      setTried(true);
      setTab("link");
      return;
    }
    if (all.length === 0) return;
    setBusy(true);
    const created = await writes.run(
      {
        kind: "menuItemAdd",
        menuId: request.menuId,
        items: all.map((p) => p.item),
        place: { parent: request.parent },
        expected: { digest: request.digest },
      },
      t.vetrinaCatalog.menus.done.added(all.map((p) => p.name)),
    );
    setBusy(false);
    if (created) onClose();
  }

  const tabs: { value: Tab; label: string }[] = (["category", "brand", "page", "link"] as const).map((value) => ({ value, label: a.tabs[value] }));

  return (
    <>
      <SheetHead title={a.title} subtitle={request.parentTitle ? a.whereUnder(request.parentTitle) : a.whereEnd} onClose={onClose}>
        <ModeSwitch value={tab} options={tabs} onChange={setTab} label={a.tabsLabel} />
      </SheetHead>
      <SheetBody>
        {tab === "link" ? (
          <div className="space-y-4">
            <TextField
              label={a.link.url}
              value={url}
              onChange={setUrl}
              hint={a.link.urlHint}
              problem={tried && !isMenuUrl(url) ? a.link.badUrl : null}
              url
            />
            <TextField label={a.link.label} value={label} onChange={setLabel} problem={tried && label.trim() === "" ? a.link.needLabel : null} />
          </div>
        ) : (
          <>
            <SheetSearch value={text} onChange={setText} placeholder={a.search[tab]} />
            {tab === "page" ? <PageRows text={text} picked={picked} present={request.present} onToggle={toggle} /> : <TermRows kind={tab} text={text} picked={picked} present={request.present} onToggle={toggle} />}
          </>
        )}
      </SheetBody>
      <SheetFooter>
        <PrimaryButton onClick={() => void add()} disabled={all.length === 0 && !linkStarted} busy={busy}>
          {a.button(all.length)}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}

function TermRows({
  kind,
  text,
  picked,
  present,
  onToggle,
}: {
  kind: "category" | "brand";
  text: string;
  picked: readonly Picked[];
  present: ReadonlySet<string>;
  onToggle: (row: Picked) => void;
}) {
  const { t } = useI18n();
  const a = t.vetrinaCatalog.menus.add;
  const overview = useCatalogOverview();
  const found = React.useMemo(() => {
    const terms: readonly CatalogTerm[] = overview.data ? (kind === "category" ? overview.data.categories : overview.data.brands) : [];
    return terms
      .filter((term) => matches(term.path, text))
      .sort((x, y) => (kind === "category" ? collator.compare(x.path, y.path) : collator.compare(x.name, y.name)));
  }, [overview.data, text, kind]);
  if (overview.error != null && !overview.data) return <FailedCard message={a.failed} onRetry={() => void overview.mutate()} />;
  if (!overview.data) return <LoadingRows label={a.loading} />;
  if (found.length === 0) return <p className="px-1 py-6 text-center text-[15px] opacity-60">{a.empty}</p>;
  return (
    <PickList label={a.tabs[kind]}>
      {found.slice(0, MAX_ROWS).map((term) => {
        const key = `${kind}:${term.id}`;
        const on = picked.some((p) => p.key === key);
        const cut = term.path.lastIndexOf(" › ");
        const note = [cut >= 0 ? term.path.slice(0, cut) : "", present.has(key) ? a.inMenu : ""].filter(Boolean).join(" · ");
        return (
          <PickRow
            key={term.id}
            media={<ItemBadge kind={kind} />}
            title={term.name}
            subtitle={note || undefined}
            after={on ? <Check className="h-5 w-5 text-primary" /> : undefined}
            chevron={false}
            onPick={() => onToggle({ key, item: { kind, id: term.id }, name: term.name })}
          />
        );
      })}
    </PickList>
  );
}

function PageRows({
  text,
  picked,
  present,
  onToggle,
}: {
  text: string;
  picked: readonly Picked[];
  present: ReadonlySet<string>;
  onToggle: (row: Picked) => void;
}) {
  const { t } = useI18n();
  const a = t.vetrinaCatalog.menus.add;
  const pages = useSitePages();
  const found = React.useMemo(
    () => (pages.data ?? []).filter((page) => matches(page.title, text)).sort((x, y) => collator.compare(x.title, y.title)),
    [pages.data, text],
  );
  if (pages.error != null && !pages.data) return <FailedCard message={a.failed} onRetry={() => void pages.mutate()} />;
  if (!pages.data) return <LoadingRows label={a.loading} />;
  if (found.length === 0) return <p className="px-1 py-6 text-center text-[15px] opacity-60">{a.empty}</p>;
  return (
    <PickList label={a.tabs.page}>
      {found.slice(0, MAX_ROWS).map((page) => {
        const key = `page:${page.id}`;
        const on = picked.some((p) => p.key === key);
        return (
          <PickRow
            key={page.id}
            media={<ItemBadge kind="page" />}
            title={page.title}
            subtitle={present.has(key) ? a.inMenu : undefined}
            after={on ? <Check className="h-5 w-5 text-primary" /> : undefined}
            chevron={false}
            onPick={() => onToggle({ key, item: { kind: "page", id: page.id }, name: page.title })}
          />
        );
      })}
    </PickList>
  );
}
