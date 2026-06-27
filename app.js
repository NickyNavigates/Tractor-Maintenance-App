/* ShedLog — equipment maintenance tracker (PWA, offline, no backend).
   Data is stored locally in the browser via localStorage. */

'use strict';

/* ----------------------------- Constants ----------------------------- */

const CATEGORIES = {
  tractor:   { label: 'Tractor',   emoji: '🚜', defaultUnit: 'hours' },
  implement: { label: 'Implement', emoji: '🔧', defaultUnit: 'hours' },
  tool:      { label: 'Tool',      emoji: '🛠️', defaultUnit: 'none'  },
  vehicle:   { label: 'Vehicle',   emoji: '🚛', defaultUnit: 'miles' },
};
const CATEGORY_ORDER = ['tractor', 'implement', 'vehicle', 'tool'];

const UNIT_LABEL = { hours: 'hours', miles: 'miles', none: '' };

// Consumable / parts reference types (oil, grease, belts, etc.).
const CONSUMABLE_TYPES = {
  oil:     { label: 'Engine oil',  emoji: '🛢️' },
  hydoil:  { label: 'Hyd/trans oil', emoji: '🛢️' },
  grease:  { label: 'Grease',      emoji: '🧴' },
  fluid:   { label: 'Fluid',       emoji: '💧' },
  filter:  { label: 'Filter',      emoji: '🌀' },
  belt:    { label: 'Belt',        emoji: '➰' },
  tire:    { label: 'Tire',        emoji: '🛞' },
  battery: { label: 'Battery',     emoji: '🔋' },
  spark:   { label: 'Spark plug',  emoji: '🔌' },
  blade:   { label: 'Blade/bit',   emoji: '🔪' },
  other:   { label: 'Other part',  emoji: '📦' },
};
const CONSUMABLE_ORDER = ['oil', 'hydoil', 'fluid', 'grease', 'filter', 'belt', 'tire', 'battery', 'spark', 'blade', 'other'];

const SOON_DAYS = 14;   // time-based task is "due soon" within this many days
const SOON_USAGE_FRACTION = 0.1; // usage-based task is "due soon" within 10% of interval
const BACKUP_REMINDER_DAYS = 14; // nudge to back up if last backup is older than this
const BACKUP_SNOOZE_DAYS = 7;    // how long "Later" hides the reminder

/* ------------------------------- Store ------------------------------- */

const STORE_KEY = 'shedlog.v1';

const EMPTY_DATA = { equipment: [], records: [], tasks: [], consumables: [], photos: [] };

const Store = {
  data: { equipment: [], records: [], tasks: [], consumables: [], photos: [] },

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) this.data = Object.assign({}, EMPTY_DATA, JSON.parse(raw));
    } catch (e) { console.error('load failed', e); }
  },
  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); }
    catch (e) { console.error('save failed', e); }
  },

  // equipment
  equipment() { return this.data.equipment; },
  getEquipment(id) { return this.data.equipment.find(e => e.id === id); },
  upsertEquipment(eq) {
    const i = this.data.equipment.findIndex(e => e.id === eq.id);
    if (i >= 0) this.data.equipment[i] = eq; else this.data.equipment.push(eq);
    this.save();
  },
  deleteEquipment(id) {
    // remove any stored photo blobs for this equipment (best effort, async)
    this.data.photos.filter(p => p.equipmentId === id).forEach(p => ImageDB.del(p.id).catch(() => {}));
    this.data.equipment   = this.data.equipment.filter(e => e.id !== id);
    this.data.records     = this.data.records.filter(r => r.equipmentId !== id);
    this.data.tasks       = this.data.tasks.filter(t => t.equipmentId !== id);
    this.data.consumables = this.data.consumables.filter(c => c.equipmentId !== id);
    this.data.photos      = this.data.photos.filter(p => p.equipmentId !== id);
    this.save();
  },

  // tasks (recurring schedules)
  tasks() { return this.data.tasks; },
  tasksFor(eqId) { return this.data.tasks.filter(t => t.equipmentId === eqId); },
  getTask(id) { return this.data.tasks.find(t => t.id === id); },
  upsertTask(t) {
    const i = this.data.tasks.findIndex(x => x.id === t.id);
    if (i >= 0) this.data.tasks[i] = t; else this.data.tasks.push(t);
    this.save();
  },
  deleteTask(id) { this.data.tasks = this.data.tasks.filter(t => t.id !== id); this.save(); },

  // records (completed maintenance log)
  records() { return this.data.records; },
  recordsFor(eqId) {
    return this.data.records.filter(r => r.equipmentId === eqId)
      .sort((a, b) => b.date.localeCompare(a.date));
  },
  addRecord(r) { this.data.records.push(r); this.save(); },
  deleteRecord(id) { this.data.records = this.data.records.filter(r => r.id !== id); this.save(); },

  // consumables (required parts/fluids reference per equipment)
  consumablesFor(eqId) { return this.data.consumables.filter(c => c.equipmentId === eqId); },
  getConsumable(id) { return this.data.consumables.find(c => c.id === id); },
  upsertConsumable(c) {
    const i = this.data.consumables.findIndex(x => x.id === c.id);
    if (i >= 0) this.data.consumables[i] = c; else this.data.consumables.push(c);
    this.save();
  },
  deleteConsumable(id) { this.data.consumables = this.data.consumables.filter(c => c.id !== id); this.save(); },

  // photos (reference images with a location/caption, e.g. zerk fittings)
  photosFor(eqId) { return this.data.photos.filter(p => p.equipmentId === eqId).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')); },
  getPhoto(id) { return this.data.photos.find(p => p.id === id); },
  addPhoto(p) { this.data.photos.push(p); this.save(); },
  updatePhoto(p) { const i = this.data.photos.findIndex(x => x.id === p.id); if (i >= 0) this.data.photos[i] = p; this.save(); },
  deletePhoto(id) { this.data.photos = this.data.photos.filter(p => p.id !== id); ImageDB.del(id).catch(() => {}); this.save(); },
};

/* IndexedDB store for photo blobs (kept out of localStorage, which is too small for images). */
const ImageDB = {
  _db: null,
  open() {
    return new Promise((resolve, reject) => {
      if (this._db) return resolve(this._db);
      if (!('indexedDB' in window)) return reject(new Error('no indexeddb'));
      const req = indexedDB.open('shedlog-images', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('img');
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },
  async put(id, dataUrl) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('img', 'readwrite');
      tx.objectStore('img').put(dataUrl, id);
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  },
  async get(id) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('img', 'readonly');
      const r = tx.objectStore('img').get(id);
      r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error);
    });
  },
  async del(id) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('img', 'readwrite');
      tx.objectStore('img').delete(id);
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  },
};

// Read an image File, downscale it, and return a compact JPEG data URL.
function fileToCompressedDataURL(file, maxDim = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('bad image'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        try { resolve(canvas.toDataURL('image/jpeg', quality)); }
        catch (e) { reject(e); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* Backup metadata, kept separate from the data so it never travels inside a backup file. */
const META_KEY = 'shedlog.meta.v1';
const Meta = {
  data: { lastBackupAt: null, snoozeUntil: null },
  load() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (raw) this.data = Object.assign(this.data, JSON.parse(raw));
    } catch (e) { /* ignore */ }
  },
  save() { try { localStorage.setItem(META_KEY, JSON.stringify(this.data)); } catch (e) {} },
  markBackedUp() { this.data.lastBackupAt = new Date().toISOString(); this.data.snoozeUntil = null; this.save(); },
  snooze() { this.data.snoozeUntil = addDays(todayISO(), BACKUP_SNOOZE_DAYS); this.save(); },
};

/* ------------------------------ Helpers ------------------------------ */

const uid = () => 'id-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};
const daysBetween = (aISO, bISO) => Math.round(
  (new Date(bISO + 'T00:00:00') - new Date(aISO + 'T00:00:00')) / 86400000);
const fmtNum = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
const fmtMoney = (n) => '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 1800);
}

/* --------------------------- Task scheduling -------------------------- */

