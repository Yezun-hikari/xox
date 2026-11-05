// POST { password? } -> { status: 'deleted' }. Deletes the caller's auth user; ON DELETE CASCADE removes profile,
// ratings, queue entry and every match they played in (GDPR erasure).
// Registered users must send their password (verified here, so a stolen access token alone cannot delete the
// account); guests need none. Active matches are first settled as a loss for the caller, so deleting mid-game
// never dodges an Elo loss.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { check, HttpError, serve } from '../_server/http.ts';

serve(async ({ userId, user, body, db }) => {
  if (!user.is_anonymous) {
    const password = body.password;
    if (typeof password !== 'string' || !password || password.length > 72 || !user.email) {
      throw new HttpError(403, 'wrong_password');
    }
    // separate anon-key client, nothing persisted; the session it creates dies with the user below
    const verifier = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await verifier.auth.signInWithPassword({ email: user.email, password });
    if (error) throw error.status === 429 ? new HttpError(429, 'rate_limited') : new HttpError(403, 'wrong_password');
  }

  const active = check(
    await db.from('matches').select('id, x_id, o_id').eq('status', 'active').or(`x_id.eq.${userId},o_id.eq.${userId}`),
  ) as { id: string; x_id: string; o_id: string }[];
  for (const m of active) {
    check(await db.rpc('finish_match', { p_match_id: m.id, p_winner_id: m.x_id === userId ? m.o_id : m.x_id }));
  }

  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) throw error;
  return { status: 'deleted' };
});
