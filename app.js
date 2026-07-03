'use strict';

/* ============================================================
 *  Weihnachtspäckli-Aktion – App-Logik
 *  Vanilla JS, kein Build-Step. Backend: Supabase.
 * ============================================================ */

// ---------- Supabase-Client ----------
const cfg = window.APP_CONFIG || {};
const configured =
  cfg.SUPABASE_URL &&
  cfg.SUPABASE_ANON_KEY &&
  !cfg.SUPABASE_URL.includes('DEIN-PROJEKT');

let db = null;
if (configured && window.supabase) {
  db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
}

// Feste Artikel-Kategorien (Dropdown im Admin), zugleich Gruppierungs-Reihenfolge
// in der Übersicht. Muss mit dem check-Constraint auf articles.category übereinstimmen.
const CATEGORIES = ['Esswaren', 'Hygiene', 'Kleidung', 'Schreibwaren', 'Spielzeug', 'Sonstiges'];

// ---------- Zustand ----------
const state = {
  profile: null,      // { id, first_name, last_name, contact_email, contact_phone, is_admin }
  campaign: null,     // { title, target_date }
  parcels: [],        // [{ id, name, abbreviation, number }]
  articles: [],       // [{ id, name, notes, category }]
  content: [],        // parcel_content: [{ parcel_id, article_id, quantity }]
  status: [],         // aus View article_status
  purchases: [],      // eigene Käufe (mit Artikelname)
  allPurchases: [],   // alle Käufe (nur Admin; mit Artikel- und Käufer:in-Name)
  view: 'overview',
  pkgParcel: null,    // id des in der Päckli-Ansicht gewählten Päckli-Typs
  adminParcel: null,  // id des im Admin gewählten Päckli-Typs (unabhängig)
  adminPage: 'goals', // aktive Unterseite im Admin-Tab: goals | purchases | articles | content
  articleEditId: null // Artikel-Seite: id des Artikels in der Änderungsansicht (null = Liste)
};

// Menge eines Artikels in einem bestimmten Päckli-Typ (0, falls nicht enthalten).
function contentQty(parcelId, articleId) {
  const row = state.content.find(
    (c) => c.parcel_id === parcelId && c.article_id === articleId);
  return row ? row.quantity : 0;
}

// ---------- Kurzhelfer ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fullName = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(' ');

function show(id) { el(id)?.classList.remove('hidden'); }
function hide(id) { el(id)?.classList.add('hidden'); }

function showView(name) {
  state.view = name;
  $$('.view').forEach((v) => v.classList.add('hidden'));
  show('view-' + name);
  $$('#tabs .tab').forEach((t) =>
    t.classList.toggle('active', t.dataset.view === name));
  if (name === 'overview') renderOverview();
  if (name === 'mine') { renderBuyOptions(); renderMine(); }
  if (name === 'packages') renderPackages();
  if (name === 'admin') renderAdmin();
  if (name === 'profile') renderProfile();
}

// ============================================================
//  Auth-Fluss
// ============================================================
async function init() {
  if (!configured || !db) {
    show('config-warning');
    return;
  }

  // Reagiert auf Login/Logout.
  db.auth.onAuthStateChange((_event, session) => {
    handleSession(session);
  });

  const { data } = await db.auth.getSession();
  handleSession(data.session);
}

async function handleSession(session) {
  if (!session) {
    showLoggedOut();
    return;
  }
  // Profil laden – oder Onboarding, falls noch keins existiert.
  const { data: profile } = await db
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .maybeSingle();

  if (!profile) {
    hideAll();
    show('view-onboard');
    el('onboard-first-name').focus();
    return;
  }

  state.profile = profile;
  await loadData();
  showLoggedIn();
}

function hideAll() {
  hide('view-login');
  hide('view-onboard');
  hide('tabs');
  $$('.view').forEach((v) => v.classList.add('hidden'));
  hide('user-bar');
}

function showLoggedOut() {
  state.profile = null;
  hideAll();
  show('view-login');
}

function showLoggedIn() {
  hideAll();
  el('user-name').textContent = fullName(state.profile);
  show('user-bar');
  show('tabs');
  $$('.admin-only').forEach((e) =>
    e.classList.toggle('hidden', !state.profile.is_admin));
  showView('overview');
}

// ---------- Login per E-Mail + Passwort ----------
function loginFields() {
  const email = el('login-email').value.trim();
  const password = el('login-password').value;
  const msg = el('login-msg');
  if (!email || !password) { msg.textContent = 'Bitte E-Mail und Passwort eingeben.'; return null; }
  return { email, password, msg };
}

async function login() {
  const fields = loginFields();
  if (!fields) return;
  const { email, password, msg } = fields;

  el('login-btn').disabled = true;
  el('register-btn').disabled = true;
  msg.className = 'muted';
  msg.textContent = 'Melde an …';

  const { error } = await db.auth.signInWithPassword({ email, password });

  el('login-btn').disabled = false;
  el('register-btn').disabled = false;
  if (error) {
    msg.className = 'muted err';
    msg.textContent = 'Fehler: ' + error.message;
  } else {
    msg.textContent = '';
  }
}

