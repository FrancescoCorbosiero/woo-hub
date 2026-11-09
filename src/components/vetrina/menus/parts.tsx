"use client";

import * as React from "react";
import type { MenuTargetKind } from "@/lib/menus/types";
import { Plus } from "../catalog/act/icons";
import { External } from "../icons";
import { Draft, Folder, Stack, Tag } from "../catalog/term/glyphs";

/** The menus' text fields: the sheets' look (FieldsSheet), one line. */
const INPUT =
  "w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-[16px] outline-none placeholder:opacity-40 focus:border-black/30 dark:border-white/15 dark:bg-white/10 dark:focus:border-white/40";

export function TextField({
  label,
  value,
  onChange,
  hint,
  problem,
  url = false,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  problem?: string | null;
  /** An address: no capitals, no corrections, the keyboard's URL keys. */
  url?: boolean;
  autoFocus?: boolean;
}) {
  const id = React.useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wide opacity-60">
        {label}
      </label>
      <input
        id={id}
        type={url ? "url" : "text"}
        inputMode={url ? "url" : "text"}
        autoCapitalize={url ? "none" : "sentences"}
        autoCorrect={url ? "off" : "on"}
        autoFocus={autoFocus}
        enterKeyHint="done"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      />
      {problem ? (
        <p role="alert" className="mt-1 text-[13px] text-red-600 dark:text-red-400">
          {problem}
        </p>
      ) : (
        hint && <p className="mt-1 text-[13px] leading-snug opacity-60">{hint}</p>
      )}
    </div>
  );
}

/** What an item leads to, as a round badge: a category's folder, a brand's tag, a page, a link, anything else — or a new, empty menu. */
export function ItemBadge({ kind }: { kind: MenuTargetKind | "new" }) {
  const Icon = kind === "category" ? Folder : kind === "brand" ? Tag : kind === "page" ? Draft : kind === "link" ? External : kind === "new" ? Plus : Stack;
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/[0.06] dark:bg-white/10">
      <Icon className="h-[18px] w-[18px] opacity-70" />
    </span>
  );
}

/** A link's address the menu takes: https://…, a path in the shop, or "#". */
export const isMenuUrl = (url: string) => /^(https?:\/\/\S+|\/\S*|#\S*)$/.test(url.trim());
