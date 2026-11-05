// POST { nickname } -> { nickname } | error invalid | profane | taken
import { checkNickname } from '../_shared/profanity.ts';
import { HttpError, serve } from '../_server/http.ts';

serve(async ({ userId, body, db }) => {
  const r = checkNickname(body.nickname as string);
  if (!r.ok) throw new HttpError(400, r.reason);
  const { error } = await db.from('profiles').upsert({ id: userId, nickname: r.nickname });
  if (error?.code === '23505') throw new HttpError(409, 'taken'); // unique lower(nickname)
  if (error) throw error;
  return { nickname: r.nickname };
});
