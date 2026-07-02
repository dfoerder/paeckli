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
- **E-Mail+Passwort-Login** via `db.auth.signInWithPassword` / `signUp`. „Confirm
  email" ist in Supabase deaktiviert → es wird nie eine Mail verschickt. Passwort-
  Resets laufen ausserhalb der App: Person ruft den Admin an, der das Passwort
  über die Supabase Admin-API (`service_role`-Key) direkt setzt.
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
| `profiles` | Teilnehmende: `first_name`, `last_name`, `contact_email` (= Login-E-Mail, bei Registrierung gesetzt, nicht editierbar), `contact_phone` (optional, editierbar), `is_admin`. 1:1 mit `auth.users`. |
| `campaign` | Singleton (id=1): `title`, `target_date`. |
| `parcels` | Päckli-Typen (vorerst 2): `name` (Erwachsene/Kinder), `abbreviation` (E/K), `number` (Anzahl Päckli), `campaign_id`, `sort_order`. |
| `articles` | `name`, `notes`, `sort_order`. |
| `parcel_content` | Zusammensetzung: `parcel_id`, `article_id`, `quantity` (>0), unique(parcel_id, article_id). |
| `purchases` | `article_id`, `user_id`, `quantity`, `note`. |
| `article_status` (View) | berechnet `total_needed`, `bought`, `still_needed`. |

**Kernformel:** `total_needed = Σ über alle Päckli (parcel_content.quantity × parcels.number)`,
`still_needed = max(0, total_needed − bought)`.

## Rollen & Sicherheit (RLS)

- Alle Angemeldeten dürfen **lesen** (Transparenz des Bestands).
- Käufe: jede:r legt eigene an / ändert / löscht eigene; Admin darf alle.
- Artikel, Päckli, Zusammensetzung & Ziele: nur **Admin** (`is_admin = true`) schreiben.
- Admin-Check via `public.is_admin()` (security definer, verhindert RLS-Rekursion).
- Erste:r Admin wird manuell gesetzt (`update profiles set is_admin=true …`).

## Ansichten (`showView(name)`)

`overview` (Einkaufsstand mit Fortschrittsbalken), `buy` (Kauf eintragen),
`mine` (eigene Käufe + löschen), `profile` (Vorname/Nachname, Kontakt-Telefon,
Passwort ändern; Kontakt-E-Mail nur Anzeige, = Login-E-Mail – erreichbar über
Klick auf den Namen in der Kopfzeile, kein eigener Tab), `packages`
(Päckli-Zusammensetzung je `parcel` aus `parcel_content`, Toggle dynamisch je
Päckli-Typ), `admin` (Ziele; darunter
„Alle Käufe (nach Käufer:in)" – nur für Admin, alle Käufe gruppiert nach
Käufer:in inkl. Kontaktangabe für Rückfragen; darunter dieselbe
Päckli-Darstellung wie `packages`, aber editierbar: Menge/Name/Notiz ändern,
„Aus Päckli entfernen" = nur `parcel_content`-Zeile, „Artikel löschen" =
ganzer Artikel; unten neuer Artikel fürs gewählte Päckli, Reuse-by-Name).

## State-Objekt

```javascript
const state = {
  profile, campaign, parcels, articles, content, status, purchases,
  view: 'overview',   // aktive Ansicht
  pkgParcel: null      // id des in der Päckli-Ansicht gewählten Päckli-Typs
};
```

## Branches

| Branch | Zweck |
|---|---|
| `main` | Stabiler Stand (später GitHub-Pages-Deployment). |
| `dev`  | Entwicklung. Hier werden Änderungen gemacht und später nach `main` gemergt. |

Merge-Richtung: `dev → main`.

## Deployment-Workflow

Es wird **nur `main`** deployed. Vor einem Deployment immer:

1. `dev` nach `main` mergen.
2. `main` auf GitHub deployen (GitHub Pages).
3. `dev` wieder zum aktuellen Branch machen.

```bash
git checkout main && git merge dev   # 1. mergen
git push origin main                 # 2. deployen (GitHub Pages)
git checkout dev                     # 3. zurück auf dev
```

Entwickelt und getestet wird also immer auf `dev`; `main` bekommt nur fertige,
deploybare Stände.

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
- Da nie E-Mails verschickt werden, wird auch keine Adresse verifiziert – jede:r
  kann sich mit einer beliebigen E-Mail registrieren. Für den bekannten,
  überschaubaren Helferkreis bewusst in Kauf genommen.
- `service_role`-Key (für Passwort-Resets) liegt nur lokal beim Admin, niemals
  im Repo oder in `config.js`.
- Echtzeit-Updates (Supabase Realtime) noch nicht aktiviert – aktuell lädt die
  App die Daten bei jedem Ansichtswechsel/Aktion neu.
