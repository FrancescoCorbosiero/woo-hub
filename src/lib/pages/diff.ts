import { parse } from "@wordpress/block-serialization-default-parser";
import type { BlockChange, DiffBlock, PageDiff } from "./types";

/**
 * What saving would change, block by block rather than line by line: the
 * blocks added, removed and changed, by name and place.
 *
 * Both pages are read with WordPress's parser and laid out depth first, each
 * block with its own part only: its name, its attributes and its own HTML
 * (a group's wrapper, not the blocks inside it, which are compared as blocks
 * of their own). The longest run of blocks that are exactly alike, in order,
 * is "unchanged"; between two such blocks, a removed block and an added one
 * of the same name are paired as one "changed" block, and what differs is
 * named (its attributes, its content). The rest is added or removed.
 */

type Parsed = ReturnType<typeof parse>[number];

interface Flat {
  name: string;
  path: number[];
  attrs: Record<string, unknown> | null;
  /** The block's own HTML, its inner blocks left out. */
  html: string;
  /** Name, attributes and own HTML: equal = the same block. */
  sig: string;
}

/** Past this many blocks a side, the comparison stops pairing changes (the table it needs grows as the product of both). */
const MAX_BLOCKS = 3000;

/** Keys in a stable order, so {"a":1,"b":2} and {"b":2,"a":1} read as the same attributes. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function flatten(markup: string): Flat[] {
  const out: Flat[] = [];
  const walk = (blocks: Parsed[], prefix: number[]) => {
    let n = 0;
    for (const block of blocks) {
      if (block.blockName === null) {
        // Loose HTML: compared as a block of its own, when there is any. Not counted in the
        // numbering (as the check numbers blocks): it takes the place of the block after it.
        const html = block.innerHTML.trim();
        if (html) out.push({ name: "core/freeform", path: [...prefix, n + 1], attrs: {}, html, sig: `freeform|${html}` });
        continue;
      }
      const path = [...prefix, ++n];
      const html = block.innerContent.filter((part): part is string => part !== null).join("").trim();
      const attrs = block.attrs && typeof block.attrs === "object" && !Array.isArray(block.attrs) ? (block.attrs as Record<string, unknown>) : null;
      out.push({ name: block.blockName, path, attrs, html, sig: `${block.blockName}|${stable(attrs)}|${html}` });
      walk(block.innerBlocks, path);
    }
  };
  walk(parse(markup), []);
  return out;
}

const ref = (b: Flat): DiffBlock => ({ name: b.name, path: b.path });

/** Attribute keys whose values differ between two versions of a block. */
function changedAttrs(a: Flat, b: Flat): string[] {
  const before = a.attrs ?? {};
  const after = b.attrs ?? {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => stable(before[k]) !== stable(after[k])).sort();
}

/** Index pairs of the longest common subsequence of two signature lists. */
function common(a: readonly string[], b: readonly string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  // lengths[i][j]: the longest run of a[i..] and b[j..].
  const lengths = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** A gap between two unchanged blocks: same-named blocks paired, in order, as changed; the rest added or removed. */
function gap(before: Flat[], after: Flat[]): BlockChange[] {
  const out: BlockChange[] = [];
  const used = new Set<number>();
  const paired = new Map<number, number>();
  let from = 0;
  before.forEach((b, i) => {
    for (let j = from; j < after.length; j++) {
      if (!used.has(j) && after[j].name === b.name) {
        used.add(j);
        paired.set(i, j);
        from = j + 1;
        return;
      }
    }
  });
  let j = 0;
  before.forEach((b, i) => {
    const k = paired.get(i);
    if (k === undefined) {
      out.push({ kind: "removed", before: ref(b) });
      return;
    }
    for (; j < k; j++) if (!used.has(j)) out.push({ kind: "added", after: ref(after[j]) });
    j = k + 1;
    const a = after[k];
    out.push({ kind: "changed", before: ref(b), after: ref(a), attrs: changedAttrs(b, a), content: b.html !== a.html });
  });
  for (; j < after.length; j++) if (!used.has(j)) out.push({ kind: "added", after: ref(after[j]) });
  return out;
}

export function diffMarkup(before: string, after: string): PageDiff {
  if (before === after) return { changes: [], unchanged: flatten(before).length, identical: true };
  const a = flatten(before);
  const b = flatten(after);
  if (a.length > MAX_BLOCKS || b.length > MAX_BLOCKS) {
    // Too many to pair: every block that is not exactly in both is said as removed or added.
    const inB = new Map<string, number>();
    for (const x of b) inB.set(x.sig, (inB.get(x.sig) ?? 0) + 1);
    const changes: BlockChange[] = [];
    let unchanged = 0;
    for (const x of a) {
      const left = inB.get(x.sig) ?? 0;
      if (left > 0) {
        inB.set(x.sig, left - 1);
        unchanged++;
      } else changes.push({ kind: "removed", before: ref(x) });
    }
    const inA = new Map<string, number>();
    for (const x of a) inA.set(x.sig, (inA.get(x.sig) ?? 0) + 1);
    for (const x of b) {
      const left = inA.get(x.sig) ?? 0;
      if (left > 0) inA.set(x.sig, left - 1);
      else changes.push({ kind: "added", after: ref(x) });
    }
    return { changes, unchanged, identical: false };
  }
  const pairs = common(
    a.map((x) => x.sig),
    b.map((x) => x.sig),
  );
  const changes: BlockChange[] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pairs, [a.length, b.length] as [number, number]]) {
    changes.push(...gap(a.slice(i, pi), b.slice(j, pj)));
    i = pi + 1;
    j = pj + 1;
  }
  return { changes, unchanged: pairs.length, identical: false };
}
