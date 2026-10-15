"use client";

import { Link as KLink } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { Clock } from "./icons";
import { useOperations } from "./operations-context";

/**
 * The navbar's way into "Attività" (the log, with "Annulla" for earlier
 * actions), with an orange dot while something runs — on every screen an
 * action can be started from, and on the homepage it changes.
 */
export function ActivityLink() {
  const { t } = useI18n();
  const ops = useOperations();
  return (
    <KLink iconOnly onClick={ops.openActivity} aria-label={t.vetrinaCatalog.act.activity.open} aria-haspopup="dialog">
      <span className="relative inline-flex">
        <Clock className="h-[22px] w-[22px]" />
        {/* Something is running: the log is where it can be followed. */}
        {ops.active.length > 0 && (
          <span aria-hidden className="absolute -end-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#ff9500] dark:bg-[#ff9f0a]" />
        )}
      </span>
    </KLink>
  );
}
