# XOX – 4x4 Tic-Tac-Toe

Eine moderne Variante von Tic-Tac-Toe auf einem 4x4-Feld mit Eis-Mechanik, Online-Matchmaking, Elo-Wertung und optionalem Konto.
Läuft komplett im Browser (GitHub Pages), das Online-Backend liegt bei Supabase.

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
- **Elo-Wertung** wie im Schach (Start 1000, K = 32), serverseitig berechnet und nicht manipulierbar durch den Client.
- **Nickname** mit Schimpfwort-Filter (Deutsch und Englisch, erkennt Leetspeak und Umlaute).
- **Gast oder Konto:** Gäste spielen sofort. Wer sich mit Benutzername und Passwort registriert, behält seine Elo.
  Es wird keine E-Mail-Adresse gespeichert.
- Modernes, mobilfreundliches Design, Dark Mode (automatisch oder manuell), Tastatursteuerung, Screenreader-Hinweise, Favicon und Web-App-Manifest.

## Technik

| Bereich | Umsetzung |
|---|---|
| Frontend | Vite, TypeScript, kein Framework |
| Hosting | GitHub Pages, Deployment per GitHub Action |
| Backend | Supabase (Auth, Postgres mit Row Level Security, Realtime, Edge Functions) |
| Spielregeln | Eine gemeinsame Datei für Browser und Server: [`supabase/functions/_shared/rules.ts`](supabase/functions/_shared/rules.ts) |
| Tests | Vitest (Regeln, Nickname-Filter) |

Der Server ist maßgeblich: Züge und Elo werden nur in Edge Functions geprüft und berechnet. Details stehen in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Datenschutz und Sicherheit

- Nutzerdaten liegen nur in Supabase, nie im Repository oder auf der öffentlichen Seite.
- Row Level Security auf allen Tabellen. Clients haben nur Leserechte auf **eigene** Daten. Alle Schreibzugriffe laufen über Edge Functions.
- Im Browser stehen nur die öffentliche Projekt-URL und der „publishable“ Key. Geheime Schlüssel gehören nie ins Repo.
- Die Datenbank lehnt echte E-Mail-Adressen ab (nur künstliche Adressen für den Login-Namen).
- Konto löschen entfernt alle zugehörigen Daten. Inaktive Gastkonten werden nach 30 Tagen automatisch gelöscht.
- Bekannte Grenzen: kein Passwort-Reset (bewusst, es gibt keine E-Mail), und alle Spiele unter `yezun.de`
  teilen sich den Browser-Speicher der Sitzung, deshalb muss jedes dieser Spiele frei von XSS sein.
  Mehr dazu in [`src/auth/README.md`](src/auth/README.md).

## Lokal entwickeln

Voraussetzung: Node.js 22 oder neuer.

```sh
npm ci
npm run dev        # Entwicklungsserver (lokaler Modus funktioniert ohne Backend)
npm test           # Tests
npm run build      # Typprüfung und Produktions-Build
```

Für den Online-Modus lokal wird Docker Desktop benötigt, siehe [`supabase/README.md`](supabase/README.md).

## Eigenes Backend einrichten

Die komplette Schritt-für-Schritt-Anleitung (Supabase-Projekt, Dashboard-Einstellungen, GitHub-Secrets und -Variables)
steht in [`supabase/README.md`](supabase/README.md).

Kurzfassung der nötigen GitHub-Einstellungen:

- **Secrets:** `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`
- **Variables:** `SUPABASE_PROJECT_REF`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- **Pages:** Settings → Pages → Source: GitHub Actions

## Projektstruktur

```
src/
  ui/         Oberfläche, Spielfeld, Router, Theme
  online/     Online-Modus und Kontoseite
  auth/       Wiederverwendbares Login-Modul für weitere Minispiele
supabase/
  migrations/ Datenbankschema, Sicherheitsregeln, Elo-Funktionen
  functions/  Edge Functions: matchmake, move, resign, claim-timeout, set-nickname, delete-account
    _shared/  Code, den auch das Frontend nutzt (rules.ts, profanity.ts)
docs/         Architektur und Datenmodell
.github/      Workflows: Pages-Deploy, Supabase-Deploy, Keepalive
```

## Weitere Spiele mit demselben Login

Das Modul in [`src/auth/`](src/auth/) ist unabhängig vom Spiel. Ein Konto gilt für alle Spiele im selben Supabase-Projekt,
die Elo wird pro Spiel gespeichert. Anleitung: [`src/auth/README.md`](src/auth/README.md).
