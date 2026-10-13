"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Small pieces the catalog home's lists share: next/link for Konsta's rows,
 * the iOS Settings-style icon tiles, the count at a row's end, and the few
 * icons the shared set (../../icons.tsx) does not have.
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

export function formatCount(n: number, locale: string): string {
  return n.toLocaleString(locale === "en" ? "en-GB" : "it-IT");
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

type IconProps = { className?: string };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** The homepage: a house. Named for screen readers when it stands alone. */
export function House({ className, label }: IconProps & { label?: string }) {
  return (
    <svg viewBox="0 0 24 24" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={className} {...stroke}>
      <path d="M3.5 10.6 12 3.8l8.5 6.8M5.5 9.2V20h13V9.2" />
    </svg>
  );
}

/** Up and down arrows: change the order. */
export function SortArrows({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
      <path d="m7 9 5-5 5 5M7 15l5 5 5-5" />
    </svg>
  );
}

/** A box with nothing left in it: sold out. */
export function Empty({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6 18 12-12" />
    </svg>
  );
}

/** A price tag: on sale. */
export function Tag({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0l-8.3-8.3Z" />
      <circle cx="8.2" cy="8.2" r="1.4" />
    </svg>
  );
}

/** A photo frame, crossed: without a photo. */
export function NoPhoto({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
      <path d="M3 3l18 18M8 4h11a1 1 0 0 1 1 1v11M20 20H5a1 1 0 0 1-1-1V5" />
      <path d="m4 16 4.5-4.5 3 3M14 13l1.5-1.5L20 16" />
    </svg>
  );
}

/** A folder: a category (here, the lack of one). */
export function Folder({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
      <path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v8.3A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5V7Z" />
    </svg>
  );
}

/** A page with a pencil: a draft, not on the site. */
export function Draft({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
      <path d="M13 3.5H6.5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9" />
      <path d="M17 3.2a1.6 1.6 0 0 1 2.3 2.3l-6 6-3 .8.8-3 5.9-6.1Z" />
    </svg>
  );
}