// Returns { status: 'ok'|'soon'|'over', text: string, sort: number }
// sort is a urgency key (lower = more urgent) so lists order naturally.
function taskStatus(task) {
  const eq = Store.getEquipment(task.equipmentId);
  if (task.intervalType === 'usage') {
    const unit = UNIT_LABEL[eq?.usageUnit] || 'units';
    const base = task.lastDoneUsage ?? 0;
    const dueAt = base + Number(task.intervalValue);
    const current = Number(eq?.currentUsage ?? 0);
    const left = dueAt - current;
    const soonWindow = Number(task.intervalValue) * SOON_USAGE_FRACTION;
    let status = 'ok';
    if (left <= 0) status = 'over';
    else if (left <= soonWindow) status = 'soon';
    const text = left <= 0
      ? `Over by ${fmtNum(-left)} ${unit}`
      : `In ${fmtNum(left)} ${unit}`;
    return { status, text, sort: left, due: `at ${fmtNum(dueAt)} ${unit}` };
  } else {
    const last = task.lastDoneDate || todayISO();
    const nextDays = daysBetween(todayISO(), addDays(last, Number(task.intervalValue)));
    let status = 'ok';
    if (nextDays < 0) status = 'over';
    else if (nextDays <= SOON_DAYS) status = 'soon';
    const text = nextDays < 0
      ? `Overdue ${Math.abs(nextDays)}d`
      : nextDays === 0 ? 'Due today' : `In ${nextDays} days`;
    return { status, text, sort: nextDays, due: fmtDate(addDays(last, Number(task.intervalValue))) };
  }
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function allTasksRanked() {
  return Store.tasks()
    .map(t => ({ task: t, st: taskStatus(t), eq: Store.getEquipment(t.equipmentId) }))
    .filter(x => x.eq)
    .sort((a, b) => a.st.sort - b.st.sort);
}

/* ------------------------------ Routing ------------------------------ */

const routes = {
  '/dashboard': renderDashboard,
  '/equipment': renderEquipmentList,
  '/history':   renderHistory,
  '/equipment/': renderEquipmentDetail, // '#/equipment/:id'
};

function currentRoute() {
  const hash = location.hash || '#/dashboard';
  return hash.slice(1); // strip '#'
}

function navigate(hash) { location.hash = hash; }

function router() {
  const path = currentRoute();
  const view = $('#view');
  view.scrollTop = 0;

  let render, arg = null, title = 'ShedLog', showBack = false, showAdd = true;

  if (path.startsWith('/equipment/')) {
    arg = decodeURIComponent(path.slice('/equipment/'.length));
    render = renderEquipmentDetail; showBack = true; showAdd = false;
  } else if (path === '/equipment') {
    render = renderEquipmentList; title = 'Equipment';
  } else if (path === '/shopping') {
    render = renderShopping; title = 'Shopping List'; showAdd = false;
  } else if (path === '/history') {
    render = renderHistory; title = 'History'; showAdd = false;
  } else {
    render = renderDashboard; title = 'Dashboard';
  }

  // app bar
  $('#backBtn').hidden = !showBack;
  $('#addBtn').hidden = !showAdd;
  view.innerHTML = '';
  const result = render(view, arg);
  $('#title').textContent = result?.title || title;

  // active tab
  document.querySelectorAll('.tab').forEach(tab => {
    const r = tab.dataset.route;
    tab.classList.toggle('active',
      r === '#' + path ||
      (r === '#/equipment' && path.startsWith('/equipment')));
  });

  // shopping tab low-stock indicator dot
  const dot = $('.tab[data-route="#/shopping"] .dot');
  if (dot) dot.hidden = lowStockConsumables().length === 0;
}

/* ------------------------------ Views -------------------------------- */

function emptyState(view, icon, heading, text, btnLabel, onClick) {
  const e = el('div', { class: 'empty' },
    el('div', { class: 'ei' }, icon),
    el('h2', {}, heading),
    el('p', {}, text),
    btnLabel ? el('button', { class: 'btn', style: 'max-width:280px;margin:0 auto', onclick: onClick }, btnLabel) : null,
  );
  view.appendChild(e);
}

function statusPill(st) {
  const cls = st.status === 'over' ? 'over' : st.status === 'soon' ? 'soon' : 'ok';
  return el('span', { class: 'pill ' + cls }, st.text);
}

function renderDashboard(view) {
  const eqs = Store.equipment();
  if (eqs.length === 0) {
    emptyState(view, '🚜', 'Welcome to ShedLog',
      'Track maintenance for your tractors, implements, tools and vehicles. Start by adding your first piece of equipment.',
      'Add Equipment', () => openEquipmentForm());
    view.appendChild(el('div', { class: 'center', style: 'margin-top:4px' },
      el('button', { class: 'btn secondary', style: 'width:auto;margin:0 auto', onclick: importData },
        'Restore from a Backup')));
    return { title: 'Dashboard' };
  }

  const ranked = allTasksRanked();
  const over = ranked.filter(x => x.st.status === 'over');
  const soon = ranked.filter(x => x.st.status === 'soon');

  // Summary banner
  if (over.length) {
    view.appendChild(el('div', { class: 'banner over' },
      el('div', { class: 'bignum' }, String(over.length)),
      el('div', {},
        el('div', { class: 'blabel' }, over.length === 1 ? '1 task overdue' : `${over.length} tasks overdue`),
        el('div', { class: 'bsub' }, soon.length ? `${soon.length} more due soon` : 'Tap a task to mark it done'))));
  } else if (soon.length) {
    view.appendChild(el('div', { class: 'banner soon' },
      el('div', { class: 'bignum' }, String(soon.length)),
      el('div', {},
        el('div', { class: 'blabel' }, soon.length === 1 ? '1 task due soon' : `${soon.length} tasks due soon`),
        el('div', { class: 'bsub' }, 'Nothing overdue — nice work'))));
  } else {
    view.appendChild(el('div', { class: 'banner ok' },
      el('div', { class: 'bignum' }, '✓'),
      el('div', {},
        el('div', { class: 'blabel' }, 'All caught up'),
        el('div', { class: 'bsub' }, ranked.length ? 'No maintenance due right now' : 'Add service schedules to get reminders'))));
  }

  // Backup reminder
  if (shouldRemindBackup()) view.appendChild(backupReminderCard());

  // Upcoming list
  const upcoming = ranked.filter(x => x.st.status !== 'ok').slice(0, 12);
  if (upcoming.length) {
    view.appendChild(el('div', { class: 'section-title' }, 'Needs Attention'));
    const card = el('div', { class: 'card' });
    upcoming.forEach(x => card.appendChild(taskRow(x, true)));
    view.appendChild(card);
  }

  // Equipment quick summary
  view.appendChild(el('div', { class: 'section-title' }, 'Equipment'));
  const eqCard = el('div', { class: 'card' });
  eqs.forEach(eq => eqCard.appendChild(equipmentRow(eq)));
  view.appendChild(eqCard);

  // Data & backup
  view.appendChild(el('div', { class: 'section-title' }, 'Data & Backup'));
  view.appendChild(el('div', { class: 'card' },
    el('div', { class: 'row', onclick: exportData },
      el('span', { class: 'emoji' }, '⬆️'),
      el('div', { class: 'grow' },
        el('div', { class: 'primary' }, 'Export / Save to Files'),
        el('div', { class: 'secondary' }, backupStatusText())),
      el('span', { class: 'chev' }, '›')),
    el('div', { class: 'row', onclick: importData },
      el('span', { class: 'emoji' }, '⬇️'),
      el('div', { class: 'grow' },
        el('div', { class: 'primary' }, 'Restore from Backup'),
        el('div', { class: 'secondary' }, 'Replace data from a backup file')),
      el('span', { class: 'chev' }, '›'))));
  view.appendChild(el('div', { class: 'center muted', style: 'margin-top:12px;padding:0 16px;line-height:1.4' },
    'Your data is stored only on this device. Export regularly to keep a copy in your Files app or iCloud Drive.'));

  return { title: 'Dashboard' };
}

/* ---------------------------- Backup / restore ----------------------- */

// Export all data as a JSON file. On iPhone the share sheet offers "Save to Files".
async function exportData() {
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `shedlog-backup-${stamp}.json`;
  // Pull photo image data out of IndexedDB so backups are complete.
  const images = {};
  for (const p of Store.data.photos) {
    try { const d = await ImageDB.get(p.id); if (d) images[p.id] = d; } catch (e) { /* skip */ }
  }
  const payload = JSON.stringify({ app: 'ShedLog', version: 1, exportedAt: new Date().toISOString(), ...Store.data, images }, null, 2);

  // Preferred path on iOS: native share sheet with a file attachment.
  try {
    const file = new File([payload], filename, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'ShedLog Backup' });
      Meta.markBackedUp();
      router();
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // user cancelled the share sheet
  }

  // Fallback: trigger a normal file download.
  try {
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    Meta.markBackedUp();
    toast('Backup saved');
    router();
  } catch (e) {
    alert('Could not export the backup on this device.');
  }
}

