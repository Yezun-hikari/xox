/**
 * Shared auth for Yezun's minigames (same Supabase project, same session on yezun-hikari.github.io).
 * Framework-free, no game-specific imports. See README.md in this folder.
 *
 * Accounts are username + password. The username is mapped to a synthetic email under a reserved
 * domain that can never receive mail, so no real email is ever stored (and no password reset exists).
 * Every function throws `AuthFailure` with a German, user-presentable message on failure.
 */
import { createClient, FunctionsHttpError, type AuthError, type Session, type SupabaseClient } from '@supabase/supabase-js';

export const NOT_CONFIGURED = 'Online-Modus nicht konfiguriert';
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const MIN_PASSWORD = 8;
/** RFC 2606 reserved TLD: such an address can never be a real mailbox. */
const EMAIL_DOMAIN = 'users.yezun-games.invalid';

export class AuthFailure extends Error {}

export interface AuthUser {
  id: string;
  /** null for guests (anonymous users). */
  username: string | null;
  isGuest: boolean;
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Dev builds only: `?authslot=2` gives the tab its own session, to play against yourself locally.
// import.meta.env.DEV is statically false in production builds, so this is dropped there.
const slot = import.meta.env.DEV ? new URLSearchParams(location.search).get('authslot') : null;
const storageKey = 'yezun-games-auth' + (slot && /^\w{1,8}$/.test(slot) ? '-' + slot : '');

const client: SupabaseClient | null = url && anonKey ? createClient(url, anonKey, { auth: { storageKey } }) : null;

export const isConfigured = (): boolean => client !== null;

/** The shared supabase-js client (for database reads, Realtime, Edge Functions). Throws if not configured. */
export function getClient(): SupabaseClient {
  if (!client) throw new AuthFailure(NOT_CONFIGURED);
  return client;
}

let session: Session | null = null;
// Resolves once the stored session has been loaded, so currentUser() is reliable after it.
export const ready: Promise<void> = client
  ? client.auth.getSession().then(({ data }) => {
      session = data.session;
      if (session) void dropDeadSession();
    })
  : Promise.resolve();
client?.auth.onAuthStateChange((_e, s) => (session = s));

/**
 * Asks the server whether the stored session's user still exists (e.g. account deleted on another device).
 * If not, signs out locally so the next ensureSession() starts a fresh guest. Network errors keep the session.
 */
export async function dropDeadSession(): Promise<void> {
  const c = getClient();
  const { error } = await c.auth.getUser();
  if (error?.status && error.status >= 400 && error.status < 500) await c.auth.signOut({ scope: 'local' });
}

const toUser = (s: Session | null): AuthUser | null => {
  const u = s?.user;
  if (!u) return null;
  const isGuest = u.is_anonymous === true || !u.email;
  return { id: u.id, isGuest, username: isGuest ? null : (u.email ?? '').split('@')[0] };
};

export const currentUser = (): AuthUser | null => toUser(session);
/** True when there is no account yet or the session is anonymous. */
export const isGuest = (): boolean => currentUser()?.isGuest ?? true;

/** Calls cb now and on every sign-in / sign-out / user change. Returns an unsubscribe function. */
export function onAuthChange(cb: (user: AuthUser | null) => void): () => void {
  if (!client) {
    cb(null);
    return () => {};
  }
  const { data } = client.auth.onAuthStateChange((_e, s) => setTimeout(() => cb(toUser(s)))); // no await inside callback
  return () => data.subscription.unsubscribe();
}

let pending: Promise<AuthUser> | null = null;

/** Returns the current user, signing in anonymously (as guest) if there is no session yet. */
export function ensureSession(): Promise<AuthUser> {
  pending ??= (async () => {
    const c = getClient();
    await ready;
    const { data } = await c.auth.getSession();
    if (data.session) return toUser(data.session)!;
    const { data: d, error } = await c.auth.signInAnonymously();
    if (error || !d.session) throw fail(error);
    return toUser(d.session)!;
  })().finally(() => (pending = null));
  return pending;
}

function normalize(username: string): string {
  const u = username.trim().toLowerCase();
  if (!USERNAME_RE.test(u)) throw new AuthFailure('Benutzername: 3–20 Zeichen, nur a–z, 0–9 und _.');
  return u;
}

function checkPassword(pw: string): void {
  if (pw.length < MIN_PASSWORD) throw new AuthFailure(`Passwort: mindestens ${MIN_PASSWORD} Zeichen.`);
  if (pw.length > 72) throw new AuthFailure('Passwort: höchstens 72 Zeichen.'); // bcrypt limit
}

const toEmail = (username: string) => `${username}@${EMAIL_DOMAIN}`;

function fail(e: AuthError | null | undefined, fallback = 'Unbekannter Fehler. Bitte erneut versuchen.'): AuthFailure {
  if (!e) return new AuthFailure(fallback);
  if (e.status === 429 || e.code === 'over_request_rate_limit') return new AuthFailure('Zu viele Versuche. Bitte später erneut.');
  if (e.name === 'AuthRetryableFetchError' || e.status === 0) return new AuthFailure('Keine Verbindung zum Server.');
  switch (e.code) {
    case 'user_already_exists':
    case 'email_exists':
      return new AuthFailure('Dieser Benutzername ist bereits vergeben.');
    case 'weak_password':
      return new AuthFailure(`Passwort zu schwach (mindestens ${MIN_PASSWORD} Zeichen).`);
    case 'same_password':
      return new AuthFailure('Das neue Passwort muss sich vom alten unterscheiden.');
    case 'anonymous_provider_disabled':
    case 'signup_disabled':
      return new AuthFailure('Anmeldung ist derzeit deaktiviert.');
  }
  return new AuthFailure(fallback);
}

/**
 * Creates an account. A guest is upgraded in place (same user id, so ratings are kept);
 * without a session a fresh account is created.
 */
export async function register(username: string, password: string): Promise<AuthUser> {
  const c = getClient();
  const u = normalize(username);
  checkPassword(password);
  await ready;
  const { data } = await c.auth.getSession();
  const s = data.session;
  if (s && !toUser(s)!.isGuest) throw new AuthFailure('Du bist bereits angemeldet.');
  if (s) {
    const { data: d, error } = await c.auth.updateUser({ email: toEmail(u), password });
    if (error || !d.user) throw fail(error);
    // updateUser does not always refresh the cached session's user; refresh so is_anonymous=false is visible
    await c.auth.refreshSession();
  } else {
    const { error } = await c.auth.signUp({ email: toEmail(u), password });
    if (error) throw fail(error);
  }
  return currentUser()!;
}

/**
 * Signs in to an existing account. A current guest session is abandoned: its rating stays with the guest
 * and the guest's data is deleted (best effort) so no orphaned data lingers.
 */
export async function login(username: string, password: string): Promise<AuthUser> {
  const c = getClient();
  const u = username.trim().toLowerCase();
  // Same message for malformed names as for wrong credentials: never reveal whether a name exists.
  if (!USERNAME_RE.test(u) || !password) throw new AuthFailure('Benutzername oder Passwort falsch.');
  await ready;
  const guest = (await c.auth.getSession()).data.session;
  const guestToken = guest && toUser(guest)!.isGuest ? guest.access_token : null;
  const { error } = await c.auth.signInWithPassword({ email: toEmail(u), password });
  if (error) {
    if (error.status === 429 || error.name === 'AuthRetryableFetchError') throw fail(error);
    throw new AuthFailure('Benutzername oder Passwort falsch.');
  }
  if (guestToken) {
    c.functions
      .invoke('delete-account', { body: {}, headers: { Authorization: `Bearer ${guestToken}` } })
      .catch(() => {});
  }
  return currentUser()!;
}

/** Signs out on this device. A later ensureSession() starts a new guest. */
export async function logout(): Promise<void> {
  const { error } = await getClient().auth.signOut({ scope: 'local' });
  if (error) throw fail(error);
}

/** Re-checks the password of the signed-in (non-guest) user. */
async function reauth(password: string): Promise<void> {
  const c = getClient();
  const me = currentUser();
  if (!me?.username) throw new AuthFailure('Nicht angemeldet.');
  const { error } = await c.auth.signInWithPassword({ email: toEmail(me.username), password });
  if (error) throw error.status === 429 ? fail(error) : new AuthFailure('Aktuelles Passwort ist falsch.');
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  checkPassword(newPassword);
  await reauth(currentPassword);
  const { error } = await getClient().auth.updateUser({ password: newPassword });
  if (error) throw fail(error);
}

/**
 * Permanently deletes the account and all its game data (all games sharing the project).
 * Registered users must confirm with their password (checked server-side); guests need none.
 * Running matches count as lost.
 */
export async function deleteAccount(password?: string): Promise<void> {
  const c = getClient();
  await ready;
  const me = currentUser();
  if (!me) return;
  if (!me.isGuest && !password) throw new AuthFailure('Aktuelles Passwort ist falsch.');
  // the server verifies the password; running matches are scored as a loss before deletion
  const { error } = await c.functions.invoke('delete-account', { body: me.isGuest ? {} : { password } });
  if (error) {
    if (!(error instanceof FunctionsHttpError)) throw new AuthFailure('Keine Verbindung zum Server.');
    const code = await error.context.json().then((b: { error?: string }) => b.error, () => undefined);
    if (code === 'wrong_password') throw new AuthFailure('Aktuelles Passwort ist falsch.');
    if (code === 'rate_limited') throw new AuthFailure('Zu viele Versuche. Bitte später erneut.');
    throw new AuthFailure('Löschen fehlgeschlagen. Bitte erneut versuchen.');
  }
  await c.auth.signOut({ scope: 'local' });
}
