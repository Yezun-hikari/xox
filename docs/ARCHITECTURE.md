# Architecture

Frontend: static Vite + TypeScript app on GitHub Pages (`https://yezun.de/xox/`).
Backend: Supabase (Auth, Postgres + RLS, Realtime, Edge Functions). The server is authoritative for online games and Elo.

**The backend source (migrations, Edge Functions, Supabase workflows) and the account system live in the central repo [konto](https://github.com/Yezun-hikari/konto)** (`supabase/`, `CONTRACT.md`). This document describes what xox relies on; konto is the source of truth.

## Privacy rules (non-negotiable)
- No user data in the repo, in the built site, or in any public place — not even encrypted.
- Only the public Supabase URL + anon key ship to the browser. The `service_role` key lives only in Supabase Edge Function env.
- Every table has RLS enabled. Clients get **no** insert/update/delete policies; all writes go through Edge Functions or `security definer` SQL functions.
- A user can read only their own profile/rating/queue row, and only matches they play in.
- Login name is private (stored only inside `auth.users` as a synthetic email). Nickname is the only public-facing name, and only shown to the current opponent.

## Accounts (shared across all of Yezun's minigames)
- Same Supabase project for every game. Auth client uses `storageKey: 'yezun-games-auth'`, so all games on `yezun.de` share one session.
- Guests: Supabase anonymous sign-in. Register = upgrade the anonymous user in place (`updateUser({ email, password })`), so Elo is kept.
- Username + password only. Username `^[a-z0-9_]{3,20}$` (lowercased), mapped to synthetic email `<username>@users.yezun-games.invalid` (reserved TLD, never a real mailbox; accepted by GoTrue). Password 8–72 chars. Email confirmation disabled. Password reset only via an optional verified recovery email, stored server-side outside `auth.users` (see konto).
- Client module: the SDK `@yezun/konto` (git dependency, successor of the former `src/auth/`). Login, registration, password change/reset, recovery email and account deletion happen on the account page https://yezun.de/konto/; xox only links there with `loginUrl()` / `accountUrl()` (return to the current page) and keeps guests (`ensureSession`) and the nickname. After the redirect back, the fresh page load reads the shared session from `localStorage`; other open tabs are updated by supabase-js' BroadcastChannel, and a page restored from the back/forward cache reloads itself. Logging into an existing account while a guest deletes that guest (best effort, via `delete-account` with the guest's token) so no orphaned data remains. Changing the password (client-side check only) and deleting a registered account (server-side check) require the current password. All games share `localStorage` on one origin, so every game must be XSS-free.
- Per-game data is keyed by a `game` text column (`'xox'` here).

## Tables (public schema)
| table | columns | client read |
|---|---|---|
| profiles | id uuid PK → auth.users, nickname text (unique, case-insensitive), created_at | own row |
| ratings | user_id, game, elo int default 100, rd numeric default 350, rated_at, games int, wins int; PK(user_id, game) | own rows |
| queue | id PK (random surrogate: Realtime DELETE payloads carry only the PK, unfiltered by RLS), user_id unique, game, elo, nickname, joined_at, last_seen, match_id uuid null | own row |
| matches | id, game, x_id, o_id, x_nick, o_nick, x_elo, o_elo, state jsonb (GameState), status 'active'/'finished', winner_id, elo_delta int, x_delta int, o_delta int, turn_deadline timestamptz, created_at, updated_at | if participant |
| match_messages | id bigint identity PK, match_id → matches, sender_id → auth.users (both cascade), body text (1–200 chars), created_at; index (match_id, id) | if participant of that match |

`match_messages` is not in the Realtime publication: clients poll it, like the game state. The `service_role` key has no table access to it either; `chat-send` writes through `send_match_message` (security definer, not callable by clients).

Realtime: DELETE events skip RLS and reach every subscriber of the table (payload = primary key only), so published tables must not have user ids as PK. Clients subscribe to `postgres_changes` on `queue` (own row, to learn `match_id`) and `matches` (`id=eq.<id>`). RLS applies to Realtime.

## Edge Functions (JWT required; anonymous users allowed)
All return JSON; errors as `{ error: '<code>' }` with 4xx status.
- `set-nickname` `{ nickname }` → `{ nickname }` | error `invalid` | `profane` | `taken`
- `matchmake` `{ action: 'join' | 'leave', game: 'xox' }` → `{ status: 'waiting' }` | `{ status: 'matched', matchId }` | `{ status: 'left' }`. Needs a nickname first (error `no_nickname`). Pairs closest Elo, race-safe (`for update skip locked`). `join` is also the heartbeat: waiting clients re-send it every ~8 s (refreshes `queue.last_seen`); waiting entries not seen for > 20 s are deleted before pairing. `join` while a match is active returns that match (resume).
- `move` `{ matchId, index }` → `{ state, events }`. Validates participant + turn via shared `rules.ts`. On win: Elo update.
- `resign` `{ matchId }` → opponent wins.
- `claim-timeout` `{ matchId }` → if `now() > turn_deadline` and it is the opponent's turn, caller wins. Turn time: 60 s. Not for bot matches (400 `invalid`): the client triggers the bot's move, so it could let the bot "time out".
- `delete-account` `{ password? }` → `{ status: 'deleted' }` | error `wrong_password` (403) | `rate_limited` (429). Registered (non-anonymous) callers must send their password; it is verified server-side with `signInWithPassword` on a separate, non-persisting anon-key client. Guests send `{}`. Every active match of the caller is first finished as a loss for the caller (`finish_match`, Elo applied), then the auth user is deleted (service role `auth.admin.deleteUser`); cascade removes profile, ratings, queue entry and all their matches (the opponent's clients see the UPDATE to finished, then a Realtime DELETE). The guest deletion on login goes through this function too.
- `chat-send` `{ matchId, text }` → `{ message: { id, sender_id, body, created_at } }` (`body` is the cleaned text). Errors: 400 `invalid` (bad input, bot match) | `empty` | `too_long` | `profane` | `link`, 404 `not_found` (also for non-participants), 409 `chat_closed` (match finished 10 minutes ago or longer), 429 `rate_limited` (per sender and match: at most 5 messages in 10 s, at least 500 ms apart, enforced in `send_match_message`). Message text is never logged. Clients read with `select` on `match_messages` (RLS) and must render `body` as text, never as HTML.

## Database-enforced privacy
- Trigger `enforce_synthetic_email` (before insert/update of `email`, `email_change` on `auth.users`) rejects every email except `^[a-z0-9_]{3,20}@users\.yezun-games\.invalid$`. Anonymous users have `email = null`. A direct `signUp`/`updateUser` with a real address fails with 500.
- Guest retention: `purge_stale_guests()` (security definer, no client access) deletes anonymous users whose `created_at`/`last_sign_in_at`/`updated_at` and all session refreshes are older than 30 days and who have no active match; cascade removes their data. Scheduled daily 03:17 UTC by `pg_cron` (job `purge-stale-guests`); the migration skips scheduling if `pg_cron` is unavailable.
- Chat retention: `pg_cron` job `purge-old-chat-messages` runs hourly (minute 23) and deletes messages older than 24 h, so a message lives at most about 25 h. Same skip if `pg_cron` is unavailable. Deleting a match or a user removes their messages by cascade.
- Default privileges in `public` are revoked for `anon`/`authenticated`: every new table/sequence/function needs explicit grants (and RLS).
- Known limit: `updateUser({ password })` cannot be verified server-side without email reauthentication; the client re-checks the current password only.

- `bot-game` `{ game }` → `{ status: 'matched', matchId }` | `no_nickname` | 429 `rate_limited`. Starts (or resumes) a **rated** match against the bot. Bot name/Elo/seat are picked here (`_shared/bot.ts`: Elo = player ±100, clamped 100–1400).
- `bot-move` `{ matchId }` → `{ state, events }`. Plays the bot's move if it is the bot's turn in the caller's bot match (`not_bot_turn` otherwise). The client calls it after a short "thinking" pause.

Bots: one fixed, unusable auth user (`b07b07b0-0000-4000-8000-000000000001`, banned, no password) is the opponent so `matches` keeps its foreign keys; `matches.is_bot = true`. The bot's Elo lives only in `matches.x_elo/o_elo` for that match, never in `ratings`; `finish_match` changes only the human's rating. Farming limits: bot Elo is capped at 1400 (stronger players gain ~0) and one new bot match per 60 s. The AI is minimax with alpha-beta (depth 3 below Elo 1000, else 4). Mistakes are human: with an Elo-dependent chance it overlooks a point or threat and plays a plausible move near its own pieces instead of a random one. Open threes are blocked reflexively (about 60% at Elo 100, 94% at 1400), and from Elo 800 a calculated counter-attack may replace the block. Each bot name has a slight attack or defence style (`styleOf`). The client waits `thinkTimeMs` (300-2000 ms) before asking for the move.

Rating: Glicko-1 per game (the system family Chess.com uses), start 100 with RD 350, floor 100, RD floor 45, RD grows back to 350 in about a year without games. Bots count with RD 200. Fewer than 2 moves played = aborted: finished without winner and without rating change. Applied atomically in SQL function `finish_match(match_id, winner_id)` (security definer, not callable by clients).

## Shared code
Server copies live in konto `supabase/functions/_shared/`; the frontend copies in `src/shared/` must stay identical.
- `src/shared/rules.ts` — game rules, used by the frontend and (as copy) by the Edge Functions.
- `src/shared/bot.ts` — bot AI (`thinkTimeMs` used by the client).
- `src/shared/profanity.ts` — DE + EN filter for nicknames (`checkNickname`) and chat messages (`checkChat`: also cleans the text, catches separator obfuscation, rejects links and contact data), with leetspeak/umlaut/repeat normalization. Frontend imports it too for instant feedback; the server check is the one that counts.

## Ops
- `.github/workflows/deploy.yml` builds and publishes to Pages (repo variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- Supabase deploy (`supabase.yml`) and keepalive (`keepalive.yml`) workflows live in konto.
