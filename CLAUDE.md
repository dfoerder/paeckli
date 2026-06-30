# Projektkontext: Weihnachtspäckli-Aktion

## Was ist das?

PWA zur Organisation der Weihnachtspäckli-Aktion einer Kirchgemeinde
(EGW Langenthal). Helfer:innen kaufen Artikel (oft im Sonderangebot), lagern sie
bei sich zu Hause und tragen ihre Käufe in die App ein. Alle sehen den
gemeinsamen Stand: wovon gibt es schon genug, was fehlt noch.

Schwesterprojekt zu `zeit-lernen` (gleiche Stil-Konventionen), aber **mit
Backend**, weil mehrere Personen geteilte Daten brauchen.

## Tech-Stack

- Reines HTML/CSS/JS – kein Framework, kein Bundler, kein Build-Step.
- **Supabase** (Postgres + Auth + Row Level Security) als Backend, Client per CDN.
- **Magic-Link-Login** (passwortlos) via `db.auth.signInWithOtp`.
- **PWA**: `sw.js` (network-first, cacht nur GET), `manifest.json`.

## Dateien

```
paeckli/
├── index.html        # Alle Ansichten, per JS umgeschaltet
├── style.css         # CSS Custom Properties, kein Framework
├── app.js            # Gesamte Logik (Auth, Daten, Render)
├── config.js         # Supabase URL + anon key (gitignored, aus config.example.js)
├── config.example.js # Vorlage
├── schema.sql        # Supabase-Setup: Tabellen, View, RLS, Beispieldaten
├── sw.js             # Service Worker (Cache-Version manuell hochzählen)
├── manifest.json
├── icon-192/512.png  # Geschenk-Icon
├── README.md         # Einrichtungs-Anleitung (Supabase-Setup)
└── img/              # Original-Excel-Liste als Referenz
```

## Datenmodell (Supabase)

| Tabelle | Inhalt |
|---|---|
| `profiles` | Teilnehmende: `name`, `is_admin`. 1:1 mit `auth.users`. |
| `campaign` | Singleton (id=1): `target_adult` (50), `target_kid` (100), `title`. |
| `articles` | `name`, `qty_adult` (pro E-Päckli), `qty_kid` (pro K-Päckli), `donor_note`, `sort_order`. |
| `purchases` | `article_id`, `user_id`, `quantity`, `note`. |
| `article_status` (View) | berechnet `total_needed`, `bought`, `still_needed`. |

**Kernformel:** `total_needed = qty_adult × target_adult + qty_kid × target_kid`,
`still_needed = max(0, total_needed − bought)`.

## Rollen & Sicherheit (RLS)

- Alle Angemeldeten dürfen **lesen** (Transparenz des Bestands).
- Käufe: jede:r legt eigene an / ändert / löscht eigene; Admin darf alle.
- Artikel & Ziele: nur **Admin** (`is_admin = true`) schreiben.
- Admin-Check via `public.is_admin()` (security definer, verhindert RLS-Rekursion).
- Erste:r Admin wird manuell gesetzt (`update profiles set is_admin=true …`).

## Ansichten (`showView(name)`)

`overview` (Einkaufsstand mit Fortschrittsbalken), `buy` (Kauf eintragen),
`mine` (eigene Käufe + löschen), `packages` (Päckli-Zusammensetzung,
abgeleitet aus `qty_adult`/`qty_kid` > 0), `admin` (Artikel- & Ziel-CRUD).

## State-Objekt

```javascript
const state = {
  profile, campaign, articles, status, purchases,
  view: 'overview',   // aktive Ansicht
  pkgKind: 'adult'     // Päckli-Toggle: 'adult' | 'kid'
};
```

## Branches

| Branch | Zweck |
|---|---|
| `main` | Stabiler Stand (später GitHub-Pages-Deployment). |
| `dev`  | Entwicklung. Hier werden Änderungen gemacht und später nach `main` gemergt. |

Merge-Richtung: `dev → main`.

## Konventionen

- Sprache: Code Englisch, UI-Texte Deutsch (Schweizer Schreibweise: „ss" statt „ß").
- Commit-Messages: Deutsch, beschreibend.
- Touch-first: `min-height: 48px`, `touch-action: manipulation`, Safe-Areas.
- HTML-Ausgabe von Benutzerdaten immer durch `esc()`.

## Lokal previewen

Server-Config liegt (wegen Preview-Tooling) in
`../zeit-lernen/.claude/launch.json` als Eintrag `paeckli` (Port 8091),
da die Preview die `launch.json` des primären Projekts liest. Alternativ:
`npx serve . -l 8091`.

## Bekannte offene Punkte

- `config.js` ist gitignored → fürs GitHub-Pages-Deployment entweder mit-committen
  (anon-Key ist öffentlich) oder anders bereitstellen. Siehe README.
- Supabase-Standard-Mailversand ist rate-limitiert; bei vielen Helfer:innen
  eigenen SMTP hinterlegen.
- Echtzeit-Updates (Supabase Realtime) noch nicht aktiviert – aktuell lädt die
  App die Daten bei jedem Ansichtswechsel/Aktion neu.
