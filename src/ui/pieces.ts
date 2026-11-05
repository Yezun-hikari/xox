import type { Player } from '../../supabase/functions/_shared/rules.ts';

/** Inline SVG for a piece; colored via CSS (.x / .o stroke). */
export const pieceSvg = (p: Player): string =>
  p === 'X'
    ? '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path d="M27 27L73 73M73 27L27 73"/></svg>'
    : '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><circle cx="50" cy="50" r="25"/></svg>';
