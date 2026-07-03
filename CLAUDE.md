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
| `campaigns` | **Mehrzeilig** (nicht mehr Singleton!): eine Zeile pro Sammlung (z.B. ein Jahr): `title`, `target_date`, `created_at`. Die **aktive** Sammlung = die mit dem neuesten `created_at` (`state.campaigns[0]`, absteigend sortiert geladen). Ältere Sammlungen bleiben in der Datenbank und über den Umschalter in Admin > Sammlungen einsehbar/editierbar. |
| `parcels` | Päckli-Typen (vorerst 2 pro Sammlung): `name` (Erwachsene/Kinder), `abbreviation` (E/K), `number` (Anzahl Päckli), `campaign_id` (→ `campaigns`, `on delete cascade`). Keine feste Reihenfolge. |
| `articles` | `name`, `notes`, `category` (fixe Auswahl, Dropdown im Admin: Esswaren/Hygiene/Kleidung/Schreibwaren/Spielzeug/Sonstiges; `check`-Constraint + Default `'Sonstiges'`). **Global**, nicht an eine Sammlung gebunden – dieselben Artikel werden über Sammlungen hinweg wiederverwendet. Anzeige-Reihenfolge alphabetisch nach `name`. |
| `parcel_content` | Zusammensetzung: `parcel_id`, `article_id`, `quantity` (>0), unique(parcel_id, article_id). |
| `purchases` | `article_id`, `campaign_id` (→ `campaigns`, `on delete restrict`), `user_id`, `quantity`, `shop` (Dropdown + Freitext „Anderer Shop…", optional), `donor` (Spender:in-Name, optional), `note`. Jeder Kauf gehört zu **genau einer** Sammlung, damit eine neue Sammlung beim Fortschritt bei 0 startet. |
| `article_status` (View) | Eine Zeile pro (Artikel, Sammlung) mit `campaign_id`-Spalte; `total_needed`/`bought`/`still_needed` nur innerhalb derselben Sammlung berechnet. App filtert immer zusätzlich `.eq('campaign_id', state.campaign.id)`. |
| `article_purchase_totals` (View) | Käufe je Artikel über **alle Sammlungen hinweg** (`id`, `bought`). Nur für die Löschregeln relevant – der FK `on delete restrict` auf `purchases.article_id` kennt keine Sammlungsgrenzen. |

**Kernformel:** `total_needed = Σ über alle Päckli DERSELBEN Sammlung (parcel_content.quantity × parcels.number)`,
`still_needed = max(0, total_needed − bought)`.

## Rollen & Sicherheit (RLS)

- Alle Angemeldeten dürfen **lesen** (Transparenz des Bestands).
- Käufe: jede:r legt eigene an / ändert / löscht eigene; Admin darf alle.
- Artikel, Päckli, Zusammensetzung & Sammlungen: nur **Admin** (`is_admin = true`) schreiben
  (inkl. neue Sammlung anlegen, `campaigns_insert`-Policy).
- Admin-Check via `public.is_admin()` (security definer, verhindert RLS-Rekursion).
- Erste:r Admin wird manuell gesetzt (`update profiles set is_admin=true …`).
- **Löschregeln** (FK `on delete restrict` auf `article_id`, sowohl bei
  `parcel_content` als auch bei `purchases`): Artikel sind nur löschbar, wenn
  sie in keinem Päckli mehr enthalten sind **und** über alle Sammlungen hinweg
  nie gekauft wurden (`article_purchase_totals`). Die App prüft das vorab für
  verständliche Meldungen; die DB erzwingt es.
- **Spaltenrechte auf `profiles`**: `insert`/`update` für `authenticated` sind
  auf harmlose Spalten begrenzt (`is_admin` und `contact_email` nicht selbst
  änderbar – RLS allein prüft nur Zeilen, nicht Spalten).

## Ansichten (`showView(name)`)

`overview` (Einkaufsstand mit Fortschrittsbalken), `mine` (Tab „Deine Käufe":
oben Kauf eintragen, darunter eigene Käufe + löschen), `profile`
(Vorname/Nachname, Kontakt-Telefon, Passwort ändern; Kontakt-E-Mail nur
Anzeige, = Login-E-Mail – erreichbar über Klick auf den Namen in der
Kopfzeile, kein eigener Tab), `packages`
(Päckli-Zusammensetzung je `parcel` aus `parcel_content`, Toggle dynamisch je
Päckli-Typ), `admin` (nur für Admin; interne Unterseiten via
`state.adminPage` + 4 Buttons oben, jeweils nur eine sichtbar: **Sammlungen**
(intern weiterhin `adminPage: 'goals'`/`#admin-page-goals`; Umschalter über
alle `state.campaigns` (neueste zuerst, aktive markiert „(aktuell)"), zeigt/
editiert Titel, Stichtag und Päckli-Ziele der über `state.viewedCampaignId`
gewählten Sammlung – muss nicht die aktive sein, ältere bleiben einsehbar
(`loadViewedCampaignParcels()` lädt bei Bedarf deren Päckli-Typen separat
nach, da `state.parcels` immer nur die AKTIVE Sammlung enthält); unten
„Neue Sammlung": Titel + Checkbox „Päckli-Zusammensetzung übernehmen"
(`createCampaign()` → `copyParcelsToNewCampaign()` dupliziert `parcels` +
`parcel_content` der bisher aktiven Sammlung, Artikel bleiben dieselben).
Eine neu angelegte Sammlung wird automatisch zur aktiven, da „aktiv" = die
zuletzt erstellte Sammlung ist), **Alle Käufe** (nur der aktiven Sammlung,
gruppiert nach Käufer:in inkl. Kontaktangabe für Rückfragen), **Artikel** (alle Artikel
unabhängig von Päckli-Zuordnung; zwei Modi via `state.articleEditId`: Liste
nach `category` gruppiert mit „Ändern"-Knopf je Artikel, oder Änderungsansicht
für einen Artikel — Name/Kategorie/Notiz ändern, endgültig löschen, gesperrt
solange in einem Päckli enthalten oder schon gekauft, siehe Löschregeln;
„Neuer Artikel" nur im Listen-Modus sichtbar, legt Artikel ohne Päckli-
Zuordnung an), **Päckli-Inhalt**
(dieselbe Päckli-Darstellung wie `packages`, aber editierbar: Menge/Name/
Notiz/Kategorie ändern, „Aus Päckli entfernen" = nur `parcel_content`-Zeile;
unten Artikel zum gewählten Päckli hinzufügen, Reuse-by-Name)). Übersicht
(`overview`) gruppiert die Artikel nach `category` (feste Reihenfolge:
Esswaren, Hygiene, Kleidung, Schreibwaren, Spielzeug, Sonstiges).

## State-Objekt

```javascript
const state = {
  profile,
  campaigns,          // alle Sammlungen, neueste zuerst
  campaign,           // AKTIVE Sammlung = campaigns[0]
  viewedCampaignId,    // Admin > Sammlungen: betrachtete Sammlung (Historie)
  viewedParcels,       // Päckli-Typen der betrachteten Sammlung
  parcels,             // Päckli-Typen der AKTIVEN Sammlung
  articles,            // global, sammlungsübergreifend
  content, status,     // status = article_status, gefiltert auf aktive Sammlung
  purchaseTotals,      // article_purchase_totals: Käufe je Artikel, alle Sammlungen (Löschregeln)
  purchases,           // eigene Käufe der AKTIVEN Sammlung
  view: 'overview',    // aktive Ansicht
  pkgParcel: null      // id des in der Päckli-Ansicht gewählten Päckli-Typs
};
```

## App-Version

Statische Fusszeile (`#app-footer` in `index.html`, letztes Element in `#app`,
immer sichtbar, unabhängig von der aktiven Ansicht) zeigt Versionskürzel +
Erscheinungsdatum, Format `v<major>.<minor>b` (z.B. „v1.1b · 3. Juli 2026"):
`minor` bei jedem Feature-Deployment hochzählen, `major` nur bei grösseren
Meilensteinen. Kein Build-Step, daher von Hand gepflegt: **vor jedem
Deployment nach `main`** zusammen mit der `sw.js`-Cache-Version
(`CACHE_NAME`) hochzählen/aktualisieren – **nicht vergessen** (ist in der
Vergangenheit schon passiert).

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