async function register() {
  const fields = loginFields();
  if (!fields) return;
  const { email, password, msg } = fields;

  el('login-btn').disabled = true;
  el('register-btn').disabled = true;
  msg.className = 'muted';
  msg.textContent = 'Registriere …';

  const { error } = await db.auth.signUp({ email, password });

  el('login-btn').disabled = false;
  el('register-btn').disabled = false;
  if (error) {
    msg.className = 'muted err';
    msg.textContent = 'Fehler: ' + error.message;
  } else {
    msg.textContent = '';
  }
}

// ---------- Erstanmeldung: Name speichern ----------
async function saveOnboard() {
  const first_name = el('onboard-first-name').value.trim();
  const last_name = el('onboard-last-name').value.trim();
  const msg = el('onboard-msg');
  if (!first_name || !last_name) { msg.textContent = 'Bitte Vor- und Nachnamen eingeben.'; return; }

  const { data: { user } } = await db.auth.getUser();
  el('onboard-btn').disabled = true;

  // Kontakt-E-Mail = Login-E-Mail, fest und unveränderbar (kein separates Feld nötig).
  const { data, error } = await db
    .from('profiles')
    .insert({ id: user.id, first_name, last_name, contact_email: user.email })
    .select()
    .single();

  el('onboard-btn').disabled = false;
  if (error) {
    msg.className = 'muted err';
    msg.textContent = 'Fehler: ' + error.message;
    return;
  }
  state.profile = data;
  await loadData();
  showLoggedIn();
}

async function logout() {
  await db.auth.signOut();
  showLoggedOut();
}

// ============================================================
//  Daten laden
// ============================================================
async function loadData() {
  const [campaign, parcels, articles, content, status, purchases] = await Promise.all([
    db.from('campaign').select('*').eq('id', 1).single(),
    db.from('parcels').select('*'),
    db.from('articles').select('*').order('name'),
    db.from('parcel_content').select('*'),
    db.from('article_status').select('*').order('name'),
    db.from('purchases')
      .select('*, articles(name)')
      .eq('user_id', state.profile.id)
      .order('created_at', { ascending: false })
  ]);
  // Query-Fehler sichtbar machen (sonst still als leere Liste verschluckt).
  const results = { campaign, parcels, articles, content, status, purchases };
  for (const [key, res] of Object.entries(results)) {
    if (res.error) console.error(`loadData: ${key} ->`, res.error);
  }

  state.campaign = campaign.data || {};
  state.parcels = parcels.data || [];
  state.articles = articles.data || [];
  state.content = content.data || [];
  state.status = status.data || [];
  state.purchases = purchases.data || [];

  // Admin: zusätzlich alle Käufe laden (mit Käufer:in-Name), nach Käufer:in sortiert,
  // damit man bei Rückfragen Kontakt aufnehmen kann.
  if (state.profile.is_admin) {
    const all = await db.from('purchases')
      .select('*, articles(name), profiles(first_name, last_name, contact_email, contact_phone)')
      .order('created_at', { ascending: false });
    if (all.error) console.error('loadData: allPurchases ->', all.error);
    state.allPurchases = (all.data || []).sort((a, b) =>
      fullName(a.profiles).localeCompare(fullName(b.profiles), 'de-CH'));
  } else {
    state.allPurchases = [];
  }

  // gewähltes Päckli (Päckli-Ansicht & Admin) initialisieren / gültig halten.
  if (!state.parcels.some((p) => p.id === state.pkgParcel)) {
    state.pkgParcel = state.parcels[0]?.id || null;
  }
  if (!state.parcels.some((p) => p.id === state.adminParcel)) {
    state.adminParcel = state.parcels[0]?.id || null;
  }
}

async function reload() {
  await loadData();
  showView(state.view);
}

// ============================================================
//  Ansicht: Übersicht (Einkaufsstand)
// ============================================================
function deadlineBanner() {
  const d = state.campaign.target_date;
  if (!d) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(d + 'T00:00:00');
  const days = Math.round((target - today) / 86400000);
  const ds = target.toLocaleDateString('de-CH', { day: 'numeric', month: 'long', year: 'numeric' });
  let txt, cls;
  if (days > 0) { txt = `Noch ${days} Tag${days === 1 ? '' : 'e'} bis ${ds}`; cls = 'ok'; }
  else if (days === 0) { txt = `Stichtag ist heute (${ds})!`; cls = 'need'; }
  else { txt = `Stichtag ${ds} überschritten`; cls = 'need'; }
  return `<div class="deadline ${cls}">⏰ ${txt}</div>`;
}

