/* ── State ─────────────────────────────────────────────────────────────────── */
let currentUser  = null;
let currentDb    = null;   // active database object when in records view
let allRecords   = [];     // full unfiltered record list for current db

/* ── API helper ────────────────────────────────────────────────────────────── */
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* ── Toast ─────────────────────────────────────────────────────────────────── */
function toast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 3000);
}

/* ── Modal ─────────────────────────────────────────────────────────────────── */
function openModal(title, bodyHTML, onSubmit, submitLabel = 'Save') {
  document.getElementById('modal-title').textContent = title;
  const body = document.getElementById('modal-body');
  body.innerHTML = bodyHTML;

  // Remove any previous footer
  const old = document.querySelector('.modal-footer');
  if (old) old.remove();

  if (onSubmit) {
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    footer.innerHTML = `
      <button class="btn btn-outline" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-submit">${submitLabel}</button>`;
    document.getElementById('modal-box').appendChild(footer);
    document.getElementById('modal-cancel').onclick = closeModal;
    document.getElementById('modal-submit').onclick = onSubmit;
  }

  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-box').classList.remove('modal-wide');
  const old = document.querySelector('.modal-footer');
  if (old) old.remove();
}

document.getElementById('modal-close-btn').onclick = closeModal;
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

/* ── Auth ──────────────────────────────────────────────────────────────────── */
document.getElementById('logout-btn').onclick = async () => {
  await api('POST', '/auth/logout');
  window.location.href = '/login';
};

/* ── Sidebar toggle ─────────────────────────────────────────────────────────── */
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
});

/* ── Navigation ────────────────────────────────────────────────────────────── */
document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    showView('view-' + btn.dataset.view);
    if (btn.dataset.view === 'dashboard')   loadDashboard();
    if (btn.dataset.view === 'databases')   loadDatabases();
    if (btn.dataset.view === 'users')       loadUsers();
    if (btn.dataset.view === 'activity')    loadActivity();
    if (btn.dataset.view === 'apikeys')     loadApiKeys();
    if (btn.dataset.view === 'query')       loadQuerySchema();
    if (btn.dataset.view === 'restapi')     loadRestApis();
    if (btn.dataset.view === 'threats')     loadThreats();
    if (btn.dataset.view === 'webhooks')    loadWebhooks();
    if (btn.dataset.view === 'credentials') loadCredentials();
  });
});

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* ── Boot ──────────────────────────────────────────────────────────────────── */
async function bootApp() {
  showScreen('app-screen');

  // Avatar with initials
  const avatar = document.getElementById('user-avatar');
  const initials = currentUser.username.slice(0, 2).toUpperCase();
  avatar.textContent = initials;
  const avatarColors = [
    ['#6574ff','#9da8ff'], ['#2dce89','#4deaaa'], ['#ffa94d','#ffc57a'],
    ['#f06565','#f58f8f'], ['#4dbbff','#7acfff'], ['#c46aff','#d994ff'],
  ];
  const ci = [...currentUser.username].reduce((s, c) => s + c.charCodeAt(0), 0) % avatarColors.length;
  avatar.style.background = `linear-gradient(135deg, ${avatarColors[ci][0]} 0%, ${avatarColors[ci][1]} 100%)`;

  // User badge
  const badge = document.getElementById('user-badge');
  badge.innerHTML = `<span class="user-display-name">${esc(currentUser.username)}</span>
    <span class="role-tag role-${currentUser.role}">${currentUser.role.toUpperCase()}</span>`;

  const role    = currentUser.role;
  const isAdmin  = role === 'admin';
  const isMember = role === 'member';

  // Admin-only
  document.getElementById('nav-users').style.display       = isAdmin ? '' : 'none';
  document.getElementById('nav-activity').style.display    = isAdmin ? '' : 'none';
  document.getElementById('nav-threats').style.display     = isAdmin ? '' : 'none';
  document.getElementById('nav-credentials').style.display = isAdmin ? '' : 'none';

  // Poll threat stats every 30s for admins so the badge stays fresh
  if (isAdmin) setInterval(refreshThreatBadge, 30_000);

  // Admin + member (not guest)
  document.getElementById('btn-create-db').style.display      = (isAdmin || isMember) ? '' : 'none';
  document.getElementById('btn-import-dataset').style.display = (isAdmin || isMember) ? '' : 'none';
  document.getElementById('nav-apikeys').style.display         = (isAdmin || isMember) ? '' : 'none';
  document.getElementById('nav-webhooks').style.display        = (isAdmin || isMember) ? '' : 'none';
  document.getElementById('btn-create-webhook').style.display  = (isAdmin || isMember) ? '' : 'none';

  showView('view-dashboard');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.nav-btn[data-view="dashboard"]').classList.add('active');

  await loadDashboard();
}

/* ── Initialise: check existing session ────────────────────────────────────── */
(async () => {
  try {
    currentUser = await api('GET', '/auth/me');
    bootApp();
  } catch (_) {
    window.location.href = '/login';
  }
})();

/* ── navigate() — programmatic nav helper ───────────────────────────────────── */
function navigate(view) {
  const btn = document.querySelector(`.nav-btn[data-view="${view}"]`);
  if (btn) btn.click();
}

/* ════════════════════════════════════════════════════════════════════════════
   DASHBOARD VIEW
   ════════════════════════════════════════════════════════════════════════════ */

