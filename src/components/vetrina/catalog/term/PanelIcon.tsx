import type * as React from "react";

/** The panels' icons: iOS Settings' rounded squares, in the tones the panels use. */
const ICON_TONES = {
  gold: "bg-[#d4a017] text-white",
  // White on the primary: globals.css turns it dark when the primary turns white.
  ink: "bg-primary text-white",
  muted: "bg-black/[0.07] text-black/55 dark:bg-white/15 dark:text-white/70",
  // iOS's own green and red, as Settings uses them.
  green: "bg-[#34c759] text-white dark:bg-[#30d158]",
  red: "bg-[#ff3b30] text-white dark:bg-[#ff453a]",
};

export function PanelIcon({ tone, children }: { tone: keyof typeof ICON_TONES; children: React.ReactNode }) {
  return <span className={`grid h-[30px] w-[30px] place-items-center rounded-[8px] ${ICON_TONES[tone]}`}>{children}</span>;
}
