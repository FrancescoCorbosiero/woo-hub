import "server-only";
import { blockConfig, hubConfig, type RailList } from "@/config";
import { siteCan, type SectionFeature } from "@/lib/vetrina/sections";
import { getVetrinaSource, VetrinaError } from "./source";

/**
 * What the owner may do with the homepage's sections themselves — point one
 * at something else, add one, move them, take one away, switch one off: what
 * the code config allows (hub.config.ts), within what the site's plugin can
 * do (golden-hive-blocks 5.15.0 reports it). An older plugin keeps the
 * Vetrina as it was: products in a section, never the sections.
 */

const RAIL_BLOCK = "golden-hive/shortcode-wrapper";
const PARTS: readonly SectionFeature[] = ["source", "add", "move", "remove", "switchOff"];

export interface SectionPowers {
  /** Point a section at another category, brand or shop-wide list. */
  source: boolean;
  add: boolean;
  move: boolean;
  remove: boolean;
  /** Switch a section off and on (it stays on the page, showing nothing). */
  switchOff: boolean;
  /** The shop-wide lists a section may show. */
  lists: RailList[];
  /** The config allows some of it and the site's plugin is too old: the screens say so. */
  pluginOutdated: boolean;
}

export function sectionPowers(features: readonly string[]): SectionPowers {
  const edit = blockConfig(RAIL_BLOCK).edit;
  const can = (part: SectionFeature) => edit[part] && siteCan(features, part);
  return {
    source: can("source"),
    add: can("add"),
    move: can("move"),
    remove: can("remove"),
    switchOff: can("switchOff"),
    lists: hubConfig.vetrina.lists,
    pluginOutdated: PARTS.some((part) => edit[part] && !siteCan(features, part)),
  };
}

/** Refused unless the config allows it and the site's plugin can do it: each in its own words. */
export function requirePower(part: SectionFeature, features: readonly string[]): void {
  if (!blockConfig(RAIL_BLOCK).edit[part]) {
    throw new VetrinaError("invalid", "La Vetrina non è configurata per cambiare le sezioni così.", 400);
  }
  if (!siteCan(features, part)) {
    throw new VetrinaError(
      "plugin_outdated",
      "Per cambiare le sezioni dalla Vetrina serve il plugin Golden Hive Blocks 5.15.0 o successivo sul sito.",
      400,
    );
  }
}

const FEATURES_TTL_MS = 5 * 60_000;
const g = globalThis as { __vetrinaSiteFeatures?: { at: number; features: string[] } };

/** What the site's plugin reported with the last homepage read: no second request for it. */
export function rememberSiteFeatures(features: string[]): void {
  g.__vetrinaSiteFeatures = { at: Date.now(), features };
}

/**
 * What the site's plugin can do: as the last homepage read reported it, or
 * asked (/capabilities, a light request) — kept a few minutes, so a plugin
 * updated on the site shows its new powers soon after.
 */
export async function siteFeatures(): Promise<string[]> {
  const cached = g.__vetrinaSiteFeatures;
  if (cached && Date.now() - cached.at < FEATURES_TTL_MS) return cached.features;
  const features = (await (await getVetrinaSource()).capabilities()).features;
  rememberSiteFeatures(features);
  return features;
}