/* SVG icon helpers — match the nav-icon style (20×20, stroke only, round caps) */
const _svgI = (path, extra = '') =>
  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${path}</svg>`;

const DASH_ICONS = {
  databases:   _svgI('<ellipse cx="10" cy="5.5" rx="6.5" ry="2.3"/><path d="M3.5 5.5v4c0 1.27 2.91 2.3 6.5 2.3s6.5-1.03 6.5-2.3v-4"/><path d="M3.5 9.5v4c0 1.27 2.91 2.3 6.5 2.3s6.5-1.03 6.5-2.3v-4"/>'),
  records:     _svgI('<path d="M5 3h7l3 3v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M12 3v4h4"/><path d="M7 10h6M7 13h4"/>'),
  users:       _svgI('<circle cx="8" cy="6.5" r="3"/><path d="M2 17c0-3.31 2.69-6 6-6s6 2.69 6 6"/><path d="M14.5 4.5a2.5 2.5 0 0 1 0 5"/><path d="M18 17a4 4 0 0 0-4-4"/>'),
  apiKeys:     _svgI('<circle cx="7.5" cy="10" r="4.5"/><path d="M12 10h6"/><path d="M15.5 7.5v5"/>'),
  webhooks:    _svgI('<circle cx="10" cy="10" r="7.5"/><path d="M7.5 10c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2"/>'),
  credentials: _svgI('<rect x="3" y="9" width="14" height="9" rx="2"/><path d="M7 9V6a3 3 0 0 1 6 0v3"/><circle cx="10" cy="13.5" r="1.2" fill="currentColor" stroke="none"/>'),
  threats:     _svgI('<path d="M10 2l7 4v5c0 4-3 6.5-7 8-4-1.5-7-4-7-8V6z"/><path d="M10 8v3"/><circle cx="10" cy="13" r=".7" fill="currentColor" stroke="none"/>'),
};

/* Activity dot colors by category */
const DASH_ACT_COLOR = {
  create: 'var(--success)',
  update: 'var(--accent)',
  delete: 'var(--danger)',
  import: 'var(--accent)',
  reveal: 'var(--warn)',
  login:  'var(--success)',
  logout: 'var(--text-muted)',
  default:'var(--text-muted)',
};

function _actColor(action) {
  if (action.startsWith('create') || action === 'login')  return DASH_ACT_COLOR.create;
  if (action.startsWith('update'))  return DASH_ACT_COLOR.update;
  if (action.startsWith('delete'))  return DASH_ACT_COLOR.delete;
  if (action === 'import_dataset')  return DASH_ACT_COLOR.import;
  if (action === 'reveal_credential') return DASH_ACT_COLOR.reveal;
  if (action === 'logout')          return DASH_ACT_COLOR.logout;
  return DASH_ACT_COLOR.default;
}

// Pre-resolved icon background tints (avoid relying on CSS color-mix)
const DASH_ICON_BG = {
  'var(--accent)':   'rgba(101,116,255,.15)',
  'var(--accent-h)': 'rgba(125,138,255,.15)',
  'var(--success)':  'rgba(45,206,137,.15)',
  'var(--warn)':     'rgba(255,169,77,.15)',
  'var(--danger)':   'rgba(240,101,101,.15)',
};

const DASH_STAT_META = {
  databases:   { label: 'Databases',   color: 'var(--accent)',    link: 'databases'   },
  records:     { label: 'Records',     color: 'var(--success)',   link: 'databases'   },
  users:       { label: 'Users',       color: 'var(--warn)',      link: 'users'       },
  apiKeys:     { label: 'API Keys',    color: 'var(--accent-h)',  link: 'apikeys'     },
  webhooks:    { label: 'Webhooks',    color: 'var(--accent)',    link: 'webhooks'    },
  credentials: { label: 'Credentials',color: 'var(--warn)',      link: 'credentials' },
};

const DASH_ACTION_META = {
  create_db:          { label: 'Created database'   },
  delete_db:          { label: 'Deleted database'   },
  create_record:      { label: 'Created record'     },
  update_record:      { label: 'Updated record'     },
  delete_record:      { label: 'Deleted record'     },
  import_dataset:     { label: 'Imported dataset'   },
  create_credential:  { label: 'Added credential'   },
  update_credential:  { label: 'Updated credential' },
  delete_credential:  { label: 'Deleted credential' },
  reveal_credential:  { label: 'Revealed credential'},
  create_user:        { label: 'Created user'       },
  delete_user:        { label: 'Deleted user'       },
  create_key:         { label: 'Generated API key'  },
  delete_key:         { label: 'Revoked API key'    },
  login:              { label: 'Logged in'          },
  logout:             { label: 'Logged out'         },
};

async function loadDashboard() {
  try {
    const { stats, topDatabases, recentActivity, threatStats } = await api('GET', '/dashboard');
    renderDashStats(stats, threatStats);
    renderDashTopDbs(topDatabases);
    renderDashActivity(recentActivity);
  } catch (err) {
    document.getElementById('dash-stats').innerHTML =
      `<p class="empty-state" style="color:var(--danger)">${esc(err.message)}</p>`;
  }
}

function renderDashStats(stats, threatStats) {
  const isAdmin = currentUser.role === 'admin';
  const grid = document.getElementById('dash-stats');

  const cards = Object.entries(DASH_STAT_META)
    .filter(([key]) => stats[key] !== null && stats[key] !== undefined)
    .map(([key, meta]) => {
      const val    = stats[key];
      const iconBg = DASH_ICON_BG[meta.color] || 'rgba(255,255,255,.07)';
      return `
        <button class="dash-stat-card" onclick="navigate('${meta.link}')" title="Go to ${meta.label}">
          <div class="dash-stat-icon" style="color:${meta.color};background:${iconBg}">${DASH_ICONS[key] || ''}</div>
          <div class="dash-stat-value">${val}</div>
          <div class="dash-stat-label">${meta.label}</div>
        </button>`;
    });

  if (isAdmin && threatStats) {
    const dangerBg = DASH_ICON_BG['var(--danger)'];
    const extra    = threatStats.blocked > 0 ? ' dash-stat-danger' : '';
    cards.push(`
      <button class="dash-stat-card${extra}" onclick="navigate('threats')" title="Go to Threat Monitor">
        <div class="dash-stat-icon" style="color:var(--danger);background:${dangerBg}">${DASH_ICONS.threats}</div>
        <div class="dash-stat-value">${threatStats.total}</div>
        <div class="dash-stat-label">Threats</div>
        ${threatStats.blocked > 0 ? `<div class="dash-stat-sub-blocked">${threatStats.blocked} blocked</div>` : ''}
      </button>`);
  }

  grid.innerHTML = cards.join('');
}

function renderDashTopDbs(dbs) {
  const el = document.getElementById('dash-top-dbs');
  if (!dbs.length) {
    el.innerHTML = '<p class="dash-empty">No databases yet.</p>';
    return;
  }
  const max = dbs[0].recordCount || 1;
  el.innerHTML = dbs.map(d => `
    <div class="dash-db-row" onclick="navigate('databases')" title="Browse ${esc(d.name)}">
      <span class="dash-db-name">${esc(d.name)}</span>
      <div class="dash-db-bar-wrap">
        <div class="dash-db-bar" style="width:${Math.max(4, Math.round((d.recordCount / max) * 100))}%"></div>
      </div>
      <span class="dash-db-count">${d.recordCount}</span>
    </div>`).join('');
}

function renderDashActivity(log) {
  const el = document.getElementById('dash-activity');
  if (!log.length) {
    el.innerHTML = '<p class="dash-empty">No activity yet.</p>';
    return;
  }
  el.innerHTML = log.map(entry => {
    const meta  = DASH_ACTION_META[entry.action] || { label: entry.action };
    const color = _actColor(entry.action);
    return `
      <div class="dash-activity-row">
        <span class="dash-act-dot" style="background:${color}"></span>
        <div class="dash-act-body">
          <span class="dash-act-label">${meta.label}</span>
          ${entry.target ? `<span class="dash-act-target"> — ${esc(entry.target)}</span>` : ''}
          <span class="dash-act-user">by ${esc(entry.user)}</span>
        </div>
        <span class="dash-act-time">${fmtDate(entry.timestamp)}</span>
      </div>`;
  }).join('');
}

document.getElementById('btn-refresh-dashboard').onclick = loadDashboard;
document.getElementById('dash-activity-link').onclick = () => navigate('activity');
document.getElementById('dash-qa-create-db').onclick = () => {
  navigate('databases');
  setTimeout(() => document.getElementById('btn-create-db').click(), 100);
};
document.getElementById('dash-qa-import').onclick = () => {
  navigate('databases');
  setTimeout(() => document.getElementById('btn-import-dataset').click(), 100);
};

/* ════════════════════════════════════════════════════════════════════════════
   DATABASE VIEW
   ════════════════════════════════════════════════════════════════════════════ */
async function loadDatabases() {
  const dbs  = await api('GET', '/databases');
  const list = document.getElementById('db-list');

  if (dbs.length === 0) {
    const canCreate = currentUser.role === 'admin' || currentUser.role === 'member';
    list.innerHTML = `<div class="empty-state">
      ${canCreate
        ? 'No databases yet. Click <b>+ New Database</b> to create one.'
        : 'No databases available yet.'}
    </div>`;
    return;
  }

  list.innerHTML = dbs.map(d => `
    <div class="db-card" data-id="${d.id}">
      <div class="db-card-name">${esc(d.name)}</div>
      <div class="db-card-meta">Created by ${esc(d.createdBy)} &bull; ${fmtDate(d.createdAt)}</div>
      <div class="db-card-count"><span class="record-count-badge">${d.recordCount ?? 0} record${(d.recordCount ?? 0) !== 1 ? 's' : ''}</span></div>
      <div class="db-card-fields">
        ${d.fields.map(f => `<span class="field-chip">${esc(f.name)}${f.required ? '<span style="color:var(--danger);font-size:.7rem">*</span>' : ''}<span class="badge badge-${f.type}" style="margin-left:4px">${f.type}</span></span>`).join('')}
      </div>
      <div class="db-card-actions" onclick="event.stopPropagation()">
        <button class="btn btn-sm btn-outline" onclick="openRecords('${d.id}')">&#128202; Open</button>
        ${currentUser.role === 'admin' ? `
          <button class="btn btn-sm btn-outline" onclick="editDatabase('${d.id}')">&#9998; Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteDatabase('${d.id}','${esc(d.name)}')">&#128465; Delete</button>
        ` : ''}
      </div>
    </div>`).join('');
}

// ── Create database ─────────────────────────────────────────────────────────
document.getElementById('btn-create-db').onclick = () => {
  openModal('Create New Database', buildDbForm(), async () => {
    const name   = document.getElementById('db-name-input').value.trim();
    const fields = collectFields();
    if (!name)            return toast('Database name is required', 'error');
    if (!fields.length)   return toast('Add at least one field', 'error');
    try {
      await api('POST', '/databases', { name, fields });
      closeModal();
      toast('Database created!', 'success');
      loadDatabases();
    } catch (err) { toast(err.message, 'error'); }
  }, 'Create');
};

function buildDbForm(db) {
  const nameVal   = db ? esc(db.name) : '';
  const fieldsHtml = db
    ? db.fields.map(f => fieldRow(f)).join('')
    : fieldRow();
  return `
    <label>Database Name</label>
    <input id="db-name-input" type="text" value="${nameVal}" placeholder="e.g. Products" />
    <label style="margin-top:18px">Fields</label>
    <div id="fields-list">${fieldsHtml}</div>
    <button type="button" class="btn btn-outline btn-sm" style="margin-top:8px" onclick="addFieldRow()">+ Add Field</button>`;
}

function fieldRow(f = {}) {
  const name     = f.name || '';
  const type     = f.type || 'string';
  const required = !!f.required;
  const hasConstraints = required || f.minLength != null || f.maxLength != null || f.pattern ||
    f.min != null || f.max != null || f.minDate || f.maxDate ||
    (Array.isArray(f.enumValues) && f.enumValues.length > 0);
  return `<div class="field-row">
    <div class="field-row-main">
      <input type="text" placeholder="field name" value="${esc(name)}" class="field-name" />
      <select class="field-type" onchange="updateConstraintsPanel(this)">
        ${['string','number','boolean','date'].map(t =>
          `<option value="${t}"${t===type?' selected':''}>${t}</option>`).join('')}
      </select>
      <label class="field-required-wrap" title="Required field">
        <input type="checkbox" class="field-required"${required?' checked':''} /> Req
      </label>
      <button type="button" class="btn-constraints-toggle${hasConstraints?' active':''}" onclick="toggleConstraints(this)" title="Validation rules">⚙</button>
      <button type="button" class="remove-field" onclick="this.closest('.field-row').remove()" title="Remove field">&times;</button>
    </div>
    <div class="field-constraints-panel${hasConstraints?'':' hidden'}">
      ${buildConstraintsPanel(type, f)}
    </div>
  </div>`;
}

function buildConstraintsPanel(type, f = {}) {
  let typeHtml = '';
  if (type === 'string') {
    typeHtml = `<div class="constraint-grid">
      <div>
        <label class="constraint-label">Min length</label>
        <input type="number" class="constraint-input fc-minLength" min="0" placeholder="0" value="${f.minLength != null ? f.minLength : ''}" />
      </div>
      <div>
        <label class="constraint-label">Max length</label>
        <input type="number" class="constraint-input fc-maxLength" min="0" placeholder="∞" value="${f.maxLength != null ? f.maxLength : ''}" />
      </div>
    </div>
    <label class="constraint-label">Pattern (regex)</label>
    <input type="text" class="constraint-input fc-pattern" placeholder="e.g. ^[a-z]+$" value="${esc(f.pattern || '')}" />`;
  } else if (type === 'number') {
    typeHtml = `<div class="constraint-grid">
      <div>
        <label class="constraint-label">Min value</label>
        <input type="number" class="constraint-input fc-min" step="any" placeholder="-∞" value="${f.min != null ? f.min : ''}" />
      </div>
      <div>
        <label class="constraint-label">Max value</label>
        <input type="number" class="constraint-input fc-max" step="any" placeholder="+∞" value="${f.max != null ? f.max : ''}" />
      </div>
    </div>`;
  } else if (type === 'date') {
    typeHtml = `<div class="constraint-grid">
      <div>
        <label class="constraint-label">Earliest date</label>
        <input type="date" class="constraint-input fc-minDate" value="${esc(f.minDate || '')}" />
      </div>
      <div>
        <label class="constraint-label">Latest date</label>
        <input type="date" class="constraint-input fc-maxDate" value="${esc(f.maxDate || '')}" />
      </div>
    </div>`;
  }
  return typeHtml + `<label class="constraint-label"${typeHtml ? ' style="margin-top:8px"' : ''}>Allowed values <span style="font-weight:400;opacity:.7">(comma-separated, leave blank for any)</span></label>
    <input type="text" class="constraint-input fc-enum" placeholder="e.g. draft, active, archived" value="${esc((Array.isArray(f.enumValues) ? f.enumValues : []).join(', '))}" />`;
}

function toggleConstraints(btn) {
  const panel = btn.closest('.field-row').querySelector('.field-constraints-panel');
  panel.classList.toggle('hidden');
  btn.classList.toggle('active');
}

function updateConstraintsPanel(select) {
  const panel = select.closest('.field-row').querySelector('.field-constraints-panel');
  panel.innerHTML = buildConstraintsPanel(select.value);
}

function addFieldRow() {
  document.getElementById('fields-list').insertAdjacentHTML('beforeend', fieldRow());
}

function collectFields() {
  const rows = document.querySelectorAll('#fields-list .field-row');
  const result = [];
  for (const row of rows) {
    const name = row.querySelector('.field-name').value.trim();
    const type = row.querySelector('.field-type').value;
    if (!name) continue;

    const field = { name, type };
    const reqEl = row.querySelector('.field-required');
    if (reqEl && reqEl.checked) field.required = true;

    const get = cls => { const el = row.querySelector(cls); return el ? el.value.trim() : ''; };

    if (type === 'string') {
      const minL = get('.fc-minLength'), maxL = get('.fc-maxLength'), pat = get('.fc-pattern');
      if (minL !== '') field.minLength = Number(minL);
      if (maxL !== '') field.maxLength = Number(maxL);
      if (pat)         field.pattern   = pat;
    } else if (type === 'number') {
      const min = get('.fc-min'), max = get('.fc-max');
      if (min !== '') field.min = Number(min);
      if (max !== '') field.max = Number(max);
    } else if (type === 'date') {
      const minD = get('.fc-minDate'), maxD = get('.fc-maxDate');
      if (minD) field.minDate = minD;
      if (maxD) field.maxDate = maxD;
    }

    const enumVal = get('.fc-enum');
    if (enumVal) field.enumValues = enumVal.split(',').map(s => s.trim()).filter(Boolean);

    result.push(field);
  }
  return result;
}

// ── Edit database ───────────────────────────────────────────────────────────
async function editDatabase(id) {
  const db = await api('GET', `/databases/${id}`);
  openModal('Edit Database', buildDbForm(db), async () => {
    const name   = document.getElementById('db-name-input').value.trim();
    const fields = collectFields();
    if (!name)          return toast('Database name is required', 'error');
    if (!fields.length) return toast('Add at least one field', 'error');
    try {
      await api('PUT', `/databases/${id}`, { name, fields });
      closeModal();
      toast('Database updated!', 'success');
      loadDatabases();
    } catch (err) { toast(err.message, 'error'); }
  }, 'Save Changes');
}

// ── Delete database ─────────────────────────────────────────────────────────
function deleteDatabase(id, name) {
  openModal('Confirm Delete', `<p>Delete database <b>${esc(name)}</b> and all its records? This cannot be undone.</p>`,
    async () => {
      try {
        await api('DELETE', `/databases/${id}`);
        closeModal();
        toast('Database deleted', 'success');
        loadDatabases();
      } catch (err) { toast(err.message, 'error'); }
    }, 'Delete');
}

/* ════════════════════════════════════════════════════════════════════════════
   RECORDS VIEW
   ════════════════════════════════════════════════════════════════════════════ */
async function openRecords(dbId) {
  currentDb = await api('GET', `/databases/${dbId}`);
  document.getElementById('records-db-name').textContent = currentDb.name;
  const isGuest = currentUser.role === 'guest';
  document.getElementById('btn-add-record').style.display = isGuest ? 'none' : '';
  showView('view-records');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  await loadRecords();
}

document.getElementById('btn-back-db').onclick = () => {
  document.getElementById('record-search').value = '';
  showView('view-databases');
  document.querySelector('.nav-btn[data-view="databases"]').classList.add('active');
};

// ── Search / filter records ──────────────────────────────────────────────────
document.getElementById('record-search').addEventListener('input', e => {
  const term = e.target.value.trim().toLowerCase();
  if (!term) { renderRecords(allRecords); return; }
  const filtered = allRecords.filter(r =>
    currentDb.fields.some(f => {
      const v = r.data[f.name];
      return v !== null && v !== undefined && String(v).toLowerCase().includes(term);
    }) || r.createdBy.toLowerCase().includes(term)
  );
  renderRecords(filtered);
});

// ── CSV export ───────────────────────────────────────────────────────────────
document.getElementById('btn-export-csv').onclick = () => {
  if (!currentDb || allRecords.length === 0) { toast('No records to export', 'error'); return; }
  const headers = currentDb.fields.map(f => f.name);
  const csvRows = [
    [...headers, 'createdBy', 'createdAt'].join(','),
    ...allRecords.map(r => [
      ...headers.map(h => {
        const v = r.data[h];
        if (v === null || v === undefined) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"` : s;
      }),
      r.createdBy,
      r.createdAt,
    ].join(',')),
  ];
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${currentDb.name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${allRecords.length} record(s) as CSV`, 'success');
};

async function loadRecords() {
  allRecords = await api('GET', `/databases/${currentDb.id}/records`);
  renderRecords(allRecords);
}

function renderRecords(records) {
  const wrap = document.getElementById('record-list');

  if (records.length === 0) {
    const term = document.getElementById('record-search').value.trim();
    wrap.innerHTML = `<p class="empty-state">${term
      ? `No records match "<b>${esc(term)}</b>".`
      : 'No records yet. Click <b>+ Add Record</b> to insert one.'}</p>`;
    return;
  }

  const headers = currentDb.fields.map(f =>
    `<th>${esc(f.name)} <span class="badge badge-${f.type}">${f.type}</span></th>`).join('');

  const rows = records.map(r => {
    const canEdit = currentUser.role !== 'guest' &&
      (currentUser.role === 'admin' || r.createdBy === currentUser.username);
    const cells   = currentDb.fields.map(f => {
      const v = r.data[f.name];
      return `<td>${v === null || v === undefined ? '<span style="color:var(--text-muted)">—</span>' : esc(String(v))}</td>`;
    }).join('');
    return `<tr>
      ${cells}
      <td><span style="color:var(--text-muted);font-size:.75rem">${esc(r.createdBy)}</span></td>
      <td>${fmtDate(r.updatedAt)}</td>
      <td>
        <div class="actions-cell">
          ${canEdit ? `<button class="btn-icon" title="Edit" onclick="editRecord('${r.id}')">&#9998;</button>` : ''}
          ${canEdit ? `<button class="btn-icon del" title="Delete" onclick="deleteRecord('${r.id}')">&#128465;</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `<table>
    <thead><tr>${headers}<th>Created By</th><th>Updated</th><th>Actions</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ── Add record ──────────────────────────────────────────────────────────────
document.getElementById('btn-add-record').onclick = () => {
  openModal(`Add Record to "${currentDb.name}"`, buildRecordForm(), async () => {
    const data = collectRecordData();
    try {
      await api('POST', `/databases/${currentDb.id}/records`, { data });
      closeModal();
      toast('Record added!', 'success');
      loadRecords();
    } catch (err) { toast(err.message, 'error'); }
  }, 'Add Record');
};

function buildRecordForm(record) {
  return currentDb.fields.map(f => {
    const val      = record ? (record.data[f.name] ?? '') : '';
    const reqMark  = f.required ? '<span style="color:var(--danger);margin-left:3px">*</span>' : '';
    const hint     = buildFieldHint(f);
    let input;
    if (f.enumValues && f.enumValues.length > 0) {
      input = `<select id="rf-${esc(f.name)}">
        <option value="">— select —</option>
        ${f.enumValues.map(v => `<option value="${esc(v)}"${String(val)===v?' selected':''}>${esc(v)}</option>`).join('')}
      </select>`;
    } else if (f.type === 'boolean') {
      input = `<select id="rf-${esc(f.name)}">
        <option value="">— select —</option>
        <option value="true"${val===true||val==='true'?' selected':''}>true</option>
        <option value="false"${val===false||val==='false'?' selected':''}>false</option>
      </select>`;
    } else if (f.type === 'date') {
      input = `<input id="rf-${esc(f.name)}" type="date" value="${esc(val)}"
        ${f.minDate ? `min="${esc(f.minDate)}"` : ''}
        ${f.maxDate ? `max="${esc(f.maxDate)}"` : ''} />`;
    } else if (f.type === 'number') {
      input = `<input id="rf-${esc(f.name)}" type="number" value="${esc(String(val))}" step="any"
        ${f.min != null ? `min="${f.min}"` : ''}
        ${f.max != null ? `max="${f.max}"` : ''} />`;
    } else {
      input = `<input id="rf-${esc(f.name)}" type="text" value="${esc(String(val))}"
        ${f.maxLength != null ? `maxlength="${f.maxLength}"` : ''} />`;
    }
    return `<label>${esc(f.name)}${reqMark} <span class="badge badge-${f.type}">${f.type}</span></label>${hint}${input}`;
  }).join('');
}

function buildFieldHint(f) {
  const parts = [];
  if (f.type === 'string') {
    if (f.minLength != null) parts.push(`min ${f.minLength} chars`);
    if (f.maxLength != null) parts.push(`max ${f.maxLength} chars`);
    if (f.pattern)           parts.push(`pattern: ${esc(f.pattern)}`);
  } else if (f.type === 'number') {
    if (f.min != null) parts.push(`min: ${f.min}`);
    if (f.max != null) parts.push(`max: ${f.max}`);
  } else if (f.type === 'date') {
    if (f.minDate) parts.push(`from: ${f.minDate}`);
    if (f.maxDate) parts.push(`to: ${f.maxDate}`);
  }
  if (f.enumValues && f.enumValues.length) parts.push(`allowed: ${f.enumValues.map(v => esc(v)).join(', ')}`);
  return parts.length ? `<div class="field-hint">${parts.join(' · ')}</div>` : '';
}

function collectRecordData() {
  const data = {};
  for (const f of currentDb.fields) {
    const el = document.getElementById(`rf-${f.name}`);
    data[f.name] = el ? el.value : '';
  }
  return data;
}

// ── Edit record ─────────────────────────────────────────────────────────────
async function editRecord(recordId) {
  const records = await api('GET', `/databases/${currentDb.id}/records`);
  const record  = records.find(r => r.id === recordId);
  if (!record) return toast('Record not found', 'error');

  openModal('Edit Record', buildRecordForm(record), async () => {
    const data = collectRecordData();
    try {
      await api('PUT', `/databases/${currentDb.id}/records/${recordId}`, { data });
      closeModal();
      toast('Record updated!', 'success');
      loadRecords();
    } catch (err) { toast(err.message, 'error'); }
  }, 'Save Changes');
}

// ── Delete record ───────────────────────────────────────────────────────────
function deleteRecord(recordId) {
  openModal('Confirm Delete', `<p>Delete this record? This cannot be undone.</p>`,
    async () => {
      try {
        await api('DELETE', `/databases/${currentDb.id}/records/${recordId}`);
        closeModal();
        toast('Record deleted', 'success');
        loadRecords();
      } catch (err) { toast(err.message, 'error'); }
    }, 'Delete');
}

/* ════════════════════════════════════════════════════════════════════════════
   USERS VIEW (admin only)
   ════════════════════════════════════════════════════════════════════════════ */
async function loadUsers() {
  const users = await api('GET', '/users');
  const wrap  = document.getElementById('user-list');

  wrap.innerHTML = `<table>
    <thead><tr><th>Username</th><th>Role</th><th>Actions</th></tr></thead>
    <tbody>${users.map(u => `<tr>
      <td>${esc(u.username)}</td>
      <td><span class="role-tag role-${u.role}">${u.role.toUpperCase()}</span></td>
      <td>
        <div class="actions-cell">
          <button class="btn-icon" onclick="editUser('${u.id}','${esc(u.username)}','${u.role}')">&#9998; Edit</button>
          ${u.username!=='admin'&&u.username!=='guest'
            ? `<button class="btn-icon del" onclick="deleteUser('${u.id}','${esc(u.username)}')">&#128465; Delete</button>`
            : ''}
        </div>
      </td>
    </tr>`).join('')}</tbody>
  </table>`;
}

document.getElementById('btn-create-user').onclick = () => {
  openModal('Create User', `
    <label>Username</label><input id="u-username" type="text" placeholder="username" />
    <label>Password</label><input id="u-password" type="password" placeholder="password" />
    <label>Role</label>
    <select id="u-role">
      <option value="guest">guest</option>
      <option value="admin">admin</option>
    </select>`,
    async () => {
      const username = document.getElementById('u-username').value.trim();
      const password = document.getElementById('u-password').value;
      const role     = document.getElementById('u-role').value;
      if (!username || !password) return toast('Username and password required', 'error');
      try {
        await api('POST', '/users', { username, password, role });
        closeModal();
        toast('User created!', 'success');
        loadUsers();
      } catch (err) { toast(err.message, 'error'); }
    }, 'Create');
};

function editUser(id, username, role) {
  openModal(`Edit User: ${username}`, `
    <label>New Password <span style="color:var(--text-muted)">(leave blank to keep)</span></label>
    <input id="u-edit-password" type="password" placeholder="new password" />
    <label>Role</label>
    <select id="u-edit-role">
      <option value="guest"${role==='guest'?' selected':''}>guest</option>
      <option value="admin"${role==='admin'?' selected':''}>admin</option>
    </select>`,
    async () => {
      const password = document.getElementById('u-edit-password').value;
      const newRole  = document.getElementById('u-edit-role').value;
      const body     = { role: newRole };
      if (password) body.password = password;
      try {
        await api('PUT', `/users/${id}`, body);
        closeModal();
        toast('User updated!', 'success');
        loadUsers();
      } catch (err) { toast(err.message, 'error'); }
    }, 'Save');
}

function deleteUser(id, username) {
  openModal('Confirm Delete', `<p>Delete user <b>${esc(username)}</b>? This cannot be undone.</p>`,
    async () => {
      try {
        await api('DELETE', `/users/${id}`);
        closeModal();
        toast('User deleted', 'success');
        loadUsers();
      } catch (err) { toast(err.message, 'error'); }
    }, 'Delete');
}

/* ════════════════════════════════════════════════════════════════════════════
   ACTIVITY LOG VIEW (admin only)
   ════════════════════════════════════════════════════════════════════════════ */
const ACTION_META = {
  create_db:     { icon: '📁', label: 'Created database',  color: 'var(--success)' },
  update_db:     { icon: '✏️',  label: 'Updated database',  color: 'var(--accent)'  },
  delete_db:     { icon: '🗑️',  label: 'Deleted database',  color: 'var(--danger)'  },
  create_record: { icon: '➕',  label: 'Added record',      color: 'var(--success)' },
  update_record: { icon: '🔄',  label: 'Updated record',    color: 'var(--accent)'  },
  delete_record: { icon: '❌',  label: 'Deleted record',    color: 'var(--danger)'  },
  create_key:    { icon: '🔑',  label: 'Created API key',   color: 'var(--success)' },
  delete_key:    { icon: '🚫',  label: 'Revoked API key',   color: 'var(--danger)'  },
};

async function loadActivity() {
  const list = document.getElementById('activity-list');
  list.innerHTML = `<p class="empty-state">Loading…</p>`;
  try {
    const log = await api('GET', '/activity');
    if (log.length === 0) {
      list.innerHTML = `<p class="empty-state">No activity recorded yet.</p>`;
      return;
    }
    list.innerHTML = `<div class="activity-timeline">${log.map(entry => {
      const meta = ACTION_META[entry.action] || { icon: '•', label: entry.action, color: 'var(--text-muted)' };
      return `<div class="activity-entry">
        <div class="activity-icon" style="color:${meta.color}">${meta.icon}</div>
        <div class="activity-body">
          <div class="activity-main">
            <span class="activity-label" style="color:${meta.color}">${meta.label}</span>
            <span class="activity-target">${esc(entry.target)}</span>
          </div>
          <div class="activity-detail">${esc(entry.detail)}</div>
          <div class="activity-meta">
            <span class="role-tag role-${entry.user === 'admin' ? 'admin' : 'guest'}">${esc(entry.user)}</span>
            <span>${fmtDate(entry.timestamp)}</span>
          </div>
        </div>
      </div>`;
    }).join('')}</div>`;
  } catch (err) {
    list.innerHTML = `<p class="empty-state" style="color:var(--danger)">${esc(err.message)}</p>`;
  }
}

document.getElementById('btn-refresh-activity').onclick = loadActivity;

/* ════════════════════════════════════════════════════════════════════════════
   API KEYS VIEW (all users)
   ════════════════════════════════════════════════════════════════════════════ */
async function loadApiKeys() {
  const wrap = document.getElementById('apikey-list');
  wrap.innerHTML = `<p class="empty-state">Loading…</p>`;
  try {
    const keys = await api('GET', '/keys');
    if (keys.length === 0) {
      wrap.innerHTML = `<p class="empty-state">No API keys yet. Click <b>+ Generate Key</b> to create one.</p>`;
      return;
    }
    wrap.innerHTML = `<table>
      <thead><tr><th>Name</th><th>Key Preview</th><th>Created</th><th>Last Used</th><th>Actions</th></tr></thead>
      <tbody>${keys.map(k => `<tr>
        <td><strong>${esc(k.name)}</strong></td>
        <td><code class="key-preview">${esc(k.keyPreview)}</code></td>
        <td>${fmtDate(k.createdAt)}</td>
        <td>${k.lastUsed ? fmtDate(k.lastUsed) : '<span style="color:var(--text-muted)">Never</span>'}</td>
        <td>
          <div class="actions-cell">
            <button class="btn-icon del" onclick="revokeApiKey('${k.id}','${esc(k.name)}')">&#128465; Revoke</button>
          </div>
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
  } catch (err) {
    wrap.innerHTML = `<p class="empty-state" style="color:var(--danger)">${esc(err.message)}</p>`;
  }
}

document.getElementById('btn-create-key').onclick = () => {
  openModal('Generate API Key', `
    <label>Key Name <span style="color:var(--text-muted);font-weight:400">(e.g. "My Script", "CI Pipeline")</span></label>
    <input id="key-name-input" type="text" placeholder="e.g. Production Script" maxlength="60" />`,
    async () => {
      const name = document.getElementById('key-name-input').value.trim();
      if (!name) return toast('Key name is required', 'error');
      try {
        const result = await api('POST', '/keys', { name });
        closeModal();
        // Show the key exactly once — user must copy it now
        openModal('Your New API Key', `
          <p style="color:var(--text-muted);font-size:.85rem;margin-bottom:12px">
            Copy this key now. It will <strong style="color:var(--danger)">not be shown again</strong>.
          </p>
          <div class="key-reveal-box">
            <code id="new-key-value">${esc(result.key)}</code>
            <button class="btn btn-sm btn-outline" onclick="copyApiKey()">&#128203; Copy</button>
          </div>
          <p style="color:var(--text-muted);font-size:.78rem;margin-top:10px">
            Use as: <code>X-API-Key: ${esc(result.key)}</code>
          </p>`, null);
        loadApiKeys();
        toast('API key created!', 'success');
      } catch (err) { toast(err.message, 'error'); }
    }, 'Generate');
};

function copyApiKey() {
  const val = document.getElementById('new-key-value').textContent;
  navigator.clipboard.writeText(val).then(() => toast('Key copied to clipboard!', 'success'));
}

function revokeApiKey(id, name) {
  openModal('Revoke API Key', `<p>Revoke key <b>${esc(name)}</b>? Any scripts using it will stop working.</p>`,
    async () => {
      try {
        await api('DELETE', `/keys/${id}`);
        closeModal();
        toast('API key revoked', 'success');
        loadApiKeys();
      } catch (err) { toast(err.message, 'error'); }
    }, 'Revoke');
}

/* ── Utilities ─────────────────────────────────────────────────────────────── */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
}

/* ════════════════════════════════════════════════════════════════════════════
   QUERY ENGINE
   ════════════════════════════════════════════════════════════════════════════ */

// ── Schema sidebar ────────────────────────────────────────────────────────────
async function loadQuerySchema() {
  const body = document.getElementById('schema-body');
  body.innerHTML = '<div class="schema-empty">Loading…</div>';
  try {
    const tables = await api('GET', '/query/schema');
    if (!tables.length) {
      body.innerHTML = '<div class="schema-empty">No tables yet.<br>Create a database first.</div>';
      return;
    }
    body.innerHTML = tables.map(t => `
      <div class="schema-table">
        <button class="schema-table-btn" onclick="insertTableQuery(${JSON.stringify(t.name)})" title="Click to generate SELECT query">
          <svg class="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <ellipse cx="10" cy="5.5" rx="6.5" ry="2.3"/>
            <path d="M3.5 5.5v4c0 1.27 2.91 2.3 6.5 2.3s6.5-1.03 6.5-2.3v-4"/>
            <path d="M3.5 9.5v4c0 1.27 2.91 2.3 6.5 2.3s6.5-1.03 6.5-2.3v-4"/>
          </svg>
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.name)}</span>
          <span class="schema-row-count">${t.recordCount}</span>
        </button>
        <div class="schema-fields">
          ${t.fields.map(f => `
            <div class="schema-field-row" onclick="insertFieldName(${JSON.stringify(f.name)})" title="Insert field name">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span>
              <span class="schema-field-type sft-${f.type}">${f.type}</span>
            </div>`).join('')}
        </div>
      </div>`).join('');
  } catch (err) {
    body.innerHTML = `<div class="schema-empty">${esc(err.message)}</div>`;
  }
}

function insertTableQuery(name) {
  const el = document.getElementById('query-input');
  const q = /\s/.test(name) ? `\`${name}\`` : name;
  el.value = `SELECT *\nFROM ${q}\nLIMIT 100`;
  el.focus();
}

function insertFieldName(name) {
  const el = document.getElementById('query-input');
  const start = el.selectionStart, end = el.selectionEnd;
  el.value = el.value.slice(0, start) + name + el.value.slice(end);
  el.selectionStart = el.selectionEnd = start + name.length;
  el.focus();
}

// ── Run query ─────────────────────────────────────────────────────────────────
document.getElementById('btn-run-query').addEventListener('click', runQuery);
document.getElementById('btn-clear-query').addEventListener('click', () => {
  document.getElementById('query-input').value = '';
  document.getElementById('query-results').innerHTML =
    '<div class="query-empty-state">Write a query above and press <strong>Run</strong> to see results.</div>';
  document.getElementById('query-input').focus();
});
document.getElementById('query-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runQuery(); }
});

