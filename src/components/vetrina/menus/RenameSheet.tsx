"use client";

import * as React from "react";
import { Button } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { MenuItem } from "@/lib/menus/types";
import { useCatalogOverview } from "../catalog/act/data";
import { ActSheetFrame, PrimaryButton, SheetBody, SheetFooter, SheetHead, useLastShown } from "../catalog/act/parts";
import { useSitePages } from "./AddItemsSheet";
import { TextField } from "./parts";
import { useMenuWrites } from "./use-menu-writes";

/**
 * "Rinomina": an item's own label — or, for an item that leads to a
 * category, a brand or a page, its own name back (it then follows that
 * name when it changes). A link always keeps a label. One write, with
 * "Annulla".
 */

export interface RenameRequest {
  menuId: number;
  digest: string;
  item: Pick<MenuItem, "id" | "title" | "label" | "target">;
}

export function RenameSheet({ request, onClose }: { request: RenameRequest | null; onClose: () => void }) {
  const shown = useLastShown(request);
  return (
    <ActSheetFrame open={request != null} onClose={onClose} detent="content">
      {shown && <RenameContent key={shown.item.id} request={shown} onClose={onClose} />}
    </ActSheetFrame>
  );
}

/** The name an item shows with no label of its own: its category's, brand's or page's; null while not known. */
function useOwnName(item: RenameRequest["item"]): string | null {
  const target = item.target;
  const overview = useCatalogOverview();
  const pages = useSitePages(target.kind === "page");
  if (item.label == null) return item.title;
  if (target.kind === "category" || target.kind === "brand") {
    const terms = target.kind === "category" ? overview.data?.categories : overview.data?.brands;
    return terms?.find((term) => term.id === target.id)?.name ?? null;
  }
  if (target.kind === "page") return pages.data?.find((page) => page.id === target.id)?.title ?? null;
  return null;
}

function RenameContent({ request, onClose }: { request: RenameRequest; onClose: () => void }) {
  const { t } = useI18n();
  const m = t.vetrinaCatalog.menus;
  const writes = useMenuWrites();
  const { item } = request;
  const [label, setLabel] = React.useState(item.label ?? item.title);
  const [busy, setBusy] = React.useState(false);
  const [tried, setTried] = React.useState(false);
  const own = useOwnName(item);
  const followsOwn = item.target.kind !== "link" && item.target.kind !== "other" && item.label != null;

  async function save(next: string | null) {
    if (next != null && next.trim() === "") {
      setTried(true);
      return;
    }
    setBusy(true);
    const done = await writes.run(
      { kind: "menuItemRename", menuId: request.menuId, itemId: item.id, label: next?.trim() ?? null, expected: { digest: request.digest } },
      next == null ? m.done.ownName : m.done.renamed(next.trim()),
    );
    setBusy(false);
    if (done) onClose();
  }

  return (
    <>
      <SheetHead title={m.rename.title(item.title)} onClose={onClose} />
      <SheetBody>
        <TextField label={m.rename.label} value={label} onChange={setLabel} problem={tried && label.trim() === "" ? m.rename.needLabel : null} autoFocus />
        {followsOwn && own && (
          <Button rounded tonal onClick={() => void save(null)} disabled={busy} className="!h-11 w-full">
            <span className="truncate">{m.rename.own(own)}</span>
          </Button>
        )}
      </SheetBody>
      <SheetFooter>
        <PrimaryButton onClick={() => void save(label)} busy={busy} disabled={label.trim() === (item.label ?? item.title)}>
          {m.rename.save}
        </PrimaryButton>
      </SheetFooter>
    </>
  );
}
