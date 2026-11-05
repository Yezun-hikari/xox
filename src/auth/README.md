# `src/auth` – shared login for Yezun's minigames

One Supabase project serves every game on `yezun.de`. This folder is the whole
client-side auth: framework-free, no imports from any game, only `@supabase/supabase-js`.

## Reuse in another game

1. `npm i @supabase/supabase-js`
2. Copy this folder into the game (`src/auth/`), or import it from a shared package. Keep it unchanged so all
   games behave the same.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public values only) at build time.
   Without them `isConfigured()` is `false` and every call throws `AuthFailure('Online-Modus nicht konfiguriert')`;
   the game's offline parts keep working.

Session sharing: the client uses `storageKey: 'yezun-games-auth'` in `localStorage`. All games on the same
origin (`https://yezun.de/<game>/`) therefore share one session: log in once, signed in everywhere.
Ratings are per game (`ratings.game` column), nickname and account are shared.

## API

```ts
import {
  isConfigured, getClient, ready, ensureSession, currentUser, isGuest, onAuthChange,
  register, login, logout, changePassword, deleteAccount, AuthFailure,
} from './auth/index.ts';

await ensureSession();          // guest (anonymous) session if none exists yet
currentUser();                  // { id, username | null, isGuest } | null  (await `ready` first after page load)
onAuthChange((u) => ...);       // called now and on every sign-in/out; returns unsubscribe
await register('name', 'pw');   // guest is upgraded in place: same user id, rating kept
await login('name', 'pw');      // switches account; the previous guest and its data are deleted
await logout();                 // this device only
await changePassword('old', 'new');
await deleteAccount('pw');      // password required for registered users, none for guests
getClient().from('ratings')...; // the shared supabase-js client for queries, Realtime, Edge Functions
```

Every failure is an `AuthFailure` whose `message` is German and safe to show. A failed login always says
"Benutzername oder Passwort falsch." – it never reveals whether a username exists.

## Rules

- Username `^[a-z0-9_]{3,20}$` (input is lowercased), password 8–72 characters.
- The username becomes the synthetic address `<username>@users.yezun-games.invalid`. `.invalid` is a reserved
  TLD (RFC 2606): it can never be a real mailbox. GoTrue accepts it (tested against the local stack).
- No email is stored, so there is **no password reset**. Tell users before they register.
- Logging into an existing account while playing as guest abandons the guest: tell users before they log in.
- `deleteAccount()` calls the `delete-account` Edge Function, which verifies the password server-side (registered
  users), scores the caller's running matches as lost, then deletes the auth user; all game data is removed by
  `ON DELETE CASCADE`. Errors: wrong password → "Aktuelles Passwort ist falsch."
- The database rejects any email except `<username>@users.yezun-games.invalid` (trigger on `auth.users`).
- Guests inactive for 30 days are deleted automatically (daily `pg_cron` job), unless they are in a running match.

## Security notes

- **Shared `localStorage`:** every game on `yezun.de` runs on the same origin and can read the
  shared session token. One XSS bug in any game compromises the accounts of all games. Every game must be
  XSS-free: never put user data (nicknames, usernames, server responses) into `innerHTML` or similar; use
  `textContent` / `createElement`.
- **Password change is only checked client-side.** `changePassword()` re-checks the current password with
  `signInWithPassword` in the browser, but Supabase's `updateUser({ password })` itself accepts any valid session.
  A stolen access token can therefore change the password. Server-side verification would need email
  reauthentication, which is impossible without real emails (known limit). Account deletion, in contrast, is
  verified server-side.

## Testing two players locally (dev builds only)

Append `?authslot=2` to the URL (before the `#`), e.g. `http://localhost:5173/xox/?authslot=2#/online`. The tab
then uses its own storage key `yezun-games-auth-2`, i.e. a separate session. This branch is guarded by
`import.meta.env.DEV` and removed from production builds.