function renderOverview() {
  const list = state.status;
  const totalNeeded = list.reduce((s, a) => s + a.total_needed, 0);
  const totalBought = list.reduce((s, a) => s + Math.min(a.bought, a.total_needed), 0);
  const complete = list.filter((a) => a.total_needed > 0 && a.bought >= a.total_needed).length;
  const counted = list.filter((a) => a.total_needed > 0).length;
  const pct = totalNeeded ? Math.round((totalBought / totalNeeded) * 100) : 0;

  const goalNum = state.parcels.map((p) => p.number).join('+') || '–';
  const goalLbl = state.parcels.map((p) => esc(p.abbreviation)).join('+');

  el('campaign-summary').innerHTML = `
    <div class="stat"><div class="num">${pct}%</div><div class="lbl">gesamt</div></div>
    <div class="stat"><div class="num">${complete}/${counted}</div><div class="lbl">Artikel komplett</div></div>
    <div class="stat"><div class="num">${goalNum}</div><div class="lbl">Päckli-Ziel${goalLbl ? ' (' + goalLbl + ')' : ''}</div></div>
  `;

  const banner = deadlineBanner();

  // Nur Artikel zeigen, die aktuell in mindestens einem Päckli enthalten sind –
  // sonst tauchen z.B. aus einem Päckli entfernte Artikel mit 0/0 auf.
  const visible = list.filter((a) => a.total_needed > 0);

  if (!visible.length) {
    el('overview-list').innerHTML = banner + '<p class="empty">Noch keine Artikel angelegt.</p>';
    return;
  }

  // Nach Kategorie gruppiert (feste Reihenfolge aus CATEGORIES), damit die
  // lange Artikelliste übersichtlicher bleibt.
  const groups = CATEGORIES
    .map((cat) => ({ cat, items: visible.filter((a) => a.category === cat) }))
    .filter((g) => g.items.length);

  el('overview-list').innerHTML = banner + groups.map((g) => `
    <h3 class="category-heading">${esc(g.cat)}</h3>
    ${g.items.map((a) => {
      const done = a.total_needed > 0 && a.bought >= a.total_needed;
      const pctItem = a.total_needed ? Math.min(100, Math.round((a.bought / a.total_needed) * 100)) : 100;
      const pill = done
        ? '<span class="pill ok">genug</span>'
        : `<span class="pill need">noch ${a.still_needed}</span>`;
      return `
        <div class="item ${done ? 'complete' : 'missing'}">
          <div class="head">
            <span class="name">${esc(a.name)}</span>
            <span class="count"><span class="${done ? 'done' : ''}">${a.bought}</span> / ${a.total_needed}</span>
          </div>
          <div class="bar"><span style="width:${pctItem}%"></span></div>
          <div class="sub">${pill}${a.notes ? ' · ' + esc(a.notes) : ''}</div>
        </div>`;
    }).join('')}`).join('');
}

// ============================================================
//  Ansicht: Kauf eintragen
// ============================================================
function renderBuyOptions() {
  el('buy-article').innerHTML = state.articles
    .map((a) => `<option value="${a.id}">${esc(a.name)}</option>`)
    .join('');
}

// Shop-Dropdown: bei "Anderer Shop…" das Freitextfeld einblenden.
function onBuyShopChange() {
  const isOther = el('buy-shop').value === '__other__';
  el('buy-shop-other').classList.toggle('hidden', !isOther);
  if (isOther) el('buy-shop-other').focus();
}

async function submitBuy() {
  const article_id = el('buy-article').value;
  const quantity = parseInt(el('buy-qty').value, 10);
  const shop = el('buy-shop').value === '__other__'
    ? el('buy-shop-other').value.trim() || null
    : el('buy-shop').value || null;
  const donor = el('buy-donor').value.trim() || null;
  const note = el('buy-note').value.trim() || null;
  const msg = el('buy-msg');

  if (!article_id) { msg.textContent = 'Bitte Artikel wählen.'; return; }
  if (!quantity || quantity < 1) { msg.className = 'muted err'; msg.textContent = 'Anzahl muss mindestens 1 sein.'; return; }

  el('buy-btn').disabled = true;
  const { error } = await db.from('purchases').insert({
    article_id, quantity, shop, donor, note, user_id: state.profile.id
  });
  el('buy-btn').disabled = false;

  if (error) {
    msg.className = 'muted err';
    msg.textContent = 'Fehler: ' + error.message;
    return;
  }
  msg.className = 'muted ok';
  msg.textContent = 'Eingetragen ✓';
  el('buy-qty').value = '1';
  el('buy-shop').value = '';
  el('buy-shop-other').value = '';
  el('buy-shop-other').classList.add('hidden');
  el('buy-donor').value = '';
  el('buy-note').value = '';
  await loadData();
  renderMine();
}