async function runQuery() {
  const sql = document.getElementById('query-input').value.trim();
  if (!sql) return;

  const resultsEl = document.getElementById('query-results');
  resultsEl.innerHTML = `
    <div class="query-spinner">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M9 2a7 7 0 0 1 0 14"/>
      </svg>
      Running query…
    </div>`;

  try {
    const data = await api('POST', '/query', { sql });
    renderQueryResults(resultsEl, data);
  } catch (err) {
    resultsEl.innerHTML = `
      <div class="query-error-box">
        <strong>Error:</strong> ${esc(err.message)}
      </div>`;
  }
}

function renderQueryResults(el, { columns, rows, rowCount, elapsed, truncated }) {
  if (!columns.length) {
    el.innerHTML = '<div class="query-empty-state">Query returned no results.</div>';
    return;
  }

  const truncMsg = truncated
    ? `<span class="qm-trunc">⚠ Showing first 2,000 of ${rowCount.toLocaleString()} rows</span>`
    : '';

  const thead = `<thead><tr>${columns.map(c =>
    `<th>${esc(c)}</th>`).join('')}</tr></thead>`;

  const tbody = `<tbody>${rows.map(row =>
    `<tr>${columns.map(col => {
      const v = row[col];
      if (v === null || v === undefined) return `<td><span class="query-null">null</span></td>`;
      if (typeof v === 'boolean') return `<td><span class="query-bool-${v}">${v}</span></td>`;
      if (typeof v === 'number')  return `<td><span class="query-number">${v}</span></td>`;
      return `<td>${esc(String(v))}</td>`;
    }).join('')}</tr>`
  ).join('')}</tbody>`;

  el.innerHTML = `
    <div class="query-results-meta">
      <span class="qm-rows">↳ ${rowCount.toLocaleString()} row${rowCount !== 1 ? 's' : ''}</span>
      <span class="qm-time">${elapsed} ms</span>
      ${truncMsg}
      <button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="exportQueryCSV(${JSON.stringify(columns)}, this)">
        ↓ Export CSV
      </button>
    </div>
    <div class="query-results-table-wrap">
      <table>${thead}${tbody}</table>
    </div>`;

  // Store results for CSV export
  el._lastColumns = columns;
  el._lastRows    = rows;
}

