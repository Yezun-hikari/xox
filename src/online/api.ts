import { FunctionsHttpError } from '@supabase/supabase-js';
import { checkNickname } from '../../supabase/functions/_shared/profanity.ts';
import { AuthFailure, dropDeadSession, ensureSession, getClient } from '../auth/index.ts';

export const GAME = 'xox';

const MESSAGES: Record<string, string> = {
  invalid: 'Ungültige Eingabe.',
  profane: 'Dieser Spitzname ist nicht erlaubt.',
  taken: 'Dieser Spitzname ist schon vergeben.',
  no_nickname: 'Bitte zuerst einen Spitznamen wählen.',
  not_your_turn: 'Du bist nicht am Zug.',
  illegal_move: 'Ungültiger Zug.',
  conflict: 'Das Spiel hat sich gerade geändert.',
  rate_limited: 'Bitte warte kurz, bevor du ein neues Bot-Spiel startest.',
  not_active: 'Die Partie ist bereits beendet.',
  not_found: 'Partie nicht gefunden.',
  not_expired: 'Die Zugzeit des Gegners ist noch nicht abgelaufen.',
  not_opponent_turn: 'Der Gegner ist nicht am Zug.',
  unauthorized: 'Sitzung abgelaufen. Bitte erneut versuchen.',
  network: 'Keine Verbindung zum Server.',
};

export class ApiError extends Error {
  constructor(public code: string) {
    super(MESSAGES[code] ?? 'Unbekannter Fehler. Bitte erneut versuchen.');
  }
}

/** Calls an Edge Function as the current user (guest session created if needed). Throws ApiError. */
export async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  await ensureSession();
  const { data, error } = await getClient().functions.invoke(fn, { body });
  if (!error) return data as T;
  let code = 'network';
  if (error instanceof FunctionsHttpError) {
    try {
      code = String((await error.context.json()).error ?? 'internal');
    } catch {
      code = 'internal';
    }
  }
  if (code === 'unauthorized') await dropDeadSession(); // next call then starts a fresh guest
  throw new ApiError(code);
}

/** German message for any thrown value. */
export const errorText = (e: unknown): string =>
  e instanceof ApiError || e instanceof AuthFailure ? e.message : 'Unbekannter Fehler. Bitte erneut versuchen.';

export interface Rating {
  elo: number;
  games: number;
  wins: number;
}

/** Own nickname (RLS: own row only), null if none set. */
export async function loadNickname(userId: string): Promise<string | null> {
  const { data, error } = await getClient().from('profiles').select('nickname').eq('id', userId).maybeSingle();
  if (error) throw new ApiError('network');
  return data?.nickname ?? null;
}

/** Rating line for the UI. */
export const ratingText = (r: Rating): string =>
  `Elo ${r.elo} · ${r.games} Spiele · ${r.wins} Siege`;

/** Own rating for this game (defaults before the first game). */
export async function loadRating(userId: string): Promise<Rating> {
  const { data, error } = await getClient()
    .from('ratings')
    .select('elo, games, wins')
    .eq('user_id', userId)
    .eq('game', GAME)
    .maybeSingle();
  if (error) throw new ApiError('network');
  return data ?? { elo: 100, games: 0, wins: 0 };
}

/**
 * Nickname form with instant client-side check (the server re-checks). Calls onSaved after success.
 * Returns the form element.
 */
export function nicknameForm(current: string | null, onSaved: (nickname: string) => void): HTMLFormElement {
  const form = document.createElement('form');
  form.className = 'form';
  form.noValidate = true;
  form.innerHTML = `
    <label class="field"><span>Spitzname <small>(für Gegner sichtbar, 3–16 Zeichen)</small></span>
      <input name="nickname" maxlength="16" autocomplete="nickname" required></label>
    <p class="msg" role="status"></p>
    <button class="btn primary" type="submit">Spitzname speichern</button>`;
  const input = form.querySelector('input')!;
  const msg = form.querySelector<HTMLElement>('.msg')!;
  const btn = form.querySelector('button')!;
  input.value = current ?? '';

  const local = () => {
    const r = checkNickname(input.value);
    if (r.ok) return null;
    return r.reason === 'profane' ? MESSAGES.profane : 'Nur Buchstaben, Ziffern, Leerzeichen, _ und -, 3–16 Zeichen.';
  };
  input.addEventListener('input', () => {
    const err = input.value.trim() ? local() : null;
    setMsg(msg, err ?? '', !!err);
    input.setAttribute('aria-invalid', String(!!err));
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = local();
    if (err) return setMsg(msg, err, true);
    btn.disabled = true;
    try {
      const { nickname } = await call<{ nickname: string }>('set-nickname', { nickname: input.value });
      input.value = nickname;
      setMsg(msg, 'Gespeichert.', false);
      onSaved(nickname);
    } catch (e) {
      setMsg(msg, errorText(e), true);
    } finally {
      btn.disabled = false;
    }
  });
  return form;
}

export function setMsg(el: HTMLElement, text: string, isError: boolean): void {
  el.textContent = text;
  el.classList.toggle('error', isError);
}

/** Static "not configured" view; local mode keeps working. */
export function notConfigured(root: HTMLElement, title: string, text: string): void {
  root.innerHTML = `
    <section class="placeholder">
      <a class="back" href="#/">← Menü</a>
      <h1 tabindex="-1"></h1>
      <p></p>
      <a class="btn primary" href="#/local">Lokal spielen</a>
    </section>`;
  root.querySelector('h1')!.textContent = title;
  root.querySelector('p')!.textContent = text;
}
