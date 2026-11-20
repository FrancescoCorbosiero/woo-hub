import type { BlockTypeSpec } from "@/lib/pages/types";
import registry from "./__fixtures__/golden-hive-block-types.json";

/**
 * golden-hive-blocks' block types as WordPress's block-types endpoint
 * answers them (5.17.0's block.json files, plus the lock and metadata
 * attributes WordPress adds to every block): the demo shop's registry, and
 * the checker's tests'. Regenerate the JSON from the plugin's blocks/ when
 * its attributes change.
 */
export const DEMO_BLOCK_TYPES = registry as unknown as BlockTypeSpec[];