function exportQueryCSV(columns, btn) {
  const el   = document.getElementById('query-results');
  const rows = el._lastRows || [];
  const header = columns.map(c => `"${c}"`).join(',');
  const body   = rows.map(row =>
    columns.map(c => {
      const v = row[c];
      if (v === null || v === undefined) return '';
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(',')
  ).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `query-results-${Date.now()}.csv`,
  });
  a.click(); URL.revokeObjectURL(a.href);
}

/* ════════════════════════════════════════════════════════════════════════════
   REST API GENERATOR VIEW
   ════════════════════════════════════════════════════════════════════════════ */

document.getElementById('btn-refresh-restapi').onclick = loadRestApis;

async function loadRestApis() {
  const wrap = document.getElementById('restapi-list');
  wrap.innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    const apis = await fetch('/api/v1').then(r => r.json());
    if (!apis.length) {
      wrap.innerHTML = '<div class="empty-state">No databases yet. Create a database first — its REST API will appear here automatically.</div>';
      return;
    }
    wrap.innerHTML = apis.map(api => renderApiCard(api)).join('');
  } catch (err) {
    wrap.innerHTML = `<p class="empty-state" style="color:var(--danger)">${esc(err.message)}</p>`;
  }
}

const METHOD_COLOR = { GET: '#2dce89', POST: '#6574ff', PUT: '#ffa94d', DELETE: '#f06565' };