// ============================================================
//  Ansicht: Meine Käufe
// ============================================================
// Zweite Zeile eines Kauf-Eintrags: Datum, Shop, Spender:in, Notiz.
function purchaseSub(p) {
  const parts = [new Date(p.created_at).toLocaleDateString('de-CH')];
  if (p.shop) parts.push('🏬 ' + esc(p.shop));
  if (p.donor) parts.push('🎁 ' + esc(p.donor));
  if (p.note) parts.push(esc(p.note));
  return parts.join(' · ');
}

function renderMine() {
  if (!state.purchases.length) {
    el('mine-list').innerHTML = '<p class="empty">Du hast noch nichts eingetragen.</p>';
    return;
  }
  el('mine-list').innerHTML = state.purchases.map((p) => `
      <div class="item">
        <div class="head">
          <span class="name">${esc(p.articles?.name || 'Artikel')}</span>
          <span class="count">${p.quantity} Stk.</span>
        </div>
        <div class="sub">${purchaseSub(p)}</div>
        <div class="row-actions">
          <button class="ghost" data-del="${p.id}">Löschen</button>
        </div>
      </div>`).join('');

  $$('#mine-list [data-del]').forEach((b) =>
    b.addEventListener('click', () => deletePurchase(b.dataset.del)));
}

// Admin: alle Käufe, nach Käufer:in gruppiert (state.allPurchases ist bereits
// nach Käufer:in-Name sortiert), damit man bei Bedarf Kontakt aufnehmen kann.
function renderAllPurchases() {
  const box = el('admin-all-list');
  if (!state.allPurchases.length) {
    box.innerHTML = '<p class="empty">Noch keine Käufe erfasst.</p>';
    return;
  }

  // Nach Käufer:in gruppieren (Reihenfolge aus der bereits sortierten Liste).
  const groups = [];
  for (const p of state.allPurchases) {
    const name = fullName(p.profiles) || 'Unbekannt';
    let g = groups.find((x) => x.name === name);
    if (!g) {
      g = {
        name,
        contactEmail: p.profiles?.contact_email || null,
        contactPhone: p.profiles?.contact_phone || null,
        items: []
      };
      groups.push(g);
    }
    g.items.push(p);
  }

  box.innerHTML = groups.map((g) => `
    <div class="buyer-group">
      <h3 class="buyer-name">${esc(g.name)} <span class="muted">(${g.items.length})</span></h3>
      ${g.contactEmail ? `<p class="buyer-contact">📧 ${esc(g.contactEmail)}</p>` : ''}
      ${g.contactPhone ? `<p class="buyer-contact">📞 ${esc(g.contactPhone)}</p>` : ''}
      ${g.items.map((p) => {
        return `
          <div class="item">
            <div class="head">
              <span class="name">${esc(p.articles?.name || 'Artikel')}</span>
              <span class="count">${p.quantity} Stk.</span>
            </div>
            <div class="sub">${purchaseSub(p)}</div>
          </div>`;
      }).join('')}
    </div>`).join('');
}

async function deletePurchase(id) {
  if (!confirm('Diesen Kauf löschen?')) return;
  const { error } = await db.from('purchases').delete().eq('id', id);
  if (error) { alert('Fehler: ' + error.message); return; }
  await reload();
}

// ============================================================
//  Ansicht: Profil
// ============================================================
function renderProfile() {
  el('profile-first-name').value = state.profile.first_name || '';
  el('profile-last-name').value = state.profile.last_name || '';
  el('profile-email').value = state.profile.contact_email || '';
  el('profile-phone').value = state.profile.contact_phone || '';
  el('profile-msg').textContent = '';
  el('profile-password').value = '';
  el('profile-password2').value = '';
  el('profile-password-msg').textContent = '';
}

async function saveProfile() {
  const first_name = el('profile-first-name').value.trim();
  const last_name = el('profile-last-name').value.trim();
  const contact_phone = el('profile-phone').value.trim() || null;
  const msg = el('profile-msg');
  if (!first_name || !last_name) {
    msg.className = 'muted err';
    msg.textContent = 'Bitte Vor- und Nachnamen eingeben.';
    return;
  }

  // contact_email bleibt unangetastet (= Login-E-Mail, unveränderbar).
  el('profile-btn').disabled = true;
  const { data, error } = await db.from('profiles')
    .update({ first_name, last_name, contact_phone })
    .eq('id', state.profile.id)
    .select()
    .single();
  el('profile-btn').disabled = false;

  if (error) { msg.className = 'muted err'; msg.textContent = 'Fehler: ' + error.message; return; }
  state.profile = data;
  el('user-name').textContent = fullName(state.profile);
  msg.className = 'muted ok';
  msg.textContent = 'Gespeichert ✓';
}