/* Backup reminder helpers */
function daysSinceBackup() {
  if (!Meta.data.lastBackupAt) return null;
  return daysBetween(Meta.data.lastBackupAt.slice(0, 10), todayISO());
}
function backupStatusText() {
  const d = daysSinceBackup();
  if (d === null) return 'Never backed up';
  if (d <= 0) return 'Last backed up today';
  if (d === 1) return 'Last backed up yesterday';
  return `Last backed up ${d} days ago`;
}
function shouldRemindBackup() {
  if (Store.equipment().length === 0) return false;
  const snooze = Meta.data.snoozeUntil;
  if (snooze && daysBetween(todayISO(), snooze) > 0) return false; // still snoozed
  const d = daysSinceBackup();
  return d === null || d >= BACKUP_REMINDER_DAYS;
}
function backupReminderCard() {
  const d = daysSinceBackup();
  const msg = d === null
    ? "You haven't backed up your data yet."
    : `It's been ${d} days since your last backup.`;
  return el('div', { class: 'banner soon', style: 'flex-direction:column;align-items:stretch;gap:12px' },
    el('div', { style: 'display:flex;align-items:center;gap:14px' },
      el('div', { class: 'bignum' }, '💾'),
      el('div', {},
        el('div', { class: 'blabel' }, 'Time to back up'),
        el('div', { class: 'bsub' }, msg + ' Save a copy to your Files app.'))),
    el('div', { style: 'display:flex;gap:10px' },
      el('button', { class: 'btn small', style: 'flex:1', onclick: exportData }, 'Back Up Now'),
      el('button', { class: 'btn small secondary', style: 'flex:1', onclick: () => { Meta.snooze(); toast('Reminder snoozed'); router(); } }, 'Later')));
}

// Restore from a previously exported backup file.
function importData() {
  const input = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    input.remove();
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.equipment)) throw new Error('invalid');
        const photoCount = (parsed.photos || []).length;
        const counts = `${parsed.equipment.length} item(s), ${(parsed.records || []).length} record(s)`
          + (photoCount ? `, ${photoCount} photo(s)` : '');
        if (!confirm(`Restore this backup (${counts})?\n\nThis replaces ALL data currently on this device.`)) return;
        Store.data = {
          equipment: parsed.equipment || [],
          records: parsed.records || [],
          tasks: parsed.tasks || [],
          consumables: parsed.consumables || [],
          photos: parsed.photos || [],
        };
        Store.save();
        // restore photo image blobs into IndexedDB
        if (parsed.images) {
          for (const [id, dataUrl] of Object.entries(parsed.images)) {
            try { await ImageDB.put(id, dataUrl); } catch (e) { /* skip */ }
          }
        }
        toast('Backup restored');
        navigate('#/dashboard');
        router();
      } catch (e) {
        alert('That file is not a valid ShedLog backup.');
      }
    };
    reader.onerror = () => alert('Could not read that file.');
    reader.readAsText(f);
  });
  input.click();
}

function taskRow(x, showEquip) {
  const { task, st, eq } = x;
  return el('div', { class: 'row', onclick: () => openTaskActions(task) },
    el('span', { class: 'emoji' }, CATEGORIES[eq.category].emoji),
    el('div', { class: 'grow' },
      el('div', { class: 'primary' }, task.title),
      el('div', { class: 'secondary' }, showEquip ? `${eq.name} · due ${st.due}` : `Due ${st.due}`)),
    statusPill(st));
}

function equipmentRow(eq) {
  const tasks = Store.tasksFor(eq.id).map(taskStatus);
  const over = tasks.filter(t => t.status === 'over').length;
  const soon = tasks.filter(t => t.status === 'soon').length;
  const unit = UNIT_LABEL[eq.usageUnit];
  let sub = [eq.make, eq.model].filter(Boolean).join(' ') || CATEGORIES[eq.category].label;
  if (unit && eq.usageUnit !== 'none') sub += ` · ${fmtNum(eq.currentUsage || 0)} ${unit}`;

  const right = over ? el('span', { class: 'pill over' }, `${over} due`)
    : soon ? el('span', { class: 'pill soon' }, `${soon} soon`)
    : el('span', { class: 'chev' }, '›');

  return el('div', { class: 'row', onclick: () => navigate('#/equipment/' + encodeURIComponent(eq.id)) },
    el('span', { class: 'emoji' }, CATEGORIES[eq.category].emoji),
    el('div', { class: 'grow' },
      el('div', { class: 'primary' }, eq.name),
      el('div', { class: 'secondary' }, sub)),
    right);
}

function renderEquipmentList(view) {
  const eqs = Store.equipment();
  if (eqs.length === 0) {
    emptyState(view, '⚙', 'No equipment yet',
      'Add tractors, implements, tools and vehicles to start tracking their maintenance.',
      'Add Equipment', () => openEquipmentForm());
    return { title: 'Equipment' };
  }
  CATEGORY_ORDER.forEach(cat => {
    const inCat = eqs.filter(e => e.category === cat);
    if (!inCat.length) return;
    view.appendChild(el('div', { class: 'section-title' },
      `${CATEGORIES[cat].emoji} ${CATEGORIES[cat].label}s`));
    const card = el('div', { class: 'card' });
    inCat.forEach(eq => card.appendChild(equipmentRow(eq)));
    view.appendChild(card);
  });
  return { title: 'Equipment' };
}

function renderEquipmentDetail(view, id) {
  const eq = Store.getEquipment(id);
  if (!eq) { navigate('#/equipment'); return {}; }
  const cat = CATEGORIES[eq.category];
  const unit = UNIT_LABEL[eq.usageUnit];

  // Header
  const head = el('div', { class: 'detail-head' },
    el('div', { class: 'demoji' }, cat.emoji),
    el('h2', {}, eq.name),
    el('div', { class: 'dsub' }, [eq.year, eq.make, eq.model].filter(Boolean).join(' ') || cat.label));
  view.appendChild(head);

  // Stats
  const records = Store.recordsFor(eq.id);
  const stats = el('div', { class: 'usage-box' });
  if (eq.usageUnit !== 'none') {
    stats.appendChild(el('div', { class: 'stat' },
      el('div', { class: 'sval' }, fmtNum(eq.currentUsage || 0)),
      el('div', { class: 'slabel' }, unit)));
  }
  stats.appendChild(el('div', { class: 'stat' },
    el('div', { class: 'sval' }, String(Store.tasksFor(eq.id).length)),
    el('div', { class: 'slabel' }, 'Schedules')));
  stats.appendChild(el('div', { class: 'stat' },
    el('div', { class: 'sval' }, String(Store.consumablesFor(eq.id).length)),
    el('div', { class: 'slabel' }, 'Parts')));
  stats.appendChild(el('div', { class: 'stat' },
    el('div', { class: 'sval' }, String(records.length)),
    el('div', { class: 'slabel' }, 'Logged')));
  view.appendChild(stats);

  // Actions
  view.appendChild(el('div', { class: 'spacer' }));
  const actions = el('div', { class: 'stack' },
    el('button', { class: 'btn', onclick: () => openRecordForm(eq.id) }, '＋ Log Maintenance'),
    el('button', { class: 'btn secondary', onclick: () => openTaskForm(eq.id) }, '＋ Add Service Schedule'),
    el('button', { class: 'btn secondary', onclick: () => openConsumableForm(eq.id) }, '＋ Add Consumable / Part'),
    el('button', { class: 'btn secondary', onclick: () => addPhotoFlow(eq.id) }, '＋ Add Photo'));
  view.appendChild(actions);

  // Photos & locations (e.g. zerk fittings)
  const photos = Store.photosFor(eq.id);
  if (photos.length) {
    view.appendChild(el('div', { class: 'section-title' }, 'Photos & Locations'));
    const grid = el('div', { class: 'photo-grid' });
    photos.forEach(p => grid.appendChild(photoThumb(p)));
    view.appendChild(grid);
  }

  // Schedules
  const tasks = Store.tasksFor(eq.id)
    .map(t => ({ task: t, st: taskStatus(t) }))
    .sort((a, b) => a.st.sort - b.st.sort);
  if (tasks.length) {
    view.appendChild(el('div', { class: 'section-title' }, 'Service Schedules'));
    const card = el('div', { class: 'card' });
    tasks.forEach(({ task, st }) => {
      card.appendChild(el('div', { class: 'row', onclick: () => openTaskActions(task) },
        el('div', { class: 'grow' },
          el('div', { class: 'primary' }, task.title),
          el('div', { class: 'secondary' }, intervalText(task) + ' · next ' + st.due)),
        statusPill(st)));
    });
    view.appendChild(card);
  }

  // Consumables & parts reference
  const consumables = Store.consumablesFor(eq.id)
    .slice()
    .sort((a, b) => CONSUMABLE_ORDER.indexOf(a.type) - CONSUMABLE_ORDER.indexOf(b.type));
  if (consumables.length) {
    view.appendChild(el('div', { class: 'section-title' }, 'Consumables & Parts'));
    const card = el('div', { class: 'card' });
    consumables.forEach(c => card.appendChild(consumableRow(c)));
    view.appendChild(card);
  }

  // History
  if (records.length) {
    view.appendChild(el('div', { class: 'section-title' }, 'Maintenance History'));
    const card = el('div', { class: 'card' });
    records.forEach(r => card.appendChild(recordRow(r, eq)));
    view.appendChild(card);
  }

  // Edit / delete
  view.appendChild(el('div', { class: 'spacer' }));
  view.appendChild(el('div', { class: 'spacer' }));
  view.appendChild(el('div', { class: 'stack' },
    el('button', { class: 'btn secondary', onclick: () => openEquipmentForm(eq) }, 'Edit Details'),
    el('button', {
      class: 'btn danger',
      onclick: () => {
        if (confirm(`Delete "${eq.name}" and all its records? This cannot be undone.`)) {
          Store.deleteEquipment(eq.id);
          toast('Equipment deleted');
          navigate('#/equipment');
        }
      }
    }, 'Delete Equipment')));

  return { title: eq.name };
}

