"use client";

import { useI18n } from "@/i18n/provider";
import { blockConfig } from "@/config";
import { railCategory } from "@/lib/collections/rail";
import type { RailCollection } from "@/lib/collections/types";
import { editableFields } from "@/lib/vetrina/fields";
import { railSourceOf } from "@/lib/vetrina/sections";
import type { HomeBlock, RailSummary } from "@/lib/vetrina/types";
import { RailCard } from "./sections/RailCard";

export type StaticBlock = Extract<HomeBlock, { kind: "static" }>;

/** The fields of a block the customer may edit here; empty when none. */
export function staticFields(block: HomeBlock): string[] {
  if (block.kind !== "static" || !block.fields || !block.attrsHash) return [];
  return editableFields(block.name, blockConfig(block.name).edit.fields, block.fields);
}

/**
 * One block of the homepage, as the home screen lists it: a product
 * section's card, or a thin row for the rest (a banner, the FAQ) — one that
 * opens its texts when the config lets the owner edit them.
 */
export function HomeRow({
  block,
  label,
  locks,
  collections,
  onEdit,
  onMenu,
  highlighted,
  canPin,
}: {
  block: HomeBlock;
  label: string;
  locks: Record<string, number>;
  collections: Record<number, RailCollection>;
  onEdit: () => void;
  /** A section's "⋯". */
  onMenu: (rail: RailSummary) => void;
  /** A section just added: ringed for a moment. */
  highlighted: boolean;
  canPin: boolean;
}) {
  const { t } = useI18n();
  const config = blockConfig(block.name);
  if (config.show === "hidden") return null;

  if (block.kind === "rail" && config.show === "rail") {
    const category = railCategory(block.rail);
    return (
      <RailCard
        rail={block.rail}
        locks={locks}
        collection={category != null ? (collections[category] ?? null) : null}
        onMenu={() => onMenu(block.rail)}
        highlighted={highlighted}
        canAdd={canPin && block.rail.editable && railSourceOf(block.rail) != null}
      />
    );
  }

  const summary = block.kind === "static" ? block.summary : null;
  const editable = staticFields(block).length > 0;
  const title = block.kind === "static" ? (block.fields?.title ?? summary?.title ?? null) : null;
  const inner = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate opacity-70">
          {label}
          {summary?.items != null && <span className="opacity-80"> · {t.vetrina.home.items(summary.items)}</span>}
        </span>
        {editable && title && <span className="block truncate text-[13px] font-medium">{title}</span>}
      </span>
      {editable ? (
        <span className="shrink-0 rounded-full bg-black/5 px-2.5 py-0.5 text-[12px] font-medium dark:bg-white/10">
          {t.vetrina.section.edit}
        </span>
      ) : (
        <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[12px] opacity-60 dark:bg-white/10">
          {t.vetrina.home.fromSite}
        </span>
      )}
    </>
  );
  const frame = "flex w-full items-center gap-3 rounded-2xl border border-black/5 px-4 py-3 text-left text-[15px] dark:border-white/10";
  return editable ? (
    <button type="button" onClick={onEdit} className={`${frame} transition-opacity active:opacity-60`}>
      {inner}
    </button>
  ) : (
    <div className={frame}>{inner}</div>
  );
}
