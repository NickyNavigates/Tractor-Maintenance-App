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
const SOON_DAYS = 14;   // time-based task is "due soon" within this many days
const SOON_USAGE_FRACTION = 0.1; // usage-based task is "due soon" within 10% of interval

/* ------------------------------- Store ------------------------------- */

const STORE_KEY = 'shedlog.v1';

const Store = {
  data: { equipment: [], records: [], tasks: [] },

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) this.data = Object.assign({ equipment: [], records: [], tasks: [] }, JSON.parse(raw));
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
    this.data.equipment = this.data.equipment.filter(e => e.id !== id);
    this.data.records   = this.data.records.filter(r => r.equipmentId !== id);
    this.data.tasks     = this.data.tasks.filter(t => t.equipmentId !== id);
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
        el('div', { class: 'secondary' }, 'Back up all data as a file')),
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
  const payload = JSON.stringify({ app: 'ShedLog', version: 1, exportedAt: new Date().toISOString(), ...Store.data }, null, 2);

  // Preferred path on iOS: native share sheet with a file attachment.
  try {
    const file = new File([payload], filename, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'ShedLog Backup' });
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
    toast('Backup file created');
  } catch (e) {
    alert('Could not export the backup on this device.');
  }
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
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.equipment)) throw new Error('invalid');
        const counts = `${parsed.equipment.length} item(s), ${(parsed.records || []).length} record(s)`;
        if (!confirm(`Restore this backup (${counts})?\n\nThis replaces ALL data currently on this device.`)) return;
        Store.data = {
          equipment: parsed.equipment || [],
          records: parsed.records || [],
          tasks: parsed.tasks || [],
        };
        Store.save();
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
    el('div', { class: 'sval' }, String(records.length)),
    el('div', { class: 'slabel' }, 'Logged')));
  view.appendChild(stats);

  // Actions
  view.appendChild(el('div', { class: 'spacer' }));
  const actions = el('div', { class: 'stack' },
    el('button', { class: 'btn', onclick: () => openRecordForm(eq.id) }, '＋ Log Maintenance'),
    el('button', { class: 'btn secondary', onclick: () => openTaskForm(eq.id) }, '＋ Add Service Schedule'));
  view.appendChild(actions);

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

/* ---- Service schedule (task) form ---- */
function openTaskForm(eqId, existing) {
  const eq = Store.getEquipment(eqId);
  const isEdit = !!existing;
  const task = existing || {
    id: uid(), equipmentId: eqId, title: '',
    intervalType: eq.usageUnit === 'none' ? 'days' : 'usage',
    intervalValue: '', lastDoneDate: todayISO(), lastDoneUsage: eq.currentUsage || 0,
  };
  let intervalType = task.intervalType;

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
      isEdit ? el('button', { class: 'btn danger', onclick: () => {
        if (confirm('Delete this schedule?')) { Store.deleteTask(task.id); closeModal(); toast('Schedule deleted'); router(); }
      } }, 'Delete Schedule') : null,
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

// Marking done logs a record and resets the schedule's "last done" markers.
function markTaskDone(task) {
  const eq = Store.getEquipment(task.equipmentId);
  openRecordForm(eq.id, {
    title: task.title,
    prefillUsage: eq.currentUsage || 0,
    onSaved: (rec) => {
      task.lastDoneDate = rec.date;
      if (task.intervalType === 'usage') task.lastDoneUsage = Number(rec.usageAtService || eq.currentUsage || 0);
      Store.upsertTask(task);
    }
  });
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

    const save = () => {
      if (!titleI.value.trim()) { toast('Enter what was done'); titleI.focus(); return; }
      const rec = {
        id: uid(),
        equipmentId: eqId,
        date: dateI.value || todayISO(),
        title: titleI.value.trim(),
        usageAtService: eq.usageUnit === 'none' ? '' : (usageI.value === '' ? '' : Number(usageI.value)),
        cost: costI.value === '' ? '' : Number(costI.value),
        notes: notesI.value.trim(),
      };
      Store.addRecord(rec);
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
      field('What was done', titleI),
      field('Date', dateI),
      eq.usageUnit !== 'none' ? field(`${unit.charAt(0).toUpperCase() + unit.slice(1)} reading`, usageI) : null,
      eq.usageUnit !== 'none'
        ? el('div', { class: 'field', style: 'display:flex;align-items:center;gap:10px' },
            updateUsageChk,
            el('label', { style: 'margin:0' }, `Update ${eq.name}'s current ${unit} to this reading`))
        : null,
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
