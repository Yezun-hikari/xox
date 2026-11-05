import type { GameEvent } from '../../supabase/functions/_shared/rules.ts';
import { SIZE } from '../../supabase/functions/_shared/rules.ts';

export const cellName = (i: number): string =>
  `Reihe ${Math.floor(i / SIZE) + 1}, Spalte ${(i % SIZE) + 1}`;

/** German, human-readable lines for each event (live region / toasts). */
export function describeEvents(events: GameEvent[]): string[] {
  return withoutScoredClears(events).map((e) => {
    switch (e.kind) {
      case 'score':
        return `${e.player} punktet: Linie aus vier!`;
      case 'clear':
        return 'Linie 2:2 – wird geräumt.';
      case 'freeze':
        return `Stein auf ${cellName(e.cell)} friert ein.`;
      case 'thaw':
        return `Eingefrorener Stein auf ${cellName(e.cell)} zerfällt.`;
      case 'pass':
        return `${e.player} hat kein freies Feld – Zug wird übersprungen.`;
    }
  });
}

/** rules.ts emits 'clear' after 'score' for the same line; drop those duplicates. */
export function withoutScoredClears(events: GameEvent[]): GameEvent[] {
  const scored = new Set(events.flatMap((e) => (e.kind === 'score' ? [e.line.join()] : [])));
  return events.filter((e) => e.kind !== 'clear' || !scored.has(e.line.join()));
}
