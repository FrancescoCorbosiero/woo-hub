"use client";

import { AnimatePresence, motion } from "motion/react";
import { Button } from "konsta/react";
import { useI18n } from "@/i18n/provider";

/** The bar that rises with the first unpublished change: how many, "Annulla", "Pubblica". */
export function PublishBar({
  open,
  changes,
  busy,
  onDiscard,
  onPublish,
}: {
  open: boolean;
  changes: number;
  /** Publishing — or putting added products in the category first: its toast says so, the button stays short. */
  busy: boolean;
  onDiscard: () => void;
  onPublish: () => void;
}) {
  const { t } = useI18n();
  const v = t.vetrina.editor;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: 120 }}
          animate={{ y: 0 }}
          exit={{ y: 120 }}
          transition={{ type: "spring", damping: 26, stiffness: 320 }}
          className="fixed inset-x-0 bottom-0 z-30 border-t border-black/10 bg-white/85 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 backdrop-blur-xl dark:border-white/10 dark:bg-black/80"
        >
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{v.changes(changes || 1)}</span>
            <Button clear inline rounded disabled={busy} onClick={onDiscard}>
              {v.discard}
            </Button>
            <Button
              rounded
              inline
              large
              disabled={busy}
              onClick={onPublish}
              colors={{ fillTextIos: "text-white dark:text-black", fillTextMaterial: "text-white dark:text-black" }}
              className="min-w-32"
            >
              {busy ? v.publishing : v.publish}
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