// Passwort selbst ändern (kein Mailversand, direkt via Supabase-Session).
async function changePassword() {
  const password = el('profile-password').value;
  const password2 = el('profile-password2').value;
  const msg = el('profile-password-msg');
  if (!password || password.length < 6) {
    msg.className = 'muted err';
    msg.textContent = 'Passwort muss mind. 6 Zeichen haben.';
    return;
  }
  if (password !== password2) {
    msg.className = 'muted err';
    msg.textContent = 'Passwörter stimmen nicht überein.';
    return;
  }

  el('profile-password-btn').disabled = true;
  const { error } = await db.auth.updateUser({ password });
  el('profile-password-btn').disabled = false;

  if (error) { msg.className = 'muted err'; msg.textContent = 'Fehler: ' + error.message; return; }
  el('profile-password').value = '';
  el('profile-password2').value = '';
  msg.className = 'muted ok';
  msg.textContent = 'Passwort geändert ✓';
}

// ============================================================
//  Ansicht: Päckli-Zusammensetzung
// ============================================================
function setPkgParcel(id) {
  state.pkgParcel = id;
  renderPackages();
}

function renderPackages() {
  // Toggle-Buttons je Päckli-Typ.
  el('pkg-toggle').innerHTML = state.parcels.map((p) => `
    <button class="pkg-btn ${p.id === state.pkgParcel ? 'active' : ''}" data-parcel="${p.id}">
      ${esc(p.name)}
    </button>`).join('');
  $$('#pkg-toggle .pkg-btn').forEach((b) =>
    b.addEventListener('click', () => setPkgParcel(b.dataset.parcel)));

  const parcel = state.parcels.find((p) => p.id === state.pkgParcel);
  if (!parcel) {
    el('packages-list').innerHTML = '<p class="empty">Noch keine Päckli-Typen angelegt.</p>';
    return;
  }

  // Inhalt des gewählten Päcklis: alle parcel_content-Einträge, Artikelname über Lookup.
  const items = state.content
    .filter((c) => c.parcel_id === parcel.id)
    .map((c) => ({ article: state.articles.find((a) => a.id === c.article_id), qty: c.quantity }))
    .filter((x) => x.article)
    .sort((a, b) => a.article.name.localeCompare(b.article.name, 'de-CH'));

  if (!items.length) {
    el('packages-list').innerHTML = '<p class="empty">Keine Artikel zugeordnet.</p>';
    return;
  }
  el('packages-list').innerHTML = `
    <p class="muted" style="margin:0 4px 10px">Inhalt eines Päcklis · Ziel: ${parcel.number} ${esc(parcel.name)}</p>
    ${items.map((x) => `
      <div class="item">
        <div class="head">
          <span class="name">${esc(x.article.name)}</span>
          <span class="count">${x.qty}×</span>
        </div>
      </div>`).join('')}`;
}

