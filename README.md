# XOX – 4x4 Tic-Tac-Toe

Eine moderne Variante von Tic-Tac-Toe auf einem 4x4-Feld mit Eis-Mechanik, Online-Matchmaking, Elo-Wertung und optionalem Konto.
Läuft komplett im Browser (GitHub Pages). Das Online-Backend (Supabase) und die Konten liegen im zentralen Repo [konto](https://github.com/Yezun-hikari/konto).

**Spielen:** <https://yezun.de/xox/>

## Spielregeln

- Zwei Spieler (X und O) setzen abwechselnd auf ein 4x4-Feld. **Wer zuerst 3 Punkte hat, gewinnt.**
- Eine Reihe zählt in allen 10 Linien: 4 waagerecht, 4 senkrecht, 2 diagonal.
- Ist eine Reihe voll, wird sie ausgewertet:

| Reihe | Ergebnis |
|---|---|
| 4 × dasselbe Zeichen | **1 Punkt**, die Reihe wird geleert |
| 2 × X und 2 × O | Die Reihe wird geleert (ohne Punkt) |
| 3 × dasselbe + 1 × anderes | Die Reihe bleibt. Das einzelne Zeichen **friert 3 Züge lang ein** und verschwindet dann. |

- Eingefrorene Steine in einer Reihe, die geleert wird, verschwinden trotzdem.
- Schließt ein Zug mehrere Reihen gleichzeitig, werden alle zusammen ausgewertet. Leeren hat Vorrang vor Einfrieren.
- Die 3 Züge zählen für beide Spieler (jeder Zug, egal von wem, tickt den Zähler herunter).
- Ist kein Feld mehr frei, wird der Zug automatisch übersprungen.

## Funktionen

- **Lokal** zu zweit auf einem Gerät.
- **Online-Matchmaking** mit Gegnern ähnlicher Elo, 60 Sekunden pro Zug, Aufgeben und Sieg bei Zeitüberschreitung.
- **Gegen Bot spielen:** Findet sich nach 5 Sekunden kein Gegner, erscheint der Button "Gegen Bot spielen". Der Bot ist eine kleine KI (Minimax-Suche, Stärke und Fehlerquote folgen seiner Elo) mit einer Elo nahe an deiner (±100, zwischen 100 und 1400). Bot-Partien sind gewertet; ein neues Bot-Spiel ist höchstens einmal pro Minute möglich.
- **Wertung nach dem Glicko-System**, das auch Chess.com nutzt: Start bei 100, nie darunter. In den ersten Partien bewegt sich die Zahl stark, danach pendelt sie sich ein. Nach langer Pause zählt die nächste Partie wieder mehr. Partien mit weniger als 2 Zügen werden abgebrochen und nicht gewertet. Serverseitig berechnet und nicht manipulierbar durch den Client.
- **Nickname** mit Schimpfwort-Filter (Deutsch und Englisch, erkennt Leetspeak und Umlaute).
- **Gast oder Konto:** Gäste spielen sofort. Anmelden, Registrieren und die Kontoverwaltung laufen über die zentrale
  Konto-Seite <https://yezun.de/konto/> (ein Konto für alle Seiten auf yezun.de); danach geht es automatisch zurück zu XOX.
  Wer sich registriert, behält seine Elo.
- Modernes, mobilfreundliches Design, Dark Mode (automatisch oder manuell), Tastatursteuerung, Screenreader-Hinweise, Favicon und Web-App-Manifest.

## Technik

| Bereich | Umsetzung |
|---|---|
| Frontend | Vite, TypeScript, kein Framework |
| Hosting | GitHub Pages, Deployment per GitHub Action |
| Backend | Supabase (Auth, Postgres mit Row Level Security, Realtime, Edge Functions), Quelltext im Repo [konto](https://github.com/Yezun-hikari/konto) |
| Konto | SDK [`@yezun/konto`](https://github.com/Yezun-hikari/konto/blob/main/sdk/README.md) (Git-Abhängigkeit), Konto-Seite <https://yezun.de/konto/> |
| Spielregeln | [`src/shared/rules.ts`](src/shared/rules.ts) – identische Kopie von `supabase/functions/_shared/rules.ts` in konto (Server) |
| Tests | Vitest (Regeln, Bot, Nickname-Filter) |

Der Server ist maßgeblich: Züge und Elo werden nur in Edge Functions geprüft und berechnet. Details stehen in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Datenschutz und Sicherheit

- Nutzerdaten liegen nur in Supabase, nie im Repository oder auf der öffentlichen Seite.
- Row Level Security auf allen Tabellen. Clients haben nur Leserechte auf **eigene** Daten. Alle Schreibzugriffe laufen über Edge Functions.
- Im Browser stehen nur die öffentliche Projekt-URL und der „publishable“ Key. Geheime Schlüssel gehören nie ins Repo.
- Die Datenbank lehnt echte E-Mail-Adressen ab (nur künstliche Adressen für den Login-Namen).
- Konto löschen entfernt alle zugehörigen Daten. Inaktive Gastkonten werden nach 30 Tagen automatisch gelöscht.
- Alle Seiten unter `yezun.de` teilen sich den Browser-Speicher der Sitzung, deshalb muss jede dieser Seiten frei von XSS sein.
  Passwort-Reset gibt es nur mit freiwilliger, bestätigter Wiederherstellungs-E-Mail (in konto). Mehr dazu in [konto](https://github.com/Yezun-hikari/konto).

## Lokal entwickeln

Voraussetzung: Node.js 22 oder neuer.

```sh
npm ci
npm run dev        # Entwicklungsserver (lokaler Modus funktioniert ohne Backend)
npm test           # Tests
npm run build      # Typprüfung und Produktions-Build
```

Für den Online-Modus lokal: Supabase aus dem Repo [konto](https://github.com/Yezun-hikari/konto) starten (Docker Desktop, siehe dort `supabase/README.md`)
und `.env.local` aus `.env.example` anlegen. Optional `VITE_KONTO_URL` auf den Dev-Server der Konto-Seite setzen,
damit „Anmelden“ nicht auf <https://yezun.de/konto/> verlinkt.

## Backend und Konten

Migrationen, Edge Functions (auch `set-nickname`, `matchmake`, `move`, …) und die Workflows für Supabase-Deploy und
Keepalive liegen im Repo [konto](https://github.com/Yezun-hikari/konto). Dieses Repo enthält nur noch das Frontend.

Nötige GitHub-Einstellungen hier:

- **Variables:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- **Pages:** Settings → Pages → Source: GitHub Actions

## Projektstruktur

```
src/
  ui/         Oberfläche, Spielfeld, Router, Theme
  online/     Online-Modus und Konto-Status (Spitzname, Links zur Konto-Seite)
  shared/     Regeln, Bot, Nickname-Filter (Kopien aus konto/supabase/functions/_shared, synchron halten)
docs/         Architektur und Datenmodell
.github/      Workflow: Pages-Deploy
```

## Weitere Spiele mit demselben Login

Login kommt aus dem SDK `@yezun/konto` (Repo [konto](https://github.com/Yezun-hikari/konto)). Ein Konto gilt für alle Seiten im selben Supabase-Projekt,
die Elo wird pro Spiel gespeichert. Anleitung zum Anbinden: README von konto.
