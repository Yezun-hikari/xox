# Supabase-Backend für xox – Einrichtung (einmalig)

Diese Anleitung richtet das Backend (Datenbank, Login, Online-Spiel, Elo) ein.
Du brauchst: einen GitHub-Account, Node.js (für `npx`) und etwa 20 Minuten.

> **Wichtig zur Sicherheit:** Der `service_role`-Schlüssel ("secret key") und das Datenbank-Passwort
> kommen **niemals** in eine Datei in diesem Repo, nicht in den Chat und nicht in eine GitHub-*Variable*.
> Öffentlich sein dürfen nur die Projekt-URL und der `anon`/"publishable"-Schlüssel.

## 1. Supabase-Projekt anlegen

1. Auf <https://supabase.com> mit GitHub anmelden.
2. **New project** → Name z. B. `yezun-games` (ein Projekt für alle Minispiele), Region **Central EU (Frankfurt)**.
3. Ein starkes **Database Password** erzeugen lassen und in deinem Passwort-Manager speichern
   (wird in Schritt 5 und 6 gebraucht).
4. Warten, bis das Projekt bereit ist.
5. Unter **Project Settings → General** die **Reference ID** notieren (z. B. `abcdefghijklmnop`).
6. Unter **Project Settings → API Keys** notieren:
   - die **Project URL** (`https://<reference-id>.supabase.co`)
   - den **anon / publishable key** (öffentlich, darf ins Frontend)

## 2. Einstellungen im Dashboard (manuell, einmalig)

Diese Einstellungen stehen zwar in `supabase/config.toml`, die Datei gilt aber **nur für die lokale
Entwicklung**. Im gehosteten Projekt musst du sie selbst setzen:

| Wo im Dashboard | Einstellung | Wert |
|---|---|---|
| Authentication → Sign In / Providers | **Allow anonymous sign-ins** | an |
| Authentication → Sign In / Providers → **Email** | Enable Email provider | an |
| Authentication → Sign In / Providers → **Email** | **Confirm email** | **aus** |
| Authentication → Sign In / Providers → **Email** | Secure email change | aus |
| Authentication → Sign In / Providers → **Email** | **Minimum password length** | **8** |
| Authentication → URL Configuration | Site URL | `https://yezun.de/xox/` |
| Authentication → URL Configuration | Redirect URLs | `http://localhost:5173/xox/` hinzufügen |

### Härtung (Pflicht, einmalig)

| Wo im Dashboard | Einstellung | Wert |
|---|---|---|
| Realtime → Settings | **Allow public access** | **aus**. Folge: Live-Updates per Realtime verbinden sich nicht (Channels sind dann nur privat). Das ist gewollt, die Seite fragt den Spielstand stattdessen alle 3 Sekunden ab. Auf "an" stellen ist nur nötig, wenn Zugriff ohne Wartezeit wichtiger ist als diese Härtung. |
| Database → Extensions | `pg_graphql` | **deaktiviert** (wird nicht gebraucht, vergrößert nur die Angriffsfläche) |
| Database → Extensions | `pg_cron` | **aktiviert** (Migration macht das selbst; nur prüfen) |
| Authentication → Rate Limits | Anonyme Anmeldungen pro Stunde und IP | niedrig, z. B. **30** |

- `pg_cron` löscht täglich (03:17 UTC) Gastkonten, die seit 30 Tagen nicht aktiv waren und keine laufende
  Partie haben. Kontrolle: **Integrations → Cron** zeigt den Job `purge-stale-guests`. Fehlt er (z. B. weil
  `pg_cron` beim `db push` nicht verfügbar war), `pg_cron` aktivieren und im SQL Editor ausführen:
  `select cron.schedule('purge-stale-guests', '17 3 * * *', 'select public.purge_stale_guests()');`
- `pg_cron` löscht außerdem stündlich Chat-Nachrichten, die älter als 24 Stunden sind (Job `purge-old-chat-messages`).
  Fehlt der Job, genauso im SQL Editor nachholen:
  `select cron.schedule('purge-old-chat-messages', '23 * * * *', $$delete from public.match_messages where created_at < now() - interval '24 hours'$$);`
- Optional: Authentication → Attack Protection → CAPTCHA. Erst aktivieren, wenn das Frontend es unterstützt
  (sonst schlägt jede Gast-Anmeldung fehl).
- **Nach der Einrichtung einmal testen:** auf der Seite ein Konto registrieren und wieder löschen. Das prüft,
  dass das gehostete Projekt die künstliche Domain `.invalid` (`<name>@users.yezun-games.invalid`) annimmt.
  Die Datenbank lehnt jede andere E-Mail-Adresse ab (Trigger `enforce_synthetic_email`).

**Regel für neue Migrationen:** Neue Tabellen, Sequenzen und Funktionen in `public` bekommen für `anon` und
`authenticated` **keine** Rechte mehr automatisch (Default Privileges sind entzogen). Jede neue Tabelle braucht
RLS und ein ausdrückliches `grant select … to authenticated`, jede Funktion, die ein Client aufrufen darf, ein
ausdrückliches `grant execute`. Was nicht freigegeben wird, bleibt zu.

