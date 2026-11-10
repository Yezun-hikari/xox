import type { Player } from '../shared/rules.ts';

/**
 * Inline SVG for a piece; colored via CSS (.x / .o stroke).
 * pathLength="1" lets CSS draw the strokes in with stroke-dashoffset.
 */
export const pieceSvg = (p: Player): string =>
  p === 'X'
    ? '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path pathLength="1" d="M28 28L72 72"/><path pathLength="1" d="M72 28L28 72"/></svg>'
    : '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><circle pathLength="1" cx="50" cy="50" r="25" transform="rotate(-90 50 50)"/></svg>';
