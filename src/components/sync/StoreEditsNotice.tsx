"use client";

import * as React from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/provider";
import { getStoreEdits } from "@/server/actions/store-edits";
import type { StoreEditsState } from "@/server/sync/store-edits";

/**
 * Prices changed on WordPress: the sizes whose store price someone changed
 * after the Hub last wrote it. Every sync keeps them, and they wait for a
 * person — the owner, in the Vetrina (Negozio › Prezzi cambiati), where each
 * is kept (locked) or handed back to the Hub. Here, how many wait, and the way
 * there. Read again after each preview, which may find new ones; absent when
 * none wait.
 */
export function StoreEditsNotice({
  initial,
  refreshKey,
}: {
  initial: StoreEditsState | null;
  /** Changes when a preview ran. */
  refreshKey: string | null;
}) {
  const { t } = useI18n();
  const s = t.sync.storeEdits;
  const [total, setTotal] = React.useState(initial?.total ?? 0);

  React.useEffect(() => {
    if (refreshKey == null) return;
    let live = true;
    void getStoreEdits().then((res) => {
      if (live && res.ok) setTotal(res.data.total);
    });
    return () => {
      live = false;
    };
  }, [refreshKey]);

  if (total === 0) return null;
  return (
    <Link
      href="/vetrina/negozio/prezzi"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm transition-colors hover:bg-warn/15"
    >
      <span className="font-semibold">{s.title}</span>
      <span className="text-muted">{s.count(total)}</span>
      <span className="ml-auto font-medium">{s.decide} →</span>
    </Link>
  );
}
