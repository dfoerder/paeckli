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

// ---------- Zustand ----------
const state = {
  profile: null,      // { id, name, is_admin }
  campaign: null,     // { title, target_date }
  parcels: [],        // [{ id, name, abbreviation, number, sort_order }]
  articles: [],       // [{ id, name, notes, sort_order }]
  content: [],        // parcel_content: [{ parcel_id, article_id, quantity }]
  status: [],         // aus View article_status
  purchases: [],      // eigene Käufe (mit Artikelname)
  allPurchases: [],   // alle Käufe (nur Admin; mit Artikel- und Käufer:in-Name)
  view: 'overview',
  pkgParcel: null,    // id des in der Päckli-Ansicht gewählten Päckli-Typs
  adminParcel: null   // id des im Admin gewählten Päckli-Typs (unabhängig)
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

function show(id) { el(id)?.classList.remove('hidden'); }
function hide(id) { el(id)?.classList.add('hidden'); }

function showView(name) {
  state.view = name;
  $$('.view').forEach((v) => v.classList.add('hidden'));
  show('view-' + name);
  $$('#tabs .tab').forEach((t) =>
    t.classList.toggle('active', t.dataset.view === name));
  if (name === 'overview') renderOverview();
  if (name === 'buy') renderBuyOptions();
  if (name === 'mine') renderMine();
  if (name === 'packages') renderPackages();
  if (name === 'admin') renderAdmin();
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
    el('onboard-name').focus();
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
  el('user-name').textContent = state.profile.name;
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
  const name = el('onboard-name').value.trim();
  const contact = el('onboard-contact').value.trim() || null;
  const msg = el('onboard-msg');
  if (!name) { msg.textContent = 'Bitte Namen eingeben.'; return; }

  const { data: { user } } = await db.auth.getUser();
  el('onboard-btn').disabled = true;

  const { data, error } = await db
    .from('profiles')
    .insert({ id: user.id, name, contact })
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
    db.from('parcels').select('*').order('sort_order'),
    db.from('articles').select('*').order('sort_order'),
    db.from('parcel_content').select('*'),
    db.from('article_status').select('*').order('sort_order'),
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
      .select('*, articles(name), profiles(name, contact)')
      .order('created_at', { ascending: false });
    if (all.error) console.error('loadData: allPurchases ->', all.error);
    state.allPurchases = (all.data || []).sort((a, b) =>
      (a.profiles?.name || '').localeCompare(b.profiles?.name || '', 'de-CH'));
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

  if (!list.length) {
    el('overview-list').innerHTML = banner + '<p class="empty">Noch keine Artikel angelegt.</p>';
    return;
  }

  el('overview-list').innerHTML = banner + list.map((a) => {
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
  }).join('');
}

// ============================================================
//  Ansicht: Kauf eintragen
// ============================================================
function renderBuyOptions() {
  el('buy-article').innerHTML = state.articles
    .map((a) => `<option value="${a.id}">${esc(a.name)}</option>`)
    .join('');
}

async function submitBuy() {
  const article_id = el('buy-article').value;
  const quantity = parseInt(el('buy-qty').value, 10);
  const note = el('buy-note').value.trim() || null;
  const msg = el('buy-msg');

  if (!article_id) { msg.textContent = 'Bitte Artikel wählen.'; return; }
  if (!quantity || quantity < 1) { msg.className = 'muted err'; msg.textContent = 'Anzahl muss mindestens 1 sein.'; return; }

  el('buy-btn').disabled = true;
  const { error } = await db.from('purchases').insert({
    article_id, quantity, note, user_id: state.profile.id
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
  el('buy-note').value = '';
  await loadData();
}

// ============================================================
//  Ansicht: Meine Käufe
// ============================================================
function renderMine() {
  // Eigene Kontaktangabe ins Feld übernehmen (leert eine evtl. alte Meldung).
  el('mine-contact').value = state.profile.contact || '';
  el('mine-contact-msg').textContent = '';

  if (!state.purchases.length) {
    el('mine-list').innerHTML = '<p class="empty">Du hast noch nichts eingetragen.</p>';
    return;
  }
  el('mine-list').innerHTML = state.purchases.map((p) => {
    const date = new Date(p.created_at).toLocaleDateString('de-CH');
    return `
      <div class="item">
        <div class="head">
          <span class="name">${esc(p.articles?.name || 'Artikel')}</span>
          <span class="count">${p.quantity} Stk.</span>
        </div>
        <div class="sub">${date}${p.note ? ' · ' + esc(p.note) : ''}</div>
        <div class="row-actions">
          <button class="ghost" data-del="${p.id}">Löschen</button>
        </div>
      </div>`;
  }).join('');

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
    const name = p.profiles?.name || 'Unbekannt';
    let g = groups.find((x) => x.name === name);
    if (!g) { g = { name, contact: p.profiles?.contact || null, items: [] }; groups.push(g); }
    g.items.push(p);
  }

  box.innerHTML = groups.map((g) => `
    <div class="buyer-group">
      <h3 class="buyer-name">${esc(g.name)} <span class="muted">(${g.items.length})</span></h3>
      ${g.contact ? `<p class="buyer-contact">📞 ${esc(g.contact)}</p>` : ''}
      ${g.items.map((p) => {
        const date = new Date(p.created_at).toLocaleDateString('de-CH');
        return `
          <div class="item">
            <div class="head">
              <span class="name">${esc(p.articles?.name || 'Artikel')}</span>
              <span class="count">${p.quantity} Stk.</span>
            </div>
            <div class="sub">${date}${p.note ? ' · ' + esc(p.note) : ''}</div>
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

// Eigene Kontaktangabe speichern (für Admin-Rückfragen sichtbar).
async function saveContact() {
  const contact = el('mine-contact').value.trim() || null;
  const msg = el('mine-contact-msg');
  el('mine-contact-btn').disabled = true;
  const { error } = await db.from('profiles')
    .update({ contact }).eq('id', state.profile.id);
  el('mine-contact-btn').disabled = false;
  if (error) { msg.className = 'muted err'; msg.textContent = 'Fehler: ' + error.message; return; }
  state.profile.contact = contact;
  msg.className = 'muted ok';
  msg.textContent = 'Gespeichert ✓';
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
    .sort((a, b) => a.article.sort_order - b.article.sort_order);

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

  renderAllPurchases();
  renderAdminContent();
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
    .sort((a, b) => a.article.sort_order - b.article.sort_order);

  if (!items.length) {
    el('admin-content').innerHTML = '<p class="empty">Noch keine Artikel in diesem Päckli.</p>';
    return;
  }

  el('admin-content').innerHTML = items.map((x) => `
    <div class="item" data-row="${x.article.id}">
      <label>Name</label>
      <input type="text" data-f="name" value="${esc(x.article.name)}">
      <label>Menge (${esc(parcel.abbreviation)})</label>
      <input type="number" min="0" step="1" inputmode="numeric" data-parcel="${parcel.id}" value="${x.qty}">
      <label>Notiz</label>
      <input type="text" data-f="notes" value="${esc(x.article.notes || '')}">
      <div class="row-actions">
        <button class="secondary" data-save="${x.article.id}">Speichern</button>
        <button class="ghost" data-remove="${x.article.id}">Aus Päckli entfernen</button>
        <button class="ghost" data-delart="${x.article.id}">Artikel löschen</button>
      </div>
    </div>`).join('');

  $$('#admin-content [data-save]').forEach((b) =>
    b.addEventListener('click', () => saveArticle(b.dataset.save)));
  $$('#admin-content [data-remove]').forEach((b) =>
    b.addEventListener('click', () => removeFromParcel(b.dataset.remove)));
  $$('#admin-content [data-delart]').forEach((b) =>
    b.addEventListener('click', () => deleteArticle(b.dataset.delart)));
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

async function saveArticle(id) {
  const row = $(`[data-row="${id}"]`);
  const get = (f) => row.querySelector(`[data-f="${f}"]`).value;
  const { error } = await db.from('articles').update({
    name: get('name').trim(),
    notes: get('notes').trim() || null
  }).eq('id', id);
  if (error) { alert('Fehler: ' + error.message); return; }

  const cErr = await saveParcelContent(id, row.querySelectorAll('[data-parcel]'));
  if (cErr) { alert('Fehler: ' + cErr.message); return; }

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

async function deleteArticle(id) {
  if (!confirm('Artikel inkl. aller zugehörigen Käufe löschen?')) return;
  const { error } = await db.from('articles').delete().eq('id', id);
  if (error) { alert('Fehler: ' + error.message); return; }
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
    const maxOrder = state.articles.reduce((m, a) => Math.max(m, a.sort_order), 0);
    const { data, error } = await db.from('articles').insert({
      name,
      notes: el('new-notes').value.trim() || null,
      sort_order: maxOrder + 10
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

// ============================================================
//  Event-Verdrahtung
// ============================================================
function wireEvents() {
  el('login-btn')?.addEventListener('click', login);
  el('register-btn')?.addEventListener('click', register);
  el('login-password')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  el('onboard-btn')?.addEventListener('click', saveOnboard);
  el('logout-btn')?.addEventListener('click', logout);
  el('buy-btn')?.addEventListener('click', submitBuy);
  el('mine-contact-btn')?.addEventListener('click', saveContact);
  el('goal-btn')?.addEventListener('click', saveGoals);
  el('new-btn')?.addEventListener('click', addArticle);

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
