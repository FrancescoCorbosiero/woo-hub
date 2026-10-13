"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { formatCount } from "../format";
import { House } from "../term/glyphs";

/**
 * Small pieces the catalog home's lists share: next/link for Konsta's rows,
 * the iOS Settings-style icon tiles and the count at a row's end. The icons
 * are the catalog's one set, in ../term/glyphs.tsx.
 */

/**
 * next/link as a Konsta ListItem's linkComponent: rows navigate inside the
 * app (prefetch, no reload). Konsta types the prop as a tag name, but renders
 * any component it is given.
 */
export const NextLinkTag = Link as unknown as string;

/** A row's count, with a house when the term has a homepage section. */
export function CountAfter({ count, locale, home, homeLabel }: { count: number; locale: string; home?: boolean; homeLabel?: string }) {
  return (
    <span className="flex items-center gap-1.5 tabular-nums">
      {home && <House className="h-4 w-4 opacity-60" label={homeLabel} />}
      {formatCount(count, locale)}
    </span>
  );
}

/** An iOS Settings-style tile: a white glyph on a coloured rounded square. */
export function Tile({ children, tone }: { children: ReactNode; tone: "ink" | "gold" | "muted" }) {
  const bg = {
    ink: "bg-[#111] text-white dark:bg-white dark:text-black",
    gold: "bg-[#d4a017] text-white",
    muted: "bg-black/25 text-white dark:bg-white/25",
  }[tone];
  return <span className={`grid h-[30px] w-[30px] place-items-center rounded-[8px] ${bg}`}>{children}</span>;
}
