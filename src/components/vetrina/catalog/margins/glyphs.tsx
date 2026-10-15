/**
 * The margin's own inline icon, drawn like ../act/icons.tsx and
 * ../term/glyphs.tsx (SF-Symbols-like strokes, no icon library).
 */

type IconProps = { className?: string };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** A margin: a price tag with a plus — what the Hub adds on the market price. */
export function MarginTag({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V4a1 1 0 0 1 1-1h9l7.6 7.6a2 2 0 0 1 0 2.8Z" />
      <circle cx="7.5" cy="7.5" r="1" fill="currentColor" />
      <path d="M13 10.5v5M10.5 13h5" />
    </svg>
  );
}

/** One point less / more, beside the slider. */
export function Minus({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
      <path d="M5 12h14" />
    </svg>
  );
}

export function Plus({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
