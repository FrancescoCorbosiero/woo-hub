"use client";

import { List, ListItem } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { describeRule } from "@/lib/collections/describe";
import type { RailCollection } from "@/lib/collections/types";
import type { CatalogTerm } from "@/lib/vetrina/catalog";
import { Funnel } from "../../icons";
import { ruleState } from "../rule-state";
import { sectionHref } from "../sheet/links";
import { useAppLink } from "./browse";
import { House, Stack } from "./glyphs";
import { summaryParts } from "./list-model";
import { PanelIcon } from "./PanelIcon";

/**
 * The top of a term's screen: its automatic rule (categories), the homepage
 * sections showing it, and what is sold out, hidden or on sale in it.
 */
export function ControlPanel({ term, onRule }: { term: CatalogTerm; onRule: () => void }) {
  const { t } = useI18n();
  const p = t.vetrinaCatalog.term.panel;
  const appLink = useAppLink();
  const summary = summaryParts(term, p);

  return (
    <List strong inset className="!mb-5 !mt-3">
      {term.taxonomy === "category" && <RuleRow collection={term.automatic} onOpen={onRule} />}
      {term.sections.length > 0 ? (
        term.sections.map((section) => (
          <ListItem
            key={section.key}
            link
            linkProps={appLink(sectionHref(section.key))}
            media={
              <PanelIcon tone="ink">
                <House className="h-[18px] w-[18px]" />
              </PanelIcon>
            }
            title={<span className="line-clamp-2">{p.inHomepage(section.title)}</span>}
          />
        ))
      ) : (
        <ListItem
          media={
            <PanelIcon tone="muted">
              <House className="h-[18px] w-[18px]" />
            </PanelIcon>
          }
          title={<span className="opacity-50">{p.notInHomepage}</span>}
        />
      )}
      {term.count > 0 && (
        <ListItem
          media={
            <PanelIcon tone="muted">
              <Stack className="h-[18px] w-[18px]" />
            </PanelIcon>
          }
          title={summary.length > 0 ? summary.join(" · ") : p.allGood}
        />
      )}
    </List>
  );
}

/** "Automatica: <the rule in words>", with its state, like the section editor's card; or "Rendi automatica". */
function RuleRow({ collection, onOpen }: { collection: RailCollection | null; onOpen: () => void }) {
  const { t } = useI18n();
  const p = t.vetrinaCatalog.term.panel;
  const auto = t.vetrina.auto;
  const state = collection ? ruleState(collection) : null;
  const note =
    state === "paused"
      ? { text: auto.cardPaused, warn: false }
      : state === "held"
        ? { text: auto.heldHint, warn: true }
        : state === "problem"
          ? { text: auto.problem, warn: true }
          : null;

  return (
    <ListItem
      link
      linkComponent="button"
      linkProps={{ type: "button", onClick: onOpen }}
      contentClassName="w-full text-start"
      media={
        <PanelIcon tone={state === "working" ? "gold" : "muted"}>
          <Funnel className="h-[18px] w-[18px]" />
        </PanelIcon>
      }
      title={
        <span className="line-clamp-2">
          {collection ? p.automatic(describeRule(collection, t.collections.words)) : auto.make}
        </span>
      }
      text={
        collection ? (
          note && <span className={note.warn ? "text-amber-700 dark:text-amber-400" : undefined}>{note.text}</span>
        ) : (
          p.makeHint
        )
      }
    />
  );
}
