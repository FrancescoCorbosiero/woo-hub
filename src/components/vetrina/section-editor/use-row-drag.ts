"use client";

import * as React from "react";
import { pinsAfterPlacing, type EditorRow } from "@/lib/vetrina/order";

/**
 * Dragging a row by its grip: the list moves freely while dragging; the pins
 * are decided on drop, against the list as it was when the drag began — so a
 * drag that ends where it started changes nothing.
 */
export function useRowDrag(rows: EditorRow[], onDrop: (pin: number[]) => void) {
  // The order shown while a drag is under way; null when none is.
  const [dragIds, setDragIds] = React.useState<number[] | null>(null);
  const drag = React.useRef<{ rows: EditorRow[]; id: number; ids: number[] } | null>(null);

  function onDragStart(id: number) {
    drag.current = { rows, id, ids: rows.map((r) => r.id) };
    setDragIds(drag.current.ids);
  }
  function onReorder(subset: number[]) {
    const d = drag.current;
    if (!d) return;
    d.ids = [...subset, ...d.ids.slice(subset.length)];
    setDragIds(d.ids);
  }
  function onDragEnd() {
    const d = drag.current;
    drag.current = null;
    setDragIds(null);
    if (!d) return;
    const from = d.rows.findIndex((r) => r.id === d.id);
    const to = d.ids.indexOf(d.id);
    if (to < 0 || from === to) return;
    onDrop(pinsAfterPlacing(d.rows, d.id, to));
  }

  return { dragIds, onDragStart, onReorder, onDragEnd };
}