function renderApiCard(api) {
  const baseUrl = window.location.origin + '/api/v1/' + api.slug;
  const exampleBody = api.fields.length
    ? JSON.stringify(Object.fromEntries(api.fields.map(f => [f.name, f.type === 'number' ? 0 : f.type === 'boolean' ? false : f.type === 'date' ? '2024-01-01' : 'value'])), null, 2)
    : '{}';

  const endpoints = [
    { method: 'GET',    path: baseUrl,         desc: 'List records',         curl: `curl -H "X-API-Key: YOUR_KEY" \\\n  "${baseUrl}?limit=50&offset=0"` },
    { method: 'GET',    path: baseUrl + '/:id', desc: 'Get record by ID',     curl: `curl -H "X-API-Key: YOUR_KEY" \\\n  "${baseUrl}/RECORD_ID"` },
    { method: 'POST',   path: baseUrl,          desc: 'Create record',        curl: `curl -X POST \\\n  -H "X-API-Key: YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${exampleBody.replace(/'/g, "\\'")}' \\\n  "${baseUrl}"` },
    { method: 'PUT',    path: baseUrl + '/:id', desc: 'Update record',        curl: `curl -X PUT \\\n  -H "X-API-Key: YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${exampleBody.replace(/'/g, "\\'")}' \\\n  "${baseUrl}/RECORD_ID"` },
    { method: 'DELETE', path: baseUrl + '/:id', desc: 'Delete record',        curl: `curl -X DELETE \\\n  -H "X-API-Key: YOUR_KEY" \\\n  "${baseUrl}/RECORD_ID"` },
  ];

  const endpointRows = endpoints.map((ep, i) => `
    <div class="api-endpoint-row">
      <span class="method-badge method-${ep.method}">${ep.method}</span>
      <code class="endpoint-path">${esc(ep.path)}</code>
      <span class="endpoint-desc">${esc(ep.desc)}</span>
      <div class="endpoint-actions">
        <button class="btn btn-sm btn-ghost" onclick="copyText(${JSON.stringify(ep.path.replace('/:id',''))})" title="Copy base URL">&#128203;</button>
        <button class="btn btn-sm btn-ghost" onclick="toggleCurl('curl-${api.slug}-${i}')" title="Show curl example">&lt;/&gt;</button>
      </div>
    </div>
    <div class="curl-block hidden" id="curl-${api.slug}-${i}">
      <button class="curl-copy-btn" onclick="copyText(${JSON.stringify(ep.curl)})" title="Copy">&#128203;</button>
      <pre>${esc(ep.curl)}</pre>
    </div>`).join('');

  const fieldChips = api.fields.map(f =>
    `<span class="field-chip">${esc(f.name)}${f.required ? '<span style="color:var(--danger);font-size:.7rem">*</span>' : ''}<span class="badge badge-${f.type}" style="margin-left:4px">${f.type}</span></span>`
  ).join('');

  return `
    <div class="api-card">
      <div class="api-card-header">
        <div>
          <div class="api-card-name">${esc(api.name)}</div>
          <div class="api-card-slug">
            <span class="api-slug-label">Base URL</span>
            <code class="api-base-url">${esc(baseUrl)}</code>
            <button class="btn btn-sm btn-ghost" onclick="copyText(${JSON.stringify(baseUrl)})" title="Copy base URL">&#128203;</button>
          </div>
        </div>
        <div class="api-card-meta">
          <span class="record-count-badge">${api.recordCount} record${api.recordCount !== 1 ? 's' : ''}</span>
          <span class="record-count-badge">${api.fields.length} field${api.fields.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <div class="api-field-chips">${fieldChips}</div>
      <div class="api-endpoints">${endpointRows}</div>
    </div>`;
}