Nicht manuell nötig (passiert automatisch durch Migration bzw. Deploy):
- Tabellen, RLS-Regeln, Realtime-Freigabe für `queue` und `matches`, Funktion `ping()`,
  E-Mail-Trigger und Cron-Job für alte Gastkonten.
- "Verify JWT" der Edge Functions (kommt aus `config.toml`).
- `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` für die Edge Functions (stellt Supabase selbst bereit).

## 3. Supabase CLI am eigenen Rechner anmelden

Im Projektordner (`xox`) im Terminal:

```sh
npx supabase login
```

Es öffnet sich der Browser, dort bestätigen.

## 4. Projekt verknüpfen

```sh
npx supabase link --project-ref <reference-id>
```

Nach dem Datenbank-Passwort fragen lassen und eingeben (nicht als Parameter in die Kommandozeile schreiben).

## 5. Datenbank einrichten (Migrationen)

```sh
npx supabase db push
```

Das legt die Tabellen `profiles`, `ratings`, `queue`, `matches`, `match_messages` mit allen Sicherheitsregeln an.
Kontrolle im Dashboard unter **Table Editor**: bei jeder Tabelle steht "RLS enabled".

## 6. Edge Functions hochladen

```sh
npx supabase functions deploy --project-ref <reference-id>
```

Danach sind unter **Edge Functions** neun Funktionen sichtbar:
`set-nickname`, `matchmake`, `move`, `resign`, `claim-timeout`, `delete-account`, `bot-game`, `bot-move`, `chat-send`.

## 7. GitHub einrichten (automatisches Deployment)

Im GitHub-Repo → **Settings → Secrets and variables → Actions**.

**Secrets** (Tab "Secrets", geheim):

| Name | Wert | woher |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | persönlicher Token | supabase.com → Account → **Access Tokens** → Generate new token |
| `SUPABASE_DB_PASSWORD` | Datenbank-Passwort | aus Schritt 1.3 |

**Variables** (Tab "Variables", öffentlich sichtbar – nur öffentliche Werte!):

| Name | Wert |
|---|---|
| `SUPABASE_PROJECT_REF` | Reference ID aus Schritt 1.5 |
| `VITE_SUPABASE_URL` | Project URL aus Schritt 1.6 |
| `VITE_SUPABASE_ANON_KEY` | anon / publishable key aus Schritt 1.6 |

Außerdem: **Settings → Pages → Source: GitHub Actions**.

Ab jetzt gilt:
- Push auf `main` mit Änderungen unter `supabase/` → Workflow *Deploy Supabase* spielt Migrationen und Functions ein.
- Push auf `main` → Workflow *Deploy to GitHub Pages* baut die Seite.
- Workflow *Keep Supabase awake* ruft alle 3 Tage `ping()` auf, damit das kostenlose Projekt nicht pausiert.
  Einmal manuell testen: **Actions → Keep Supabase awake → Run workflow**.

## Lokal entwickeln (optional, braucht Docker Desktop)

```sh
npx supabase start            # startet Datenbank, Auth, Realtime, Functions lokal
npx supabase db reset         # optional: Datenbank leeren und alle Migrationen neu einspielen
npx supabase functions serve  # Edge Functions mit Hot-Reload
npx supabase stop             # alles wieder beenden
```

`npx supabase start` zeigt lokale URL und Schlüssel an. Diese Werte in eine eigene `.env.local`
(wird von Git ignoriert) als `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` eintragen
(`VITE_SUPABASE_URL=http://127.0.0.1:54321`, Schlüssel = `ANON_KEY`), dann `npx vite`.

Gegen sich selbst testen: zweiten Tab mit `?authslot=2` vor dem `#` öffnen
(z. B. `http://localhost:5173/xox/?authslot=2#/online`). Der Tab bekommt eine eigene Sitzung.
Funktioniert nur im Entwicklungsmodus, nicht auf der veröffentlichten Seite.

## Was wo liegt

- `migrations/` – Datenbankschema, RLS, SQL-Funktionen `finish_match`, `matchmake`, `ping`,
  `purge_stale_guests`, `send_match_message`, Trigger `enforce_synthetic_email`
- `functions/<name>/index.ts` – die Edge Functions
- `functions/_shared/` – Code, den auch das Frontend nutzt (`rules.ts`, `profanity.ts`)
- `functions/_server/` – nur für Edge Functions (CORS, Login-Prüfung, Datenbankzugriff)

## Fehlersuche

- **Functions antworten mit 401**, obwohl man eingeloggt ist: Falls das Projekt die neuen
  "JWT Signing Keys" nutzt, kann die Gateway-Prüfung ("Verify JWT") Probleme machen. Dann in
  `config.toml` bei allen Functions `verify_jwt = false` setzen und neu deployen – die Functions
  prüfen den Login trotzdem selbst (`getUser`).
- **Projekt pausiert**: im Dashboard auf *Restore* klicken, dann den Keepalive-Workflow prüfen.
- **Benutzer löschen**: Spieler können ihr Konto selbst löschen (Konto → Konto löschen). Manuell: Authentication → Users → Benutzer löschen. Profil, Elo, Warteschlange und
  dessen Partien werden automatisch mitgelöscht.