function intervalText(task) {
  const eq = Store.getEquipment(task.equipmentId);
  if (task.intervalType === 'usage') {
    const unit = UNIT_LABEL[eq?.usageUnit] || 'units';
    return `Every ${fmtNum(task.intervalValue)} ${unit}`;
  }
  const v = Number(task.intervalValue);
  if (v % 365 === 0 && v >= 365) return `Every ${v / 365} year${v / 365 > 1 ? 's' : ''}`;
  if (v % 30 === 0 && v >= 30) return `Every ${v / 30} month${v / 30 > 1 ? 's' : ''}`;
  if (v % 7 === 0 && v >= 7) return `Every ${v / 7} week${v / 7 > 1 ? 's' : ''}`;
  return `Every ${v} days`;
}

function recordRow(r, eq) {
  const bits = [fmtDate(r.date)];
  if (r.usageAtService != null && r.usageAtService !== '') bits.push(`${fmtNum(r.usageAtService)} ${UNIT_LABEL[eq.usageUnit] || ''}`.trim());
  if (r.cost != null && r.cost !== '') bits.push(fmtMoney(r.cost));
  return el('div', { class: 'row', onclick: () => openRecordView(r, eq) },
    el('div', { class: 'grow' },
      el('div', { class: 'primary' }, r.title),
      el('div', { class: 'secondary' }, bits.join(' · '))),
    el('span', { class: 'chev' }, '›'));
}

function consumableRow(c) {
  const type = CONSUMABLE_TYPES[c.type] || CONSUMABLE_TYPES.other;
  // Primary line: the spec/name (fallback to the type label).
  const primary = c.spec || type.label;
  // Secondary line: part number and quantity/capacity if present.
  const bits = [];
  if (c.partNumber) bits.push('#' + c.partNumber);
  if (c.qty) bits.push(c.qty);
  if (!bits.length) bits.push(type.label);

  let right;
  if (stockTracked(c)) {
    right = isLowStock(c)
      ? el('span', { class: 'pill over' }, Number(c.onHand) <= 0 ? 'Out' : `Low · ${fmtNum(c.onHand)}`)
      : el('span', { class: 'pill ok' }, `${fmtNum(c.onHand)} on hand`);
  } else {
    right = el('span', { class: 'chev' }, '›');
  }

  return el('div', { class: 'row', onclick: () => openConsumableForm(c.equipmentId, c) },
    el('span', { class: 'emoji' }, type.emoji),
    el('div', { class: 'grow' },
      el('div', { class: 'primary' }, primary),
      el('div', { class: 'secondary' }, bits.join(' · '))),
    right);
}

/* Stock-level helpers for consumables. */
function stockTracked(c) { return c.onHand !== '' && c.onHand != null; }
function isLowStock(c) {
  if (!stockTracked(c)) return false;
  const reorder = (c.reorderAt === '' || c.reorderAt == null) ? 0 : Number(c.reorderAt);
  return Number(c.onHand) <= reorder;
}
function lowStockConsumables() { return Store.data.consumables.filter(isLowStock); }