function toggleCurl(id) {
  document.getElementById(id).classList.toggle('hidden');
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => toast('Copied!', 'success'));
}

/* ════════════════════════════════════════════════════════════════════════════
   THREAT MONITOR VIEW (admin only)
   ════════════════════════════════════════════════════════════════════════════ */

let _lastThreatCount = 0;

document.getElementById('btn-refresh-threats').onclick = loadThreats;
document.getElementById('btn-clear-threats').onclick   = async () => {
  if (!confirm('Clear the entire threat log? This cannot be undone.')) return;
  try {
    await api('DELETE', '/threats');
    _lastThreatCount = 0;
    hideThreatBadge();
    toast('Threat log cleared', 'success');
    loadThreats();
  } catch (err) { toast(err.message, 'error'); }
};

const THREAT_META = {
  sql_injection: { icon: '💉', label: 'SQL Injection',  severityDefault: 'critical' },
  xss_attempt:   { icon: '⚡', label: 'XSS Attempt',    severityDefault: 'high'     },
  rate_abuse:    { icon: '🔥', label: 'Rate Abuse',     severityDefault: 'high'     },
};

const SEVERITY_CLASS = {
  critical: 'sev-critical',
  high:     'sev-high',
  medium:   'sev-medium',
  low:      'sev-low',
};