// ============================================================
//  Ansicht: Admin
// ============================================================
function renderAdmin() {
  // Ziele: ein Anzahl-Feld je Päckli-Typ.
  el('goal-parcels').innerHTML = state.parcels.map((p) => `
    <label>${esc(p.name)} (${esc(p.abbreviation)})</label>
    <input type="number" min="0" step="1" inputmode="numeric"
           data-parcel-goal="${p.id}" value="${p.number}">`).join('');
  el('goal-date').value = state.campaign.target_date || '';
  const ds = state.campaign.target_date
    ? new Date(state.campaign.target_date + 'T00:00:00')
        .toLocaleDateString('de-CH', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  el('goal-heading').textContent = ds ? `Ziele ${ds}` : 'Ziele';

  renderAllPurchases();
  renderAdminArticles();
  renderAdminContent();

  // Sub-Navigation: nur die gewählte Admin-Unterseite anzeigen.
  $$('#admin-nav .pkg-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.adminPage === state.adminPage));
  $$('.admin-page').forEach((p) =>
    p.classList.toggle('hidden', p.id !== 'admin-page-' + state.adminPage));
}

function setAdminPage(page) {
  state.adminPage = page;
  state.articleEditId = null; // beim Wechsel der Unterseite zurück zur Artikel-Liste
  renderAdmin();
}

function setAdminParcel(id) {
  state.adminParcel = id;
  renderAdminContent();   // nur Inhalt neu rendern (Ziel-Eingaben bleiben erhalten)
}

// Editierbare Päckli-Ansicht im Admin: Umschalter + Artikel des gewählten Päcklis.
function renderAdminContent() {
  // Umschalter je Päckli-Typ (gleiche Optik wie Päckli-Tab).
  el('admin-pkg-toggle').innerHTML = state.parcels.map((p) => `
    <button class="pkg-btn ${p.id === state.adminParcel ? 'active' : ''}" data-parcel="${p.id}">
      ${esc(p.name)}
    </button>`).join('');
  $$('#admin-pkg-toggle .pkg-btn').forEach((b) =>
    b.addEventListener('click', () => setAdminParcel(b.dataset.parcel)));

  const parcel = state.parcels.find((p) => p.id === state.adminParcel);
  el('new-hint').textContent = parcel ? `Neuer Artikel für: ${parcel.name}` : '';

  if (!parcel) {
    el('admin-content').innerHTML = '<p class="empty">Noch keine Päckli-Typen angelegt.</p>';
    return;
  }

  // Artikel mit Eintrag im gewählten Päckli (wie renderPackages), editierbar.
  const items = state.content
    .filter((c) => c.parcel_id === parcel.id)
    .map((c) => ({ article: state.articles.find((a) => a.id === c.article_id), qty: c.quantity }))
    .filter((x) => x.article)
    .sort((a, b) => a.article.name.localeCompare(b.article.name, 'de-CH'));

  if (!items.length) {
    el('admin-content').innerHTML = '<p class="empty">Noch keine Artikel in diesem Päckli.</p>';
    return;
  }

  el('admin-content').innerHTML = items.map((x) => `
    <div class="item" data-row="${x.article.id}">
      <label>Name</label>
      <input type="text" data-f="name" value="${esc(x.article.name)}">
      <label>Kategorie</label>
      <select data-f="category">
        ${CATEGORIES.map((c) => `<option value="${esc(c)}" ${c === x.article.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select>
      <label>Menge (${esc(parcel.abbreviation)})</label>
      <input type="number" min="0" step="1" inputmode="numeric" data-parcel="${parcel.id}" value="${x.qty}">
      <label>Notiz</label>
      <input type="text" data-f="notes" value="${esc(x.article.notes || '')}">
      <div class="row-actions">
        <button class="secondary" data-save="${x.article.id}">Speichern</button>
        <button class="ghost" data-remove="${x.article.id}">Aus Päckli entfernen</button>
      </div>
    </div>`).join('');

  $$('#admin-content [data-save]').forEach((b) =>
    b.addEventListener('click', () => saveArticle(b.dataset.save, 'admin-content')));
  $$('#admin-content [data-remove]').forEach((b) =>
    b.addEventListener('click', () => removeFromParcel(b.dataset.remove)));
}

// Admin-Unterseite „Artikel": alle Artikel, unabhängig von Päckli-Zuordnung.
// Zwei Modi je nach state.articleEditId: Liste (nach Kategorie gruppiert,
// „Ändern"-Knopf) oder Änderungsansicht (ein Artikel, Speichern/Löschen).
// Einziger Ort zum endgültigen Löschen (Löschregel: nicht in einem Päckli
// enthalten und noch nicht gekauft – siehe deleteArticle).
function renderAdminArticles() {
  const editing = state.articleEditId && state.articles.find((a) => a.id === state.articleEditId);
  if (state.articleEditId && !editing) state.articleEditId = null; // z.B. gerade gelöscht

  el('admin-articles-new').classList.toggle('hidden', !!editing);

  if (editing) {
    renderArticleEditForm(editing);
  } else {
    renderArticleList();
  }
}

function startEditArticle(id) {
  state.articleEditId = id;
  renderAdminArticles();
}

function renderArticleList() {
  const box = el('admin-articles-list');
  if (!state.articles.length) {
    box.innerHTML = '<p class="empty">Noch keine Artikel angelegt.</p>';
    return;
  }

  const groups = CATEGORIES
    .map((cat) => ({
      cat,
      items: state.articles.filter((a) => a.category === cat)
        .sort((a, b) => a.name.localeCompare(b.name, 'de-CH'))
    }))
    .filter((g) => g.items.length);

  box.innerHTML = groups.map((g) => `
    <h3 class="category-heading">${esc(g.cat)}</h3>
    ${g.items.map((a) => `
      <div class="item">
        <div class="head">
          <span class="name">${esc(a.name)}</span>
        </div>
        ${a.notes ? `<div class="sub">${esc(a.notes)}</div>` : ''}
        <div class="row-actions">
          <button class="secondary" data-editart="${a.id}">Ändern</button>
        </div>
      </div>`).join('')}`).join('');

  $$('#admin-articles-list [data-editart]').forEach((b) =>
    b.addEventListener('click', () => startEditArticle(b.dataset.editart)));
}

// Änderungsansicht für einen einzelnen Artikel. Nutzt dieselben data-row/
// data-f-Attribute wie die Päckli-Inhalt-Zeilen, damit saveArticle()
// wiederverwendet werden kann (containerId grenzt die Suche entsprechend ein).
function renderArticleEditForm(a) {
  const bought = state.status.find((s) => s.id === a.id)?.bought || 0;
  el('admin-articles-list').innerHTML = `
    <button class="ghost" id="art-edit-back">← Zurück zur Liste</button>
    <div class="card" data-row="${a.id}">
      <h3>Artikel ändern</h3>
      <label>Name</label>
      <input type="text" data-f="name" value="${esc(a.name)}">
      <label>Kategorie</label>
      <select data-f="category">
        ${CATEGORIES.map((c) => `<option value="${esc(c)}" ${c === a.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select>
      <label>Notiz</label>
      <input type="text" data-f="notes" value="${esc(a.notes || '')}">
      ${bought ? `<p class="muted" style="margin:8px 4px 0">Bereits ${bought}× gekauft – kann deshalb nicht gelöscht werden.</p>` : ''}
      <div class="row-actions">
        <button class="secondary" data-save="${a.id}">Speichern</button>
        <button class="ghost" data-delart="${a.id}" ${bought ? 'disabled' : ''}>Löschen</button>
      </div>
    </div>`;

  el('art-edit-back').addEventListener('click', () => { state.articleEditId = null; renderAdminArticles(); });
  $(`#admin-articles-list [data-save="${a.id}"]`)
    .addEventListener('click', () => saveArticle(a.id, 'admin-articles-list'));
  $(`#admin-articles-list [data-delart="${a.id}"]`)
    .addEventListener('click', () => deleteArticle(a.id));
}

async function saveGoals() {
  const msg = el('goal-msg');

  // Anzahl Päckli je Typ aktualisieren.
  for (const inp of $$('#goal-parcels [data-parcel-goal]')) {
    const { error } = await db.from('parcels')
      .update({ number: parseInt(inp.value, 10) || 0 })
      .eq('id', inp.dataset.parcelGoal);
    if (error) { msg.className = 'muted err'; msg.textContent = 'Fehler: ' + error.message; return; }
  }

  const { error } = await db.from('campaign')
    .update({ target_date: el('goal-date').value || null })
    .eq('id', 1);
  if (error) { msg.className = 'muted err'; msg.textContent = 'Fehler: ' + error.message; return; }

  msg.className = 'muted ok';
  msg.textContent = 'Gespeichert ✓';
  await loadData();
  renderAdmin();
}

// Mengen je Päckli für einen Artikel speichern: >0 anlegen/ändern, 0 löschen.
async function saveParcelContent(articleId, inputs) {
  for (const inp of inputs) {
    const parcelId = inp.dataset.parcel;
    const qty = parseInt(inp.value, 10) || 0;
    if (qty > 0) {
      const { error } = await db.from('parcel_content')
        .upsert({ parcel_id: parcelId, article_id: articleId, quantity: qty },
                { onConflict: 'parcel_id,article_id' });
      if (error) return error;
    } else {
      const { error } = await db.from('parcel_content').delete()
        .eq('parcel_id', parcelId).eq('article_id', articleId);
      if (error) return error;
    }
  }
  return null;
}

// containerId grenzt die Zeilensuche ein: dieselbe Artikel-id kann gleichzeitig
// sowohl in der Artikel-Seite als auch im Päckli-Inhalt gerendert sein (beide
// bleiben im DOM, nur die inaktive Admin-Unterseite ist per CSS versteckt) –
// ohne Eingrenzung würde `$(...)` sonst die falsche, unsichtbare Zeile treffen.
async function saveArticle(id, containerId) {
  const row = $(`#${containerId} [data-row="${id}"]`);
  const get = (f) => row.querySelector(`[data-f="${f}"]`).value;
  const { error } = await db.from('articles').update({
    name: get('name').trim(),
    notes: get('notes').trim() || null,
    category: get('category')
  }).eq('id', id);
  if (error) { alert('Fehler: ' + error.message); return; }

  const parcelInputs = row.querySelectorAll('[data-parcel]');
  if (parcelInputs.length) {
    const cErr = await saveParcelContent(id, parcelInputs);
    if (cErr) { alert('Fehler: ' + cErr.message); return; }
  }

  await loadData();
  // kurze Bestätigung
  const btn = row.querySelector('[data-save]');
  const old = btn.textContent; btn.textContent = 'Gespeichert ✓';
  setTimeout(() => { btn.textContent = old; }, 1200);
}

// Artikel nur aus dem aktuell gewählten Päckli entfernen (Artikel bleibt bestehen).
async function removeFromParcel(id) {
  if (!confirm('Artikel aus diesem Päckli entfernen?')) return;
  const { error } = await db.from('parcel_content').delete()
    .eq('parcel_id', state.adminParcel).eq('article_id', id);
  if (error) { alert('Fehler: ' + error.message); return; }
  await reload();
}

// Artikel endgültig löschen. Die Regeln (nicht löschbar, solange in einem
// Päckli enthalten oder schon gekauft) erzwingt die DB per `on delete
// restrict`; hier werden sie vorab geprüft für verständliche Meldungen.
async function deleteArticle(id) {
  const name = state.articles.find((a) => a.id === id)?.name || 'Artikel';

  const inParcels = state.content
    .filter((c) => c.article_id === id)
    .map((c) => state.parcels.find((p) => p.id === c.parcel_id)?.name)
    .filter(Boolean);
  if (inParcels.length) {
    alert(`„${name}" ist noch enthalten in: ${inParcels.join(', ')}.\n` +
      'Bitte zuerst überall „Aus Päckli entfernen".');
    return;
  }

  const bought = state.status.find((s) => s.id === id)?.bought || 0;
  if (bought > 0) {
    alert(`„${name}" wurde bereits ${bought}× gekauft und kann deshalb nicht gelöscht werden.`);
    return;
  }

  if (!confirm(`„${name}" endgültig löschen?`)) return;
  const { error } = await db.from('articles').delete().eq('id', id);
  if (error) {
    // 23503 = Fremdschlüssel-Verletzung: jemand hat inzwischen gekauft/zugeordnet.
    alert(error.code === '23503'
      ? `„${name}" kann nicht gelöscht werden: Inzwischen gibt es dazu wieder Käufe oder eine Päckli-Zuordnung.`
      : 'Fehler: ' + error.message);
    return;
  }
  await reload();
}

async function addArticle() {
  const msg = el('new-msg');
  const name = el('new-name').value.trim();
  const qty = parseInt(el('new-qty').value, 10) || 0;
  if (!name) { msg.className = 'muted err'; msg.textContent = 'Name fehlt.'; return; }
  if (qty < 1) { msg.className = 'muted err'; msg.textContent = 'Menge muss mindestens 1 sein.'; return; }
  if (!state.adminParcel) { msg.className = 'muted err'; msg.textContent = 'Kein Päckli gewählt.'; return; }

  // Artikel mit gleichem Namen wiederverwenden (verhindert Duplikate, z.B. Biskuits
  // in beiden Päckli), sonst neu anlegen.
  let article = state.articles.find(
    (a) => a.name.trim().toLowerCase() === name.toLowerCase());
  if (!article) {
    const { data, error } = await db.from('articles').insert({
      name,
      notes: el('new-notes').value.trim() || null,
      category: el('new-category').value
    }).select().single();
    if (error) { msg.className = 'muted err'; msg.textContent = 'Fehler: ' + error.message; return; }
    article = data;
  }

  // Zuordnung zum gewählten Päckli anlegen/aktualisieren.
  const { error: cErr } = await db.from('parcel_content').upsert(
    { parcel_id: state.adminParcel, article_id: article.id, quantity: qty },
    { onConflict: 'parcel_id,article_id' });
  if (cErr) { msg.className = 'muted err'; msg.textContent = 'Fehler: ' + cErr.message; return; }

  el('new-name').value = '';
  el('new-notes').value = '';
  el('new-qty').value = '1';
  msg.className = 'muted ok';
  msg.textContent = 'Hinzugefügt ✓';
  await reload();
}

// Admin-Unterseite „Artikel": Artikel anlegen ohne Päckli-Zuordnung
// (die Zuordnung + Menge passiert separat unter „Päckli-Inhalt").
async function addStandaloneArticle() {
  const msg = el('art-msg');
  const name = el('art-name').value.trim();
  if (!name) { msg.className = 'muted err'; msg.textContent = 'Name fehlt.'; return; }

  if (state.articles.some((a) => a.name.trim().toLowerCase() === name.toLowerCase())) {
    msg.className = 'muted err';
    msg.textContent = `Ein Artikel namens „${name}" existiert bereits.`;
    return;
  }

  const { error } = await db.from('articles').insert({
    name,
    category: el('art-category').value,
    notes: el('art-notes').value.trim() || null
  });
  if (error) { msg.className = 'muted err'; msg.textContent = 'Fehler: ' + error.message; return; }

  el('art-name').value = '';
  el('art-notes').value = '';
  msg.className = 'muted ok';
  msg.textContent = 'Hinzugefügt ✓';
  await reload();
}

// ============================================================
//  Event-Verdrahtung
// ============================================================
function wireEvents() {
  el('login-btn')?.addEventListener('click', login);
  el('register-btn')?.addEventListener('click', register);
  el('login-password')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  el('onboard-btn')?.addEventListener('click', saveOnboard);
  el('logout-btn')?.addEventListener('click', logout);
  el('user-name')?.addEventListener('click', () => showView('profile'));
  el('buy-btn')?.addEventListener('click', submitBuy);
  el('buy-shop')?.addEventListener('change', onBuyShopChange);
  el('profile-btn')?.addEventListener('click', saveProfile);
  el('profile-password-btn')?.addEventListener('click', changePassword);
  el('goal-btn')?.addEventListener('click', saveGoals);
  el('new-btn')?.addEventListener('click', addArticle);
  el('art-btn')?.addEventListener('click', addStandaloneArticle);
  $$('#admin-nav .pkg-btn').forEach((b) =>
    b.addEventListener('click', () => setAdminPage(b.dataset.adminPage)));

  $$('#tabs .tab').forEach((t) =>
    t.addEventListener('click', () => showView(t.dataset.view)));
}

// ---------- Service Worker ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('sw.js').catch(() => {}));
}

wireEvents();
init();