function renderHistory(view) {
  const all = Store.records()
    .map(r => ({ r, eq: Store.getEquipment(r.equipmentId) }))
    .filter(x => x.eq)
    .sort((a, b) => b.r.date.localeCompare(a.r.date));
  if (!all.length) {
    emptyState(view, '≣', 'No maintenance logged',
      'Once you log service on your equipment, every entry shows up here as a complete history.',
      null);
    return { title: 'History' };
  }

  const totalCost = all.reduce((s, x) => s + (Number(x.r.cost) || 0), 0);
  view.appendChild(el('div', { class: 'banner ok' },
    el('div', { class: 'bignum' }, String(all.length)),
    el('div', {},
      el('div', { class: 'blabel' }, 'Service records'),
      el('div', { class: 'bsub' }, totalCost > 0 ? `${fmtMoney(totalCost)} total spent` : 'across all equipment'))));

  // group by month
  let lastMonth = '';
  let card = null;
  all.forEach(({ r, eq }) => {
    const month = new Date(r.date + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
    if (month !== lastMonth) {
      lastMonth = month;
      view.appendChild(el('div', { class: 'section-title' }, month));
      card = el('div', { class: 'card' });
      view.appendChild(card);
    }
    card.appendChild(el('div', { class: 'row', onclick: () => openRecordView(r, eq) },
      el('span', { class: 'emoji' }, CATEGORIES[eq.category].emoji),
      el('div', { class: 'grow' },
        el('div', { class: 'primary' }, r.title),
        el('div', { class: 'secondary' }, `${eq.name} · ${fmtDate(r.date)}` + (r.cost ? ` · ${fmtMoney(r.cost)}` : ''))),
      el('span', { class: 'chev' }, '›')));
  });
  return { title: 'History' };
}

/* Equipment ids that currently have a due-soon or overdue schedule. */
function equipmentWithDueService() {
  const ids = new Set();
  Store.tasks().forEach(t => { if (taskStatus(t).status !== 'ok') ids.add(t.equipmentId); });
  return ids;
}

function renderShopping(view) {
  if (!Store.equipment().length) {
    emptyState(view, '🛒', 'Nothing to shop for yet',
      'Add equipment and list their consumables with an “On hand” count. When stock runs low — or service comes due — the parts to buy show up here.',
      null);
    return { title: 'Shopping List' };
  }

  const low = lowStockConsumables();
  const lowIds = new Set(low.map(c => c.id));
  // Parts needed for upcoming service = parts LINKED to due/overdue schedules (precise).
  const dueTasks = Store.tasks().filter(t => taskStatus(t).status !== 'ok');
  const serviceIds = new Set();
  dueTasks.forEach(t => (t.partIds || []).forEach(id => { if (!lowIds.has(id)) serviceIds.add(id); }));
  const serviceParts = [...serviceIds].map(id => Store.getConsumable(id)).filter(Boolean);

  if (!low.length && !serviceParts.length) {
    emptyState(view, '✅', 'Stock looks good',
      'Nothing is low and no service-due parts to grab. Track a part’s “On hand”/“Reorder at”, and link parts to a schedule, so due parts appear here.',
      null);
    return { title: 'Shopping List' };
  }

  const total = low.length + serviceParts.length;
  const estTotal = low.concat(serviceParts).reduce((s, c) => s + (Number(c.unitCost) || 0), 0);
  view.appendChild(el('div', { class: low.length ? 'banner over' : 'banner soon' },
    el('div', { class: 'bignum' }, String(total)),
    el('div', {},
      el('div', { class: 'blabel' }, total === 1 ? '1 item to buy' : `${total} items to buy`),
      el('div', { class: 'bsub' }, (low.length
        ? `${low.length} low/out` + (serviceParts.length ? ` · ${serviceParts.length} for service` : '')
        : 'For upcoming service') + (estTotal > 0 ? ` · est. ${fmtMoney(estTotal)}` : '')))));

  view.appendChild(el('div', { style: 'margin:10px 0 2px' },
    el('button', { class: 'btn secondary small', style: 'width:auto', onclick: () => shareShoppingList(low, serviceParts) }, '⬆️ Share / Copy list')));

  shoppingSection(view, 'Low / Out of Stock', low,
    c => el('span', { class: 'pill over' }, Number(c.onHand) <= 0 ? 'Out' : `${fmtNum(c.onHand)} left`), true);
  shoppingSection(view, 'For Upcoming Service', serviceParts,
    c => stockTracked(c) ? el('span', { class: 'pill ok' }, `${fmtNum(c.onHand)} on hand`) : el('span', { class: 'chev' }, '›'), false);

  view.appendChild(el('div', { class: 'center muted', style: 'margin-top:14px;padding:0 16px;line-height:1.4' },
    'Tap an item to edit it, or use Restock to update its on-hand count.'));
  return { title: 'Shopping List' };
}

function shoppingSection(view, heading, items, pillFor, withRestock) {
  if (!items.length) return;
  const sorted = items.slice().sort((a, b) => {
    const ea = Store.getEquipment(a.equipmentId), eb = Store.getEquipment(b.equipmentId);
    const na = ea ? ea.name : '', nb = eb ? eb.name : '';
    if (na !== nb) return na.localeCompare(nb);
    return CONSUMABLE_ORDER.indexOf(a.type) - CONSUMABLE_ORDER.indexOf(b.type);
  });
  view.appendChild(el('div', { class: 'section-title' }, heading));
  const card = el('div', { class: 'card' });
  sorted.forEach(c => {
    const eq = Store.getEquipment(c.equipmentId);
    const type = CONSUMABLE_TYPES[c.type] || CONSUMABLE_TYPES.other;
    const sub = [eq ? eq.name : ''];
    if (c.partNumber) sub.push('#' + c.partNumber);
    if (c.qty) sub.push(c.qty);
    if (Number(c.unitCost) > 0) sub.push(fmtMoney(c.unitCost));
    card.appendChild(el('div', { class: 'row', onclick: () => openConsumableForm(c.equipmentId, c) },
      el('span', { class: 'emoji' }, type.emoji),
      el('div', { class: 'grow' },
        el('div', { class: 'primary' }, c.spec || type.label),
        el('div', { class: 'secondary' }, sub.filter(Boolean).join(' · '))),
      pillFor(c),
      withRestock ? el('button', { class: 'btn small secondary', style: 'padding:7px 11px;margin-left:8px',
        onclick: (e) => { e.stopPropagation(); openRestock(c); } }, 'Restock') : null));
  });
  view.appendChild(card);
}

// Quick on-hand update from the shopping list.
function openRestock(c) {
  const eq = Store.getEquipment(c.equipmentId);
  const type = CONSUMABLE_TYPES[c.type] || CONSUMABLE_TYPES.other;
  openModal((sheet) => {
    const n = el('input', { type: 'number', value: c.onHand === '' ? '' : c.onHand, inputmode: 'decimal', step: 'any', placeholder: '0' });
    const bump = (d) => { n.value = String((Number(n.value) || 0) + d); };
    const save = () => {
      c.onHand = n.value === '' ? '' : Number(n.value);
      Store.upsertConsumable(c);
      closeModal(); toast('Stock updated'); router();
    };
    sheet.append(
      sheetHead('Restock', save),
      el('div', { class: 'muted', style: 'margin:0 4px 12px' }, `${type.emoji} ${c.spec || type.label}${eq ? ' · ' + eq.name : ''}`),
      field('On hand now', n, 'Set how many you have after restocking.'),
      el('div', { class: 'seg' },
        el('button', { onclick: () => bump(1) }, '+1'),
        el('button', { onclick: () => bump(5) }, '+5'),
        el('button', { onclick: () => bump(10) }, '+10')),
    );
  });
}

/* ------------------------------ Photos ------------------------------- */

function photoThumb(p) {
  const img = el('img', { alt: p.caption || 'photo', loading: 'lazy' });
  ImageDB.get(p.id).then(d => { if (d) img.src = d; }).catch(() => {});
  return el('div', { class: 'photo-tile', onclick: () => openPhotoView(p) },
    img,
    p.caption ? el('div', { class: 'photo-cap' }, p.caption) : null);
}

// Take/choose a photo, downscale it, then open the editor to add a location note.
function addPhotoFlow(eqId) {
  const input = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    input.remove();
    if (!f) return;
    toast('Processing photo…');
    try {
      const dataUrl = await fileToCompressedDataURL(f);
      openPhotoEditor(eqId, null, dataUrl);
    } catch (e) { alert('Could not read that image.'); }
  });
  input.click();
}

function openPhotoEditor(eqId, existing, newDataUrl) {
  openModal((sheet) => {
    const capI = el('input', { type: 'text', value: existing?.caption || '', placeholder: 'e.g. Front axle zerk — behind LH wheel' });
    const preview = el('img', { class: 'photo-preview' });
    if (newDataUrl) preview.src = newDataUrl;
    else if (existing) ImageDB.get(existing.id).then(d => { if (d) preview.src = d; }).catch(() => {});

    const save = async () => {
      if (existing) {
        existing.caption = capI.value.trim();
        Store.updatePhoto(existing);
      } else {
        const id = uid();
        try { await ImageDB.put(id, newDataUrl); }
        catch (e) { alert('Could not save the photo on this device.'); return; }
        Store.addPhoto({ id, equipmentId: eqId, caption: capI.value.trim(), createdAt: new Date().toISOString() });
      }
      closeModal(); toast('Photo saved'); router();
    };

    sheet.append(
      sheetHead(existing ? 'Edit Photo' : 'New Photo', save),
      preview,
      el('div', { class: 'spacer' }),
      field('Location / note', capI, 'Describe where this is so you can find it later.'),
      existing ? el('button', { class: 'btn danger', onclick: () => {
        if (confirm('Delete this photo?')) { Store.deletePhoto(existing.id); closeModal(); toast('Photo deleted'); router(); }
      } }, 'Delete Photo') : null,
    );
  });
}

function openPhotoView(p) {
  openModal((sheet) => {
    const img = el('img', { class: 'photo-preview' });
    ImageDB.get(p.id).then(d => { if (d) img.src = d; }).catch(() => {});
    sheet.append(
      el('div', { class: 'sheet-head' },
        el('button', { class: 'link plain', onclick: () => { closeModal(); openPhotoEditor(p.equipmentId, p, null); } }, 'Edit'),
        el('h3', {}, 'Photo'),
        el('button', { class: 'link plain', onclick: closeModal }, 'Done')),
      img,
      p.caption ? el('div', { class: 'card', style: 'padding:14px;font-size:15px;line-height:1.4;margin-top:12px' }, p.caption) : null,
    );
  });
}