async function loadThreats() {
  const statsEl = document.getElementById('threat-stats');
  const listEl  = document.getElementById('threat-list');
  listEl.innerHTML  = '<p class="empty-state">Loading…</p>';
  statsEl.innerHTML = '';

  try {
    const [threats, stats] = await Promise.all([
      api('GET', '/threats'),
      api('GET', '/threats/stats'),
    ]);

    _lastThreatCount = stats.total;

    // Stats row
    statsEl.innerHTML = `
      <div class="threat-stat-card">
        <div class="tsc-value">${stats.total}</div>
        <div class="tsc-label">Total Threats</div>
      </div>
      <div class="threat-stat-card">
        <div class="tsc-value" style="color:var(--warn)">${stats.last24h}</div>
        <div class="tsc-label">Last 24 h</div>
      </div>
      <div class="threat-stat-card">
        <div class="tsc-value" style="color:var(--danger)">${stats.blocked}</div>
        <div class="tsc-label">Requests Blocked</div>
      </div>
      <div class="threat-stat-card">
        <div class="tsc-value" style="color:${stats.activeBlocks > 0 ? 'var(--danger)' : 'var(--success)'}">${stats.activeBlocks}</div>
        <div class="tsc-label">Active IP Blocks</div>
      </div>
      <div class="threat-stat-card">
        <div class="tsc-value" style="color:var(--danger)">${stats.byType?.sql_injection || 0}</div>
        <div class="tsc-label">SQL Injections</div>
      </div>
      <div class="threat-stat-card">
        <div class="tsc-value" style="color:var(--warn)">${stats.byType?.xss_attempt || 0}</div>
        <div class="tsc-label">XSS Attempts</div>
      </div>
      <div class="threat-stat-card">
        <div class="tsc-value" style="color:#ffa94d">${stats.byType?.rate_abuse || 0}</div>
        <div class="tsc-label">Rate Abuses</div>
      </div>`;

    if (!threats.length) {
      listEl.innerHTML = '<p class="empty-state" style="padding:32px">No threats detected yet. Your application is clean.</p>';
      return;
    }

    const rows = threats.map(t => {
      const meta = THREAT_META[t.type] || { icon: '⚠️', label: t.type };
      const sevClass = SEVERITY_CLASS[t.severity] || 'sev-low';
      return `<tr>
        <td><span class="threat-severity ${sevClass}">${t.severity.toUpperCase()}</span></td>
        <td><span class="threat-type-icon">${meta.icon}</span> ${esc(meta.label)}</td>
        <td><code class="threat-ip">${esc(t.ip)}</code></td>
        <td>${t.username ? `<span class="role-tag role-guest">${esc(t.username)}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td><span class="threat-method method-${esc(t.method)}">${esc(t.method)}</span> <code style="font-size:.74rem;color:var(--text-muted)">${esc(t.endpoint)}</code></td>
        <td class="threat-detail">${esc(t.detail)}</td>
        <td>${t.blocked ? '<span class="blocked-badge">BLOCKED</span>' : '<span style="color:var(--text-muted)">logged</span>'}</td>
        <td style="color:var(--text-muted);font-size:.75rem;white-space:nowrap">${fmtDate(t.timestamp)}</td>
      </tr>`;
    }).join('');

    listEl.innerHTML = `<table>
      <thead><tr>
        <th>Severity</th><th>Type</th><th>IP</th><th>User</th>
        <th>Endpoint</th><th>Detail</th><th>Action</th><th>Time</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  } catch (err) {
    listEl.innerHTML = `<p class="empty-state" style="color:var(--danger)">${esc(err.message)}</p>`;
  }
}

async function refreshThreatBadge() {
  try {
    const stats = await api('GET', '/threats/stats');
    if (stats.total > _lastThreatCount) {
      const badge = document.getElementById('threat-badge');
      badge.textContent = stats.total > 99 ? '99+' : stats.total;
      badge.classList.remove('hidden');
    }
  } catch (_) { /* silent */ }
}

function hideThreatBadge() {
  document.getElementById('threat-badge').classList.add('hidden');
}

// Hide badge when the user opens the threats tab
document.querySelector('.nav-btn[data-view="threats"]').addEventListener('click', () => {
  hideThreatBadge();
});

/* ════════════════════════════════════════════════════════════════════════════
   WEBHOOKS VIEW
   ════════════════════════════════════════════════════════════════════════════ */

const WEBHOOK_EVENT_META = {
  'record.created':   { icon: '➕', label: 'Record Created',   color: 'var(--success)' },
  'record.updated':   { icon: '🔄', label: 'Record Updated',   color: 'var(--accent)'  },
  'record.deleted':   { icon: '🗑️', label: 'Record Deleted',   color: 'var(--danger)'  },
  'database.created': { icon: '📁', label: 'Database Created', color: 'var(--success)' },
  'database.deleted': { icon: '💥', label: 'Database Deleted', color: 'var(--danger)'  },
};

document.getElementById('btn-create-webhook').onclick = () => {
  const eventOpts = Object.entries(WEBHOOK_EVENT_META).map(([val, m]) =>
    `<option value="${val}">${m.icon} ${m.label}</option>`).join('');
  openModal('New Webhook', `
    <label>Name <span style="color:var(--text-muted);font-weight:400">(optional label)</span></label>
    <input id="wh-name" type="text" placeholder="e.g. Notify Slack" maxlength="60" />
    <label style="margin-top:14px">Event</label>
    <select id="wh-event">${eventOpts}</select>
    <label style="margin-top:14px">URL <span style="color:var(--danger)">*</span></label>
    <input id="wh-url" type="url" placeholder="https://myapp.com/webhook" />
    <label style="margin-top:14px">Secret <span style="color:var(--text-muted);font-weight:400">(optional — used for HMAC signature)</span></label>
    <input id="wh-secret" type="password" placeholder="leave blank to skip signing" />`,
    async () => {
      const name   = document.getElementById('wh-name').value.trim();
      const event  = document.getElementById('wh-event').value;
      const url    = document.getElementById('wh-url').value.trim();
      const secret = document.getElementById('wh-secret').value;
      if (!url) return toast('URL is required', 'error');
      try {
        await api('POST', '/webhooks', { name, event, url, secret: secret || undefined });
        closeModal();
        toast('Webhook registered!', 'success');
        loadWebhooks();
      } catch (err) { toast(err.message, 'error'); }
    }, 'Register');
};

async function loadWebhooks() {
  const wrap = document.getElementById('webhook-list');
  wrap.innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    const hooks = await api('GET', '/webhooks');
    if (!hooks.length) {
      wrap.innerHTML = '<div class="empty-state">No webhooks yet. Click <b>+ New Webhook</b> to subscribe to an event.</div>';
      return;
    }
    wrap.innerHTML = hooks.map(h => renderWebhookCard(h)).join('');
  } catch (err) {
    wrap.innerHTML = `<p class="empty-state" style="color:var(--danger)">${esc(err.message)}</p>`;
  }
}

function renderWebhookCard(h) {
  const meta = WEBHOOK_EVENT_META[h.event] || { icon: '📡', label: h.event, color: 'var(--text-muted)' };
  const lastD = h.lastDelivery;
  const lastStatus = lastD
    ? (lastD.success
        ? `<span class="wh-delivery-ok">✓ ${lastD.statusCode} · ${lastD.duration}ms</span>`
        : `<span class="wh-delivery-fail">✗ ${lastD.error || lastD.statusCode || 'Failed'}</span>`)
    : `<span style="color:var(--text-muted)">Never fired</span>`;

  return `
    <div class="webhook-card${h.active ? '' : ' wh-inactive'}" id="wh-${h.id}">
      <div class="wh-card-left">
        <div class="wh-top">
          <span class="wh-event-tag" style="color:${meta.color}">${meta.icon} ${esc(meta.label)}</span>
          ${h.name ? `<span class="wh-name">${esc(h.name)}</span>` : ''}
          ${h.active
            ? '<span class="wh-status-badge wh-active">ACTIVE</span>'
            : '<span class="wh-status-badge wh-paused">PAUSED</span>'}
        </div>
        <div class="wh-url-row">
          <code class="wh-url">${esc(h.url)}</code>
          <button class="btn btn-sm btn-ghost" onclick="copyText(${JSON.stringify(h.url)})" title="Copy URL">&#128203;</button>
        </div>
        <div class="wh-meta-row">
          <span class="wh-last-delivery">${lastStatus}</span>
          <span style="color:var(--text-muted);font-size:.73rem">Created ${fmtDate(h.createdAt)}</span>
          ${h.secret ? '<span class="wh-signed-badge">🔒 Signed</span>' : ''}
        </div>
      </div>
      <div class="wh-card-actions">
        <button class="btn btn-sm btn-outline" onclick="testWebhook('${h.id}')" title="Send test payload">&#9654; Test</button>
        <button class="btn btn-sm btn-outline" onclick="viewDeliveries('${h.id}','${esc(h.event)}')" title="Delivery log">&#128200; Log</button>
        <button class="btn btn-sm btn-outline" onclick="toggleWebhook('${h.id}',${h.active})">${h.active ? '&#9646;&#9646; Pause' : '&#9654; Resume'}</button>
        <button class="btn btn-sm btn-danger"  onclick="deleteWebhook('${h.id}','${esc(h.event)}')">&#128465;</button>
      </div>
    </div>`;
}

async function testWebhook(id) {
  try {
    await api('POST', `/webhooks/${id}/test`);
    toast('Test delivery sent!', 'success');
    setTimeout(loadWebhooks, 1500);  // refresh after delivery logs in
  } catch (err) { toast(err.message, 'error'); }
}

async function toggleWebhook(id, currentlyActive) {
  try {
    await api('PUT', `/webhooks/${id}`, { active: !currentlyActive });
    toast(currentlyActive ? 'Webhook paused' : 'Webhook resumed', 'success');
    loadWebhooks();
  } catch (err) { toast(err.message, 'error'); }
}

function deleteWebhook(id, event) {
  openModal('Delete Webhook', `<p>Remove the <b>${esc(event)}</b> webhook? Any future events will no longer be delivered to that URL.</p>`,
    async () => {
      try {
        await api('DELETE', `/webhooks/${id}`);
        closeModal();
        toast('Webhook deleted', 'success');
        loadWebhooks();
      } catch (err) { toast(err.message, 'error'); }
    }, 'Delete');
}

async function viewDeliveries(id, event) {
  try {
    const log = await api('GET', `/webhooks/${id}/deliveries`);
    const rows = log.length
      ? log.map(d => `<tr>
          <td>${d.success
            ? '<span class="wh-delivery-ok">✓ Success</span>'
            : '<span class="wh-delivery-fail">✗ Failed</span>'}</td>
          <td>${d.statusCode ?? '<span style="color:var(--text-muted)">—</span>'}</td>
          <td>${d.duration} ms</td>
          <td style="color:var(--danger);font-size:.76rem">${esc(d.error || '')}</td>
          <td style="color:var(--text-muted);font-size:.74rem;white-space:nowrap">${fmtDate(d.timestamp)}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No deliveries yet</td></tr>';

    openModal(`Delivery Log — ${esc(event)}`,
      `<div class="table-wrap"><table>
        <thead><tr><th>Status</th><th>HTTP</th><th>Duration</th><th>Error</th><th>Time</th></tr></thead>
        <tbody>${rows}</tbody>
       </table></div>`, null);
  } catch (err) { toast(err.message, 'error'); }
}

/* ── Dataset Import Wizard ──────────────────────────────────────────────────── */

// ── Parsers ──────────────────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV must have at least a header row and one data row');

  function splitCSVLine(line) {
    const cells = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = !inQ; }
      } else if (ch === ',' && !inQ) {
        cells.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    return cells;
  }

  const headers = splitCSVLine(lines[0]).map(h => sanitizeFieldName(h.trim()));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] !== undefined ? cells[idx].trim() : ''; });
    rows.push(row);
  }
  return { headers, rows };
}

function parseJSON(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { throw new Error('Invalid JSON: ' + e.message); }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) throw new Error('JSON array is empty');
    const headers = [...new Set(parsed.flatMap(r => Object.keys(r)))].map(sanitizeFieldName);
    const rows = parsed.map(r => {
      const row = {};
      headers.forEach(h => { row[h] = r[h] !== undefined ? r[h] : null; });
      return row;
    });
    return { headers, rows };
  }
  if (typeof parsed === 'object' && parsed !== null) {
    const vals = Object.values(parsed);
    if (Array.isArray(vals[0])) {
      // { col: [v1,v2,...] } column-oriented format
      const headers = Object.keys(parsed).map(sanitizeFieldName);
      const len = vals[0].length;
      const rows = [];
      for (let i = 0; i < len; i++) {
        const row = {};
        headers.forEach((h, hi) => { row[h] = vals[hi][i] !== undefined ? vals[hi][i] : null; });
        rows.push(row);
      }
      return { headers, rows };
    }
  }
  throw new Error('JSON must be an array of objects (or column-oriented object)');
}

function sanitizeFieldName(name) {
  return String(name).replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '').replace(/^_+|_+$/g, '') || 'field';
}

// ── Type inference ────────────────────────────────────────────────────────────

function inferType(values) {
  const nonEmpty = values.filter(v => v !== null && v !== undefined && v !== '');
  if (nonEmpty.length === 0) return 'string';

  const boolSet = new Set(['true', 'false', '1', '0', 'yes', 'no']);
  if (nonEmpty.every(v => boolSet.has(String(v).toLowerCase()))) return 'boolean';

  if (nonEmpty.every(v => !isNaN(Number(v)) && String(v).trim() !== '')) return 'number';

  const dateRe = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]*)?$|^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/;
  if (nonEmpty.every(v => dateRe.test(String(v).trim()))) return 'date';

  return 'string';
}

function inferFields(headers, rows) {
  return headers.map(h => {
    const vals = rows.map(r => r[h]);
    return { name: h, type: inferType(vals) };
  });
}

// ── State for import wizard ───────────────────────────────────────────────────

let _importParsed = null; // { headers, rows, fields }

// ── Step 1: drop zone ─────────────────────────────────────────────────────────

function openImportWizard() {
  _importParsed = null;
  document.getElementById('modal-box').classList.add('modal-wide');
  openModal('Import Dataset — Step 1: Upload File', `
    <div class="import-dropzone" id="import-drop">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" width="48" height="48" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <p class="import-drop-label">Drag &amp; drop a <strong>CSV</strong> or <strong>JSON</strong> file here</p>
      <p class="import-drop-sub">or</p>
      <label class="btn btn-outline import-file-btn" for="import-file-input">Browse file</label>
      <input type="file" id="import-file-input" accept=".csv,.json,text/csv,application/json" style="display:none" />
      <p class="import-drop-hint">Max 5 MB &nbsp;·&nbsp; Max 5,000 rows &nbsp;·&nbsp; CSV or JSON</p>
    </div>
    <div id="import-step1-error" class="import-error hidden"></div>
  `, null);

  const dropzone = document.getElementById('import-drop');
  const fileInput = document.getElementById('import-file-input');

  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('import-drop-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('import-drop-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('import-drop-over');
    const file = e.dataTransfer.files[0];
    if (file) handleImportFile(file);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleImportFile(fileInput.files[0]);
  });
}

function handleImportFile(file) {
  const errEl = document.getElementById('import-step1-error');
  errEl.classList.add('hidden');

  if (file.size > 5 * 1024 * 1024) {
    errEl.textContent = 'File is too large (max 5 MB)';
    errEl.classList.remove('hidden');
    return;
  }

  const ext = file.name.split('.').pop().toLowerCase();
  if (!['csv', 'json'].includes(ext)) {
    errEl.textContent = 'Only .csv and .json files are supported';
    errEl.classList.remove('hidden');
    return;
  }

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const text = e.target.result;
      const { headers, rows } = ext === 'csv' ? parseCSV(text) : parseJSON(text);
      if (rows.length > 5000) {
        errEl.textContent = `Too many rows (${rows.length}). Import limit is 5,000.`;
        errEl.classList.remove('hidden');
        return;
      }
      const fields = inferFields(headers, rows);
      _importParsed = { filename: file.name, headers, rows, fields };
      showImportStep2();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  };
  reader.onerror = () => {
    errEl.textContent = 'Failed to read file';
    errEl.classList.remove('hidden');
  };
  reader.readAsText(file);
}

// ── Step 2: configure + preview ───────────────────────────────────────────────

function showImportStep2() {
  const { filename, fields, rows } = _importParsed;
  const defaultName = filename.replace(/\.(csv|json)$/i, '').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Imported';

  const typeOpts = ['string', 'number', 'boolean', 'date']
    .map(t => `<option value="${t}">${t}</option>`).join('');

  const fieldRows = fields.map((f, i) => `
    <tr>
      <td><input class="import-field-name" data-idx="${i}" value="${esc(f.name)}" style="width:100%" /></td>
      <td>
        <select class="import-field-type" data-idx="${i}">
          ${['string','number','boolean','date'].map(t =>
            `<option value="${t}"${f.type === t ? ' selected' : ''}>${t}</option>`).join('')}
        </select>
      </td>
    </tr>`).join('');

  // Preview: first 5 rows
  const previewHeaders = fields.map(f => `<th>${esc(f.name)}</th>`).join('');
  const previewRows = rows.slice(0, 5).map(r =>
    `<tr>${fields.map(f => `<td>${esc(String(r[f.name] ?? ''))}</td>`).join('')}</tr>`
  ).join('');

  document.getElementById('modal-title').textContent = 'Import Dataset — Step 2: Configure';
  const body = document.getElementById('modal-body');
  body.innerHTML = `
    <div class="import-step2">
      <div class="import-section">
        <label class="import-label">Database Name</label>
        <input id="import-db-name" class="import-name-input" value="${esc(defaultName)}" placeholder="Dataset name" />
      </div>

      <div class="import-section">
        <label class="import-label">Field Configuration <span class="import-hint">(${fields.length} columns · ${rows.length} rows)</span></label>
        <div class="import-field-table-wrap">
          <table class="import-field-table">
            <thead><tr><th>Field Name</th><th>Type</th></tr></thead>
            <tbody>${fieldRows}</tbody>
          </table>
        </div>
      </div>

      <div class="import-section">
        <label class="import-label">Data Preview <span class="import-hint">(first 5 rows)</span></label>
        <div class="import-preview-wrap">
          <table class="import-preview-table">
            <thead><tr>${previewHeaders}</tr></thead>
            <tbody>${previewRows}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Update footer
  const oldFooter = document.querySelector('.modal-footer');
  if (oldFooter) oldFooter.remove();
  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  footer.innerHTML = `
    <button class="btn btn-outline" id="modal-cancel">Cancel</button>
    <button class="btn btn-ghost" id="import-back-btn">&#8592; Back</button>
    <button class="btn btn-primary" id="import-submit-btn">&#8679; Import ${rows.length} Rows</button>`;
  document.getElementById('modal-box').appendChild(footer);

  document.getElementById('modal-cancel').onclick = closeModal;
  document.getElementById('import-back-btn').onclick = () => {
    _importParsed = null;
    openImportWizard();
  };
  document.getElementById('import-submit-btn').onclick = doImport;
}

// ── Submit import ─────────────────────────────────────────────────────────────

async function doImport() {
  const nameEl = document.getElementById('import-db-name');
  const name = nameEl ? nameEl.value.trim() : '';
  if (!name) { toast('Database name is required', 'error'); return; }

  // Collect updated field names + types from the form
  const nameInputs = document.querySelectorAll('.import-field-name');
  const typeSelects = document.querySelectorAll('.import-field-type');
  const fields = [];
  for (let i = 0; i < nameInputs.length; i++) {
    const fname = nameInputs[i].value.trim();
    const ftype = typeSelects[i].value;
    if (!fname) { toast('All field names are required', 'error'); return; }
    fields.push({ name: fname, type: ftype });
  }

  // Remap rows with updated field names
  const oldFields = _importParsed.fields;
  const rows = _importParsed.rows.map(row => {
    const newRow = {};
    fields.forEach((f, i) => { newRow[f.name] = row[oldFields[i].name]; });
    return newRow;
  });

  const btn = document.getElementById('import-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Importing…';

  try {
    const result = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, fields, rows }),
    });
    const data = await result.json().catch(() => ({}));
    if (!result.ok) throw new Error(data.error || 'Import failed');

    closeModal();
    document.getElementById('modal-box').classList.remove('modal-wide');
    toast(`Imported "${name}": ${data.imported} rows`, 'success');
    loadDatabases();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = `↑ Import ${rows.length} Rows`;
    toast(err.message, 'error');
  }
}

