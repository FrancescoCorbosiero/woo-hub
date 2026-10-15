"use client";

import * as React from "react";

/**
 * Konsta's Range places its thumb before it has measured it, so a sheet
 * opened on a value showed the thumb ~10px past the filled bar until the
 * first move. It places the thumb again on a window resize, with the size it
 * has measured by then: one, two frames after the Range mounts (again when
 * `key` changes — a sheet that brings its slider back), puts it right.
 */
export function useRangeThumbFix(key: unknown): void {
  React.useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [key]);
}