async function shareShoppingList(low, serviceParts) {
  const line = (c) => {
    const type = CONSUMABLE_TYPES[c.type] || CONSUMABLE_TYPES.other;
    const eq = Store.getEquipment(c.equipmentId);
    const parts = [c.spec || type.label];
    if (c.partNumber) parts.push('#' + c.partNumber);
    if (c.qty) parts.push('(' + c.qty + ')');
    if (eq) parts.push('— ' + eq.name);
    return '  • ' + parts.join(' ');
  };
  let txt = 'Shopping list — ShedLog\n';
  if (low.length) txt += '\nLow / out of stock:\n' + low.map(line).join('\n') + '\n';
  if (serviceParts.length) txt += '\nFor upcoming service:\n' + serviceParts.map(line).join('\n') + '\n';

  try {
    if (navigator.share) { await navigator.share({ title: 'Shopping list', text: txt }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(txt); toast('List copied'); }
  catch (e) { alert(txt); }
}

/* ------------------------------ Modals ------------------------------- */

function openModal(buildSheet) {
  const modal = $('#modal');
  const sheet = $('#sheet');
  sheet.innerHTML = '';
  buildSheet(sheet);
  modal.hidden = false;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
}
function closeModal() { $('#modal').hidden = true; $('#sheet').innerHTML = ''; }

function sheetHead(title, onSave, saveLabel = 'Save') {
  return el('div', { class: 'sheet-head' },
    el('button', { class: 'link plain', onclick: closeModal }, 'Cancel'),
    el('h3', {}, title),
    onSave ? el('button', { class: 'link', onclick: onSave }, saveLabel) : el('span', { style: 'width:54px' }));
}

function field(labelText, inputNode, hint) {
  return el('div', { class: 'field' },
    el('label', {}, labelText),
    inputNode,
    hint ? el('div', { class: 'hint' }, hint) : null);
}

/* ---- Equipment form ---- */
function openEquipmentForm(existing) {
  const isEdit = !!existing;
  const eq = existing || {
    id: uid(), name: '', category: 'tractor', make: '', model: '', year: '',
    identifier: '', usageUnit: 'hours', currentUsage: '', notes: ''
  };
  let selectedCat = eq.category;
  let selectedUnit = eq.usageUnit;

  openModal((sheet) => {
    const nameI = el('input', { type: 'text', value: eq.name, placeholder: 'e.g. John Deere 5075E', enterkeyhint: 'done' });
    const makeI = el('input', { type: 'text', value: eq.make, placeholder: 'e.g. John Deere' });
    const modelI = el('input', { type: 'text', value: eq.model, placeholder: 'e.g. 5075E' });
    const yearI = el('input', { type: 'number', value: eq.year, placeholder: 'YYYY', inputmode: 'numeric' });
    const idI = el('input', { type: 'text', value: eq.identifier, placeholder: 'VIN / serial number' });
    const usageI = el('input', { type: 'number', value: eq.currentUsage, placeholder: '0', inputmode: 'decimal', step: 'any' });
    const notesI = el('textarea', { placeholder: 'Notes (optional)' }, eq.notes || '');

    const usageField = field('Current ' + (UNIT_LABEL[selectedUnit] || 'usage'), usageI);
    const unitSeg = el('div', { class: 'seg' },
      ...['hours', 'miles', 'none'].map(u =>
        el('button', { class: selectedUnit === u ? 'on' : '', onclick: () => {
          selectedUnit = u;
          unitSeg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', ['hours', 'miles', 'none'][i] === u));
          usageField.querySelector('label').textContent = 'Current ' + (UNIT_LABEL[u] || 'usage');
          usageField.style.display = u === 'none' ? 'none' : '';
        } }, u === 'none' ? 'No meter' : u.charAt(0).toUpperCase() + u.slice(1))));
    if (selectedUnit === 'none') usageField.style.display = 'none';

    const catGrid = el('div', { class: 'cat-grid' },
      ...CATEGORY_ORDER.map(c =>
        el('button', { class: selectedCat === c ? 'on' : '', onclick: () => {
          selectedCat = c;
          catGrid.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', CATEGORY_ORDER[i] === c));
          // suggest default unit when changing category (only on new equipment)
          if (!isEdit) {
            selectedUnit = CATEGORIES[c].defaultUnit;
            unitSeg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', ['hours', 'miles', 'none'][i] === selectedUnit));
            usageField.querySelector('label').textContent = 'Current ' + (UNIT_LABEL[selectedUnit] || 'usage');
            usageField.style.display = selectedUnit === 'none' ? 'none' : '';
          }
        } }, el('span', { class: 'cemoji' }, CATEGORIES[c].emoji), CATEGORIES[c].label)));

    const save = () => {
      if (!nameI.value.trim()) { toast('Please enter a name'); nameI.focus(); return; }
      Store.upsertEquipment({
        id: eq.id,
        name: nameI.value.trim(),
        category: selectedCat,
        make: makeI.value.trim(),
        model: modelI.value.trim(),
        year: yearI.value.trim(),
        identifier: idI.value.trim(),
        usageUnit: selectedUnit,
        currentUsage: selectedUnit === 'none' ? '' : (usageI.value === '' ? 0 : Number(usageI.value)),
        notes: notesI.value.trim(),
      });
      closeModal();
      toast(isEdit ? 'Saved' : 'Equipment added');
      router();
    };

    sheet.append(
      sheetHead(isEdit ? 'Edit Equipment' : 'New Equipment', save),
      field('Name', nameI),
      field('Category', catGrid),
      el('div', { class: 'field inline2' },
        el('div', {}, el('label', {}, 'Make'), makeI),
        el('div', {}, el('label', {}, 'Model'), modelI)),
      el('div', { class: 'field inline2' },
        el('div', {}, el('label', {}, 'Year'), yearI),
        el('div', {}, el('label', {}, 'Serial / VIN'), idI)),
      field('Usage meter', unitSeg),
      usageField,
      field('Notes', notesI),
    );
  });
}

/* Reusable checklist of an equipment's consumables; returns the node + a getter for selected ids. */
function partsChecklist(eqId, preselected) {
  const set = new Set(preselected || []);
  const items = Store.consumablesFor(eqId).slice()
    .sort((a, b) => CONSUMABLE_ORDER.indexOf(a.type) - CONSUMABLE_ORDER.indexOf(b.type));
  if (!items.length) {
    return { node: el('div', { class: 'muted', style: 'padding:2px 4px 6px' },
      'No parts saved for this machine yet — add consumables to link them here.'), getSelected: () => [] };
  }
  const card = el('div', { class: 'card' });
  const controls = items.map(c => {
    const type = CONSUMABLE_TYPES[c.type] || CONSUMABLE_TYPES.other;
    const chk = el('input', { type: 'checkbox', checked: set.has(c.id), style: 'width:auto;transform:scale(1.25)' });
    const label = (c.spec || type.label) + (c.partNumber ? ` · #${c.partNumber}` : '');
    card.appendChild(el('div', { class: 'row', style: 'cursor:pointer;gap:10px',
      onclick: (e) => { if (e.target !== chk) chk.checked = !chk.checked; } },
      chk,
      el('div', { class: 'grow' },
        el('div', { class: 'primary', style: 'font-size:15px' }, `${type.emoji}  ${label}`),
        el('div', { class: 'secondary' }, type.label))));
    return { c, chk };
  });
  return { node: card, getSelected: () => controls.filter(x => x.chk.checked).map(x => x.c.id) };
}

/* ---- Service schedule (task) form ---- */
function openTaskForm(eqId, existing) {
  const eq = Store.getEquipment(eqId);
  const isEdit = !!existing;
  const task = existing || {
    id: uid(), equipmentId: eqId, title: '',
    intervalType: eq.usageUnit === 'none' ? 'days' : 'usage',
    intervalValue: '', lastDoneDate: todayISO(), lastDoneUsage: eq.currentUsage || 0, partIds: [],
  };
  let intervalType = task.intervalType;
  const parts = partsChecklist(eqId, task.partIds);

  openModal((sheet) => {
    const titleI = el('input', { type: 'text', value: task.title, placeholder: 'e.g. Engine oil & filter' });
    const valueI = el('input', { type: 'number', value: task.intervalValue, placeholder: '0', inputmode: 'decimal', step: 'any' });
    const lastDateI = el('input', { type: 'date', value: task.lastDoneDate || todayISO() });
    const lastUsageI = el('input', { type: 'number', value: task.lastDoneUsage ?? '', placeholder: '0', inputmode: 'decimal', step: 'any' });

    const unit = UNIT_LABEL[eq.usageUnit];
    const canUsage = eq.usageUnit !== 'none';

    const valueField = field('', valueI);
    const updateValueLabel = () => {
      valueField.querySelector('label').textContent = intervalType === 'usage'
        ? `Interval (${unit})` : 'Interval (days)';
      valueI.placeholder = intervalType === 'usage' ? `e.g. 100` : `e.g. 90`;
    };

    const lastUsageField = field(`Last done at (${unit})`, lastUsageI,
      'Used to calculate when the next service is due.');
    const lastDateField = field('Last done on', lastDateI);

    const updateMode = () => {
      lastUsageField.style.display = intervalType === 'usage' ? '' : 'none';
      updateValueLabel();
    };

    const typeSeg = el('div', { class: 'seg' },
      el('button', { class: intervalType === 'usage' ? 'on' : '', disabled: !canUsage, onclick: () => {
        if (!canUsage) return; intervalType = 'usage';
        typeSeg.children[0].classList.add('on'); typeSeg.children[1].classList.remove('on'); updateMode();
      } }, `By ${unit || 'usage'}`),
      el('button', { class: intervalType === 'days' ? 'on' : '', onclick: () => {
        intervalType = 'days';
        typeSeg.children[1].classList.add('on'); typeSeg.children[0].classList.remove('on'); updateMode();
      } }, 'By time'));

    updateMode();

    const save = () => {
      if (!titleI.value.trim()) { toast('Enter a task name'); titleI.focus(); return; }
      if (!valueI.value || Number(valueI.value) <= 0) { toast('Enter an interval'); valueI.focus(); return; }
      Store.upsertTask({
        id: task.id,
        equipmentId: eqId,
        title: titleI.value.trim(),
        intervalType,
        intervalValue: Number(valueI.value),
        lastDoneDate: lastDateI.value || todayISO(),
        lastDoneUsage: intervalType === 'usage' ? Number(lastUsageI.value || 0) : (task.lastDoneUsage ?? 0),
        partIds: parts.getSelected(),
      });
      closeModal();
      toast(isEdit ? 'Schedule saved' : 'Schedule added');
      router();
    };

    sheet.append(
      sheetHead(isEdit ? 'Edit Schedule' : 'New Service Schedule', save),
      field('Task', titleI, 'e.g. Oil change, grease fittings, air filter'),
      field('Repeat', typeSeg, canUsage ? null : 'This item has no usage meter, so schedules are time-based.'),
      valueField,
      lastDateField,
      canUsage ? lastUsageField : null,
      el('div', { class: 'field' },
        el('label', {}, 'Parts this service needs'),
        parts.node,
        el('div', { class: 'hint' }, 'Linked parts are pre-checked when you log this service, and listed under it on the Shopping List.')),
      isEdit ? el('button', { class: 'btn danger', onclick: () => {
        if (confirm('Delete this schedule?')) { Store.deleteTask(task.id); closeModal(); toast('Schedule deleted'); router(); }
      } }, 'Delete Schedule') : null,
    );
  });
}

/* ---- Consumable / part form ---- */
function openConsumableForm(eqId, existing) {
  const isEdit = !!existing;
  const c = existing || { id: uid(), equipmentId: eqId, type: 'oil', spec: '', partNumber: '', qty: '', onHand: '', reorderAt: '', unitCost: '', notes: '' };
  let selectedType = c.type || 'oil';

  openModal((sheet) => {
    const specI = el('input', { type: 'text', value: c.spec || '', placeholder: 'e.g. 15W-40 / Donaldson P55' });
    const partI = el('input', { type: 'text', value: c.partNumber || '', placeholder: 'e.g. RE504836' });
    const qtyI = el('input', { type: 'text', value: c.qty || '', placeholder: 'e.g. 8.5 qt, 2 ea, 1/2" x 48"' });
    const onHandI = el('input', { type: 'number', value: c.onHand ?? '', placeholder: 'e.g. 2', inputmode: 'decimal', step: 'any' });
    const reorderI = el('input', { type: 'number', value: c.reorderAt ?? '', placeholder: 'e.g. 1', inputmode: 'decimal', step: 'any' });
    const costI = el('input', { type: 'number', value: c.unitCost ?? '', placeholder: '0.00', inputmode: 'decimal', step: 'any' });
    const notesI = el('textarea', { placeholder: 'Where it goes, brand preference, source…' }, c.notes || '');

    const specField = field('Spec / name', specI, 'The grade, size, or product — what to buy.');
    const updateSpecHint = () => {
      const t = CONSUMABLE_TYPES[selectedType];
      specI.placeholder = ({
        oil: 'e.g. 15W-40', hydoil: 'e.g. Hy-Gard / 303', grease: 'e.g. Moly EP2',
        fluid: 'e.g. DOT 3 brake fluid', filter: 'e.g. Donaldson P55-XXXX', belt: 'e.g. 1/2" x 48" V-belt',
        tire: 'e.g. 14.9-28 R1', battery: 'e.g. Group 65, 850 CCA', spark: 'e.g. NGK BPR6ES',
        blade: 'e.g. 1/4" chain, 72 DL', other: 'e.g. part name',
      })[selectedType] || 'e.g. grade or size';
    };

    const typeGrid = el('div', { class: 'cat-grid', style: 'grid-template-columns:1fr 1fr 1fr' },
      ...CONSUMABLE_ORDER.map(t =>
        el('button', { class: selectedType === t ? 'on' : '', onclick: () => {
          selectedType = t;
          typeGrid.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', CONSUMABLE_ORDER[i] === t));
          updateSpecHint();
        } }, el('span', { class: 'cemoji', style: 'font-size:24px' }, CONSUMABLE_TYPES[t].emoji),
           el('span', { style: 'font-size:12px' }, CONSUMABLE_TYPES[t].label))));
    updateSpecHint();

    const save = () => {
      if (!specI.value.trim() && !partI.value.trim()) {
        toast('Enter a spec or part number'); specI.focus(); return;
      }
      Store.upsertConsumable({
        id: c.id,
        equipmentId: eqId,
        type: selectedType,
        spec: specI.value.trim(),
        partNumber: partI.value.trim(),
        qty: qtyI.value.trim(),
        onHand: onHandI.value === '' ? '' : Number(onHandI.value),
        reorderAt: reorderI.value === '' ? '' : Number(reorderI.value),
        unitCost: costI.value === '' ? '' : Number(costI.value),
        notes: notesI.value.trim(),
      });
      closeModal();
      toast(isEdit ? 'Saved' : 'Part added');
      router();
    };

    sheet.append(
      sheetHead(isEdit ? 'Edit Part' : 'Add Consumable / Part', save),
      field('Type', typeGrid),
      specField,
      el('div', { class: 'field inline2' },
        el('div', {}, el('label', {}, 'Part number'), partI),
        el('div', {}, el('label', {}, 'Qty / capacity'), qtyI)),
      el('div', { class: 'field inline2' },
        el('div', {}, el('label', {}, 'On hand'), onHandI),
        el('div', {}, el('label', {}, 'Reorder at'), reorderI)),
      field('Unit cost', costI, 'Optional — used to estimate shopping totals.'),
      el('div', { class: 'hint', style: 'margin:-8px 4px 14px' }, 'Leave “On hand” blank to skip stock tracking. You’ll get a shopping-list alert when on-hand drops to the reorder level (or to 0).'),
      field('Notes', notesI),
      isEdit ? el('button', { class: 'btn danger', onclick: () => {
        if (confirm('Delete this part?')) { Store.deleteConsumable(c.id); closeModal(); toast('Part deleted'); router(); }
      } }, 'Delete Part') : null,
    );
  });
}

/* ---- Task quick-actions (mark done / edit) ---- */
function openTaskActions(task) {
  const eq = Store.getEquipment(task.equipmentId);
  const st = taskStatus(task);
  openModal((sheet) => {
    sheet.append(
      el('div', { class: 'sheet-head' },
        el('span', { style: 'width:54px' }),
        el('h3', {}, task.title),
        el('button', { class: 'link plain', onclick: closeModal }, 'Done')),
      el('div', { class: 'card', style: 'margin-bottom:14px' },
        el('div', { class: 'row', style: 'cursor:default' },
          el('div', { class: 'grow' },
            el('div', { class: 'primary' }, eq.name),
            el('div', { class: 'secondary' }, intervalText(task) + ' · next ' + st.due)),
          statusPill(st))),
      el('div', { class: 'stack' },
        el('button', { class: 'btn', onclick: () => { closeModal(); markTaskDone(task); } }, '✓ Mark Done Now'),
        el('button', { class: 'btn secondary', onclick: () => { closeModal(); openTaskForm(eq.id, task); } }, 'Edit Schedule'),
        el('button', { class: 'btn secondary', onclick: () => { closeModal(); navigate('#/equipment/' + encodeURIComponent(eq.id)); } }, 'View Equipment')),
    );
  });
}

// Marking done opens the log form pre-tied to this schedule (prefills title,
// pre-checks its linked parts, and resets the schedule's countdown on save).
function markTaskDone(task) {
  openRecordForm(task.equipmentId, { taskId: task.id, prefillUsage: Store.getEquipment(task.equipmentId)?.currentUsage || 0 });
}

/* ---- Maintenance record form ---- */
function openRecordForm(eqId, opts = {}) {
  const eq = Store.getEquipment(eqId);
  openModal((sheet) => {
    const titleI = el('input', { type: 'text', value: opts.title || '', placeholder: 'e.g. Oil change' });
    const dateI = el('input', { type: 'date', value: todayISO() });
    const usageI = el('input', { type: 'number', value: opts.prefillUsage ?? (eq.currentUsage || ''), placeholder: '0', inputmode: 'decimal', step: 'any' });
    const costI = el('input', { type: 'number', value: '', placeholder: '0.00', inputmode: 'decimal', step: 'any' });
    const notesI = el('textarea', { placeholder: 'Parts used, observations, who did it…' });

    const unit = UNIT_LABEL[eq.usageUnit];
    const updateUsageChk = el('input', { type: 'checkbox', checked: true, style: 'width:auto;transform:scale(1.3)' });

    // "Parts used" picker — built from this equipment's saved consumables.
    const consumables = Store.consumablesFor(eqId)
      .slice().sort((a, b) => CONSUMABLE_ORDER.indexOf(a.type) - CONSUMABLE_ORDER.indexOf(b.type));
    const partControls = consumables.map(c => {
      const type = CONSUMABLE_TYPES[c.type] || CONSUMABLE_TYPES.other;
      const chk = el('input', { type: 'checkbox', style: 'width:auto;transform:scale(1.25)' });
      const qtyN = el('input', { type: 'number', value: '1', min: '0', step: 'any', inputmode: 'decimal',
        disabled: true, style: 'width:62px;padding:8px;text-align:center' });
      const toggle = () => { qtyN.disabled = !chk.checked; };
      chk.addEventListener('change', toggle);
      const label = (c.spec || type.label) + (c.partNumber ? ` · #${c.partNumber}` : '');
      const stock = stockTracked(c) ? `${fmtNum(c.onHand)} on hand` : 'not stocked';
      const row = el('div', { class: 'row', style: 'cursor:pointer;gap:10px' },
        chk,
        el('div', { class: 'grow', onclick: () => { chk.checked = !chk.checked; toggle(); } },
          el('div', { class: 'primary', style: 'font-size:15px' }, `${type.emoji}  ${label}`),
          el('div', { class: 'secondary' }, `${type.label} · ${stock}`)),
        qtyN);
      return { c, chk, qtyN, row };
    });

    // Optional: tie this entry to one of the equipment's schedules.
    const tasks = Store.tasksFor(eqId);
    let selectedTaskId = opts.taskId || '';
    const setPartChecked = (cid, on) => {
      const pc = partControls.find(x => x.c.id === cid);
      if (pc) { pc.chk.checked = on; pc.qtyN.disabled = !on; }
    };
    const applyTask = (tid) => {
      const t = tasks.find(x => x.id === tid);
      if (!t) return;
      titleI.value = t.title;
      (t.partIds || []).forEach(cid => setPartChecked(cid, true));
    };
    const schedSelect = el('select', {},
      el('option', { value: '' }, '— General / no schedule —'),
      ...tasks.map(t => el('option', { value: t.id }, t.title)));
    schedSelect.value = selectedTaskId;
    schedSelect.addEventListener('change', () => { selectedTaskId = schedSelect.value; applyTask(selectedTaskId); });
    if (selectedTaskId) applyTask(selectedTaskId);

    const save = () => {
      if (!titleI.value.trim()) { toast('Enter what was done'); titleI.focus(); return; }
      const partsUsed = [];
      partControls.forEach(pc => {
        if (pc.chk.checked) {
          const used = pc.qtyN.value === '' ? 1 : Number(pc.qtyN.value);
          partsUsed.push({ consumableId: pc.c.id, name: pc.c.spec || CONSUMABLE_TYPES[pc.c.type].label, qty: used });
        }
      });
      const rec = {
        id: uid(),
        equipmentId: eqId,
        date: dateI.value || todayISO(),
        title: titleI.value.trim(),
        usageAtService: eq.usageUnit === 'none' ? '' : (usageI.value === '' ? '' : Number(usageI.value)),
        cost: costI.value === '' ? '' : Number(costI.value),
        notes: notesI.value.trim(),
      };
      if (partsUsed.length) rec.partsUsed = partsUsed;
      if (selectedTaskId) rec.taskId = selectedTaskId;
      Store.addRecord(rec);
      // deduct used parts from on-hand stock
      partsUsed.forEach(pu => {
        const c = Store.getConsumable(pu.consumableId);
        if (c && stockTracked(c)) {
          c.onHand = Math.max(0, Number(c.onHand) - Number(pu.qty || 0));
          Store.upsertConsumable(c);
        }
      });
      // if tied to a schedule, mark it done and reset its countdown
      if (selectedTaskId) {
        const t = Store.getTask(selectedTaskId);
        if (t) {
          t.lastDoneDate = rec.date;
          if (t.intervalType === 'usage') t.lastDoneUsage = Number(rec.usageAtService || eq.currentUsage || 0);
          Store.upsertTask(t);
        }
      }
      // optionally roll the equipment's current usage forward
      if (eq.usageUnit !== 'none' && updateUsageChk.checked && rec.usageAtService !== '' &&
          Number(rec.usageAtService) > Number(eq.currentUsage || 0)) {
        eq.currentUsage = Number(rec.usageAtService);
        Store.upsertEquipment(eq);
      }
      if (opts.onSaved) opts.onSaved(rec);
      closeModal();
      toast('Maintenance logged');
      router();
    };

    sheet.append(
      sheetHead('Log Maintenance', save),
      el('div', { class: 'muted', style: 'margin:0 4px 12px' }, eq.name),
      tasks.length ? field('For schedule', schedSelect, 'Pick a schedule to prefill this and mark it done.') : null,
      field('What was done', titleI),
      field('Date', dateI),
      eq.usageUnit !== 'none' ? field(`${unit.charAt(0).toUpperCase() + unit.slice(1)} reading`, usageI) : null,
      eq.usageUnit !== 'none'
        ? el('div', { class: 'field', style: 'display:flex;align-items:center;gap:10px' },
            updateUsageChk,
            el('label', { style: 'margin:0' }, `Update ${eq.name}'s current ${unit} to this reading`))
        : null,
      partControls.length ? el('div', { class: 'field' },
        el('label', {}, 'Parts used (deducts from stock)'),
        el('div', { class: 'card' }, ...partControls.map(pc => pc.row))) : null,
      field('Cost', costI, 'Optional — parts + labor'),
      field('Notes', notesI),
    );
  });
}

/* ---- View a single record ---- */
function openRecordView(r, eq) {
  openModal((sheet) => {
    const rows = [];
    rows.push(['Equipment', eq.name]);
    rows.push(['Date', fmtDate(r.date)]);
    if (r.usageAtService !== '' && r.usageAtService != null)
      rows.push([`${UNIT_LABEL[eq.usageUnit] || 'Usage'} reading`, `${fmtNum(r.usageAtService)} ${UNIT_LABEL[eq.usageUnit] || ''}`.trim()]);
    if (r.cost !== '' && r.cost != null) rows.push(['Cost', fmtMoney(r.cost)]);

    sheet.append(
      el('div', { class: 'sheet-head' },
        el('span', { style: 'width:54px' }),
        el('h3', {}, r.title),
        el('button', { class: 'link plain', onclick: closeModal }, 'Done')),
      el('div', { class: 'card' },
        ...rows.map(([k, v]) => el('div', { class: 'row', style: 'cursor:default' },
          el('div', { class: 'grow' }, el('div', { class: 'secondary' }, k), el('div', { class: 'primary' }, v))))),
      (r.partsUsed && r.partsUsed.length) ? el('div', { class: 'field', style: 'margin-top:14px' },
        el('label', {}, 'Parts used'),
        el('div', { class: 'card' }, ...r.partsUsed.map(p => el('div', { class: 'row', style: 'cursor:default' },
          el('div', { class: 'grow' }, el('div', { class: 'primary' }, p.name)),
          el('span', { class: 'muted' }, '×' + fmtNum(p.qty)))))) : null,
      r.notes ? el('div', { class: 'field', style: 'margin-top:14px' },
        el('label', {}, 'Notes'),
        el('div', { class: 'card', style: 'padding:14px;font-size:15px;line-height:1.4' }, r.notes)) : null,
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn danger', onclick: () => {
        if (confirm('Delete this record?')) { Store.deleteRecord(r.id); closeModal(); toast('Record deleted'); router(); }
      } }, 'Delete Record'),
    );
  });
}

/* ---- Add button (context-aware) ---- */
function handleAdd() {
  const path = currentRoute();
  if (path.startsWith('/equipment/')) {
    const id = decodeURIComponent(path.slice('/equipment/'.length));
    openRecordForm(id);
  } else {
    openEquipmentForm();
  }
}

/* ------------------------------ Boot --------------------------------- */

function init() {
  Store.load();
  Meta.load();

  $('#addBtn').addEventListener('click', handleAdd);
  $('#backBtn').addEventListener('click', () => history.back());
  document.querySelectorAll('.tab').forEach(tab =>
    tab.addEventListener('click', () => navigate(tab.dataset.route)));

  window.addEventListener('hashchange', router);
  if (!location.hash) location.hash = '#/dashboard';
  router();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