// ── Wire up the button ────────────────────────────────────────────────────────

document.getElementById('btn-import-dataset').onclick = openImportWizard;

/* ── Credentials Vault ──────────────────────────────────────────────────────── */

async function loadCredentials() {
  const wrap = document.getElementById('credential-list');
  wrap.innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    const creds = await api('GET', '/credentials');
    if (!creds.length) {
      wrap.innerHTML = '<p class="empty-state">No credentials stored yet. Click <strong>+ Add Credential</strong> to store your first secret.</p>';
      return;
    }
    wrap.innerHTML = creds.map(renderCredentialCard).join('');
  } catch (err) { wrap.innerHTML = `<p class="empty-state" style="color:var(--danger)">${esc(err.message)}</p>`; }
}

function renderCredentialCard(c) {
  const age = fmtDate(c.updatedAt || c.createdAt);
  return `
    <div class="cred-card" id="cred-${c.id}">
      <div class="cred-main">
        <div class="cred-header">
          <span class="cred-name">${esc(c.name)}</span>
          <span class="cred-meta">by ${esc(c.createdBy)} · ${age}</span>
        </div>
        ${c.description ? `<p class="cred-desc">${esc(c.description)}</p>` : ''}
        <div class="cred-value-row">
          <span class="cred-mask" id="cval-${c.id}">••••••••••••</span>
          <button class="btn btn-ghost btn-sm cred-reveal-btn" onclick="revealCredential('${c.id}')">&#128065; Reveal</button>
          <button class="btn btn-ghost btn-sm cred-copy-btn hidden" id="ccopy-${c.id}" onclick="copyCredential('${c.id}')">&#128203; Copy</button>
        </div>
      </div>
      <div class="cred-actions">
        <button class="btn btn-outline btn-sm" onclick="editCredential('${c.id}', '${esc(c.name)}', '${esc(c.description || '')}')">&#9998; Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCredential('${c.id}', '${esc(c.name)}')">&#128465; Delete</button>
      </div>
    </div>`;
}

async function revealCredential(id) {
  try {
    const { value } = await api('GET', `/credentials/${id}/reveal`);
    const maskEl  = document.getElementById(`cval-${id}`);
    const copyBtn = document.getElementById(`ccopy-${id}`);
    maskEl.textContent  = value;
    maskEl.classList.add('cred-revealed');
    copyBtn.classList.remove('hidden');
    copyBtn.dataset.value = value;
    // Auto-hide after 30 seconds
    setTimeout(() => {
      maskEl.textContent  = '••••••••••••';
      maskEl.classList.remove('cred-revealed');
      copyBtn.classList.add('hidden');
      delete copyBtn.dataset.value;
    }, 30_000);
  } catch (err) { toast(err.message, 'error'); }
}

function copyCredential(id) {
  const btn = document.getElementById(`ccopy-${id}`);
  const value = btn.dataset.value;
  if (!value) return;
  navigator.clipboard.writeText(value).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = '&#10003; Copied';
    setTimeout(() => { btn.innerHTML = orig; }, 1500);
  }).catch(() => toast('Clipboard access denied', 'error'));
}

function openAddCredentialModal() {
  openModal('Add Credential', `
    <div class="form-group">
      <label class="form-label">Name <span style="color:var(--danger)">*</span></label>
      <input id="cred-name-inp" class="input" placeholder="e.g. Stripe API Key" />
    </div>
    <div class="form-group">
      <label class="form-label">Value <span style="color:var(--danger)">*</span></label>
      <div style="position:relative">
        <input id="cred-value-inp" class="input" type="password" placeholder="sk_live_…" style="padding-right:80px" />
        <button type="button" class="btn btn-ghost btn-sm" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:.74rem"
          onclick="this.previousElementSibling.type=this.previousElementSibling.type==='password'?'text':'password';this.textContent=this.previousElementSibling.type==='password'?'Show':'Hide'">Show</button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Description <span style="color:var(--text-muted)">(optional)</span></label>
      <input id="cred-desc-inp" class="input" placeholder="What is this used for?" />
    </div>
  `, async () => {
    const name  = document.getElementById('cred-name-inp').value.trim();
    const value = document.getElementById('cred-value-inp').value;
    const desc  = document.getElementById('cred-desc-inp').value.trim();
    if (!name)  { toast('Name is required', 'error'); return; }
    if (!value) { toast('Value is required', 'error'); return; }
    try {
      await api('POST', '/credentials', { name, value, description: desc });
      closeModal();
      toast('Credential saved', 'success');
      loadCredentials();
    } catch (err) { toast(err.message, 'error'); }
  }, 'Save');
}

function editCredential(id, currentName, currentDesc) {
  openModal('Edit Credential', `
    <div class="form-group">
      <label class="form-label">Name</label>
      <input id="cred-edit-name" class="input" value="${esc(currentName)}" />
    </div>
    <div class="form-group">
      <label class="form-label">New Value <span style="color:var(--text-muted)">(leave blank to keep existing)</span></label>
      <div style="position:relative">
        <input id="cred-edit-value" class="input" type="password" placeholder="Enter new value to update…" style="padding-right:80px" />
        <button type="button" class="btn btn-ghost btn-sm" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:.74rem"
          onclick="this.previousElementSibling.type=this.previousElementSibling.type==='password'?'text':'password';this.textContent=this.previousElementSibling.type==='password'?'Show':'Hide'">Show</button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <input id="cred-edit-desc" class="input" value="${esc(currentDesc)}" />
    </div>
  `, async () => {
    const updates = {};
    const name  = document.getElementById('cred-edit-name').value.trim();
    const value = document.getElementById('cred-edit-value').value;
    const desc  = document.getElementById('cred-edit-desc').value.trim();
    if (name)  updates.name = name;
    if (value) updates.value = value;
    updates.description = desc;
    try {
      await api('PUT', `/credentials/${id}`, updates);
      closeModal();
      toast('Credential updated', 'success');
      loadCredentials();
    } catch (err) { toast(err.message, 'error'); }
  }, 'Update');
}

function deleteCredential(id, name) {
  openModal('Delete Credential', `
    <p>Are you sure you want to permanently delete <strong>${esc(name)}</strong>?</p>
    <p style="color:var(--text-muted);font-size:.84rem;margin-top:8px">This cannot be undone.</p>
  `, async () => {
    try {
      await api('DELETE', `/credentials/${id}`);
      closeModal();
      toast('Credential deleted', 'success');
      loadCredentials();
    } catch (err) { toast(err.message, 'error'); }
  }, 'Delete');
}

document.getElementById('btn-add-credential').onclick = openAddCredentialModal;

