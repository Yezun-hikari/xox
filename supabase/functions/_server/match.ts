import { type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { isValidState, type GameState, type Player } from '../_shared/rules.ts';
import { check, HttpError, UUID } from './http.ts';

export interface MatchRow {
  id: string;
  x_id: string;
  o_id: string;
  state: GameState;
  status: 'active' | 'finished';
  turn_deadline: string;
  updated_at: string;
}

/** Loads an active match the caller plays in. Non-participants get not_found (no existence leak). */
export async function loadActiveMatch(db: SupabaseClient, matchId: unknown, userId: string) {
  if (typeof matchId !== 'string' || !UUID.test(matchId)) throw new HttpError(400, 'invalid');
  const m = check(
    await db
      .from('matches')
      .select('id, x_id, o_id, state, status, turn_deadline, updated_at')
      .eq('id', matchId)
      .maybeSingle(),
  ) as MatchRow | null;
  if (!m || (m.x_id !== userId && m.o_id !== userId)) throw new HttpError(404, 'not_found');
  if (m.status !== 'active') throw new HttpError(409, 'not_active');
  if (!isValidState(m.state)) throw new Error(`match ${m.id}: stored state is invalid`);
  const me: Player = m.x_id === userId ? 'X' : 'O';
  const opponentId = me === 'X' ? m.o_id : m.x_id;
  return { m, me, opponentId };
}

/** Atomically finishes the match via SQL (Elo). Returns elo_delta; 409 if someone else changed it first. */
export async function finish(
  db: SupabaseClient,
  m: MatchRow,
  winnerId: string,
  state: GameState | null,
  expectUnchanged: boolean,
): Promise<number> {
  const delta = check(
    await db.rpc('finish_match', {
      p_match_id: m.id,
      p_winner_id: winnerId,
      p_state: state,
      p_expected_updated_at: expectUnchanged ? m.updated_at : null,
    }),
  ) as number | null;
  if (delta === null) throw new HttpError(409, 'conflict');
  return delta;
}
