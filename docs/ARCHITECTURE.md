# Architecture

Frontend: static Vite + TypeScript app on GitHub Pages (`https://yezun-hikari.github.io/xox/`).
Backend: Supabase (Auth, Postgres + RLS, Realtime, Edge Functions). The server is authoritative for online games and Elo.

## Privacy rules (non-negotiable)
- No user data in the repo, in the built site, or in any public place — not even encrypted.
- Only the public Supabase URL + anon key ship to the browser. The `service_role` key lives only in Supabase Edge Function env.
- Every table has RLS enabled. Clients get **no** insert/update/delete policies; all writes go through Edge Functions or `security definer` SQL functions.
- A user can read only their own profile/rating/queue row, and only matches they play in.
- Login name is private (stored only inside `auth.users` as a synthetic email). Nickname is the only public-facing name, and only shown to the current opponent.

## Accounts (shared across all of Yezun's minigames)
- Same Supabase project for every game. Auth client uses `storageKey: 'yezun-games-auth'`, so all games on `yezun-hikari.github.io` share one session.
- Guests: Supabase anonymous sign-in. Register = upgrade the anonymous user in place (`updateUser({ email, password })`), so Elo is kept.
- Username + password only. Username `^[a-z0-9_]{3,20}$` (lowercased), mapped to synthetic email `<username>@users.yezun-games.invalid` (reserved TLD, never a real mailbox; accepted by GoTrue). Password 8–72 chars. Email confirmation disabled. No password reset possible (by design: no email stored).
- Client module: `src/auth/` (framework-free, reusable by other games, see its README). Logging into an existing account while a guest deletes that guest (best effort, via `delete-account` with the guest's token) so no orphaned data remains. Changing the password (client-side check only) and deleting a registered account (server-side check) require the current password. All games share `localStorage` on one origin, so every game must be XSS-free.
- Per-game data is keyed by a `game` text column (`'xox'` here).

## Tables (public schema)
| table | columns | client read |
|---|---|---|
| profiles | id uuid PK → auth.users, nickname text (unique, case-insensitive), created_at | own row |
| ratings | user_id, game, elo int default 1000, games int, wins int; PK(user_id, game) | own rows |
| queue | id PK (random surrogate: Realtime DELETE payloads carry only the PK, unfiltered by RLS), user_id unique, game, elo, nickname, joined_at, last_seen, match_id uuid null | own row |
| matches | id, game, x_id, o_id, x_nick, o_nick, x_elo, o_elo, state jsonb (GameState), status 'active'/'finished', winner_id, elo_delta int, turn_deadline timestamptz, created_at, updated_at | if participant |

Realtime: DELETE events skip RLS and reach every subscriber of the table (payload = primary key only), so published tables must not have user ids as PK. Clients subscribe to `postgres_changes` on `queue` (own row, to learn `match_id`) and `matches` (`id=eq.<id>`). RLS applies to Realtime.

## Edge Functions (JWT required; anonymous users allowed)
All return JSON; errors as `{ error: '<code>' }` with 4xx status.
- `set-nickname` `{ nickname }` → `{ nickname }` | error `invalid` | `profane` | `taken`
- `matchmake` `{ action: 'join' | 'leave', game: 'xox' }` → `{ status: 'waiting' }` | `{ status: 'matched', matchId }` | `{ status: 'left' }`. Needs a nickname first (error `no_nickname`). Pairs closest Elo, race-safe (`for update skip locked`). `join` is also the heartbeat: waiting clients re-send it every ~8 s (refreshes `queue.last_seen`); waiting entries not seen for > 20 s are deleted before pairing. `join` while a match is active returns that match (resume).
- `move` `{ matchId, index }` → `{ state, events }`. Validates participant + turn via shared `rules.ts`. On win: Elo update.
- `resign` `{ matchId }` → opponent wins.
- `claim-timeout` `{ matchId }` → if `now() > turn_deadline` and it is the opponent's turn, caller wins. Turn time: 60 s.
- `delete-account` `{ password? }` → `{ status: 'deleted' }` | error `wrong_password` (403) | `rate_limited` (429). Registered (non-anonymous) callers must send their password; it is verified server-side with `signInWithPassword` on a separate, non-persisting anon-key client. Guests send `{}`. Every active match of the caller is first finished as a loss for the caller (`finish_match`, Elo applied), then the auth user is deleted (service role `auth.admin.deleteUser`); cascade removes profile, ratings, queue entry and all their matches (the opponent's clients see the UPDATE to finished, then a Realtime DELETE). The guest deletion on login goes through this function too.

## Database-enforced privacy
- Trigger `enforce_synthetic_email` (before insert/update of `email`, `email_change` on `auth.users`) rejects every email except `^[a-z0-9_]{3,20}@users\.yezun-games\.invalid$`. Anonymous users have `email = null`. A direct `signUp`/`updateUser` with a real address fails with 500.
- Guest retention: `purge_stale_guests()` (security definer, no client access) deletes anonymous users whose `created_at`/`last_sign_in_at`/`updated_at` and all session refreshes are older than 30 days and who have no active match; cascade removes their data. Scheduled daily 03:17 UTC by `pg_cron` (job `purge-stale-guests`); the migration skips scheduling if `pg_cron` is unavailable.
- Default privileges in `public` are revoked for `anon`/`authenticated`: every new table/sequence/function needs explicit grants (and RLS).
- Known limit: `updateUser({ password })` cannot be verified server-side without email reauthentication; the client re-checks the current password only.

Elo: K = 32, start 1000, expected = 1 / (1 + 10^((Rb − Ra) / 400)). Applied atomically in SQL function `finish_match(match_id, winner_id)` (security definer, not callable by clients).

## Shared code
- `supabase/functions/_shared/rules.ts` — game rules, imported by both the frontend and Edge Functions.
- `supabase/functions/_shared/profanity.ts` — DE + EN nickname filter (leetspeak/umlaut/repeat normalization). Frontend imports it too for instant feedback; the server check is the one that counts.

## Ops
- `.github/workflows/deploy.yml` builds and publishes to Pages (repo variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- `.github/workflows/supabase.yml` pushes migrations + functions (Supabase CLI pinned to the local version, 3.0.0) (secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, variable `SUPABASE_PROJECT_REF`).
- `.github/workflows/keepalive.yml` pings the project every 3 days so the free tier does not pause.
