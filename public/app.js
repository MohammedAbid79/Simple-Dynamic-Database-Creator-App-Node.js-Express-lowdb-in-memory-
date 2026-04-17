/* ── State ─────────────────────────────────────────────────────────────────── */
let currentUser  = null;
let currentDb    = null;   // active database object when in records view
let allRecords   = [];     // full unfiltered record list for current db

/* ── Shared SVG icon snippets for dynamically generated HTML ──────────────── */
const IC = {
  refresh:  `<svg class="bi" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7a5 5 0 1 1-.9-2.9"/><polyline points="12 2 12 5 9 5"/></svg>`,
  edit:     `<svg class="bi" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5l2 2L4 12H2v-2z"/><path d="M8 4l2 2"/></svg>`,
  trash:    `<svg class="bi" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1.5 3.5 12.5 3.5"/><path d="M4 3.5V2h6v1.5"/><path d="M5 6v4M9 6v4"/><path d="M2.5 3.5l.9 8.5h7.2l.9-8.5"/></svg>`,
  copy:     `<svg class="bi" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="7" height="8" rx="1.2"/><path d="M9 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2"/></svg>`,
  share:    `<svg class="bi" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 8.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2L6 3.8"/><path d="M8.5 5.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2L8 10.2"/></svg>`,
  open:     `<svg class="bi" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8"/><path d="M9 2h3v3"/><path d="M14 0L7.5 6.5"/></svg>`,
  play:     `<svg class="bi" viewBox="0 0 14 14" fill="currentColor" stroke="none" aria-hidden="true"><path d="M3.5 2.5l8 5-8 5V2.5z"/></svg>`,
  pause:    `<svg class="bi" viewBox="0 0 14 14" fill="currentColor" stroke="none" aria-hidden="true"><rect x="2.5" y="2" width="3.5" height="10" rx="1"/><rect x="8" y="2" width="3.5" height="10" rx="1"/></svg>`,
  upload:   `<svg class="bi" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10V2M4 5l3-3 3 3"/><path d="M2 12h10"/></svg>`,
  download: `<svg class="bi" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 2v8M4 7l3 3 3-3"/><path d="M2 12h10"/></svg>`,
  eye:      `<svg class="bi" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 7s2.5-4.5 6-4.5S13 7 13 7s-2.5 4.5-6 4.5S1 7 1 7z"/><circle cx="7" cy="7" r="1.8"/></svg>`,
  chart:    `<svg class="bi" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 10 4 6 7 8 10 4 13 7"/></svg>`,
  check:    `<svg class="bi" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 7l4 4 6-6"/></svg>`,
  deploy:   `<svg class="bi" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 1l1.8 4h4L9.5 8l1.5 4.5L7 10 3 12.5 4.5 8 1.2 5h4z"/></svg>`,
  role:     `<svg class="bi" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="5" r="2.5"/><path d="M2 12c0-2.76 2.24-5 5-5s5 2.24 5 5"/></svg>`,
  docs:     `<svg class="bi" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M4 5h6M4 7h4M4 9h5"/></svg>`,
};

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

/* ── Sidebar toggle + mobile backdrop ──────────────────────────────────────── */
const _sidebar  = document.getElementById('sidebar');
const _backdrop = document.getElementById('sidebar-backdrop');
const _MOBILE_BP = 640;

function _closeMobileSidebar() {
  _sidebar.classList.add('collapsed');
  _backdrop.classList.remove('visible');
  document.body.style.overflow = '';
}

document.getElementById('sidebar-toggle').addEventListener('click', () => {
  _sidebar.classList.toggle('collapsed');
  if (window.innerWidth <= _MOBILE_BP) {
    const isOpen = !_sidebar.classList.contains('collapsed');
    _backdrop.classList.toggle('visible', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  }
});

_backdrop.addEventListener('click', _closeMobileSidebar);

/* ── Theme picker (light / system / dark) ───────────────────────────────────── */
const THEME_KEY = 'fluxdb-theme';
let _sysMQ = null;
const _pickerBtns = document.querySelectorAll('.theme-picker-btn');
const _pickerLabel = document.getElementById('theme-picker-current');

function _applyEffectiveTheme(isLight) {
  document.documentElement.dataset.theme = isLight ? 'light' : 'dark';
  if (_pickerLabel) _pickerLabel.textContent = isLight ? 'Light' : 'Dark';
}

function applyThemePref(pref) {
  if (_sysMQ) {
    _sysMQ.removeEventListener('change', _onSysChange);
    _sysMQ = null;
  }
  if (pref === 'system') {
    _sysMQ = window.matchMedia('(prefers-color-scheme: light)');
    _applyEffectiveTheme(_sysMQ.matches);
    if (_pickerLabel) _pickerLabel.textContent = 'System';
    _sysMQ.addEventListener('change', _onSysChange);
  } else {
    document.documentElement.dataset.theme = pref;
    if (_pickerLabel) _pickerLabel.textContent = pref === 'light' ? 'Light' : 'Dark';
  }
  _pickerBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.themePick === pref));
}

function _onSysChange(e) {
  _applyEffectiveTheme(e.matches);
}

applyThemePref(localStorage.getItem(THEME_KEY) || 'system');

_pickerBtns.forEach(btn => btn.addEventListener('click', () => {
  const pref = btn.dataset.themePick;
  localStorage.setItem(THEME_KEY, pref);
  applyThemePref(pref);
}));

/* ── Navigation ────────────────────────────────────────────────────────────── */
document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    showView('view-' + btn.dataset.view);
    // Close sidebar overlay on mobile after nav
    if (window.innerWidth <= _MOBILE_BP) _closeMobileSidebar();
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
    if (btn.dataset.view === 'backups')     loadBackups();
    if (btn.dataset.view === 'applogs')    loadAppLogs();
    if (btn.dataset.view === 'stream')      initStreamView();
    if (btn.dataset.view === 'relations')   loadRelations();
    if (btn.dataset.view === 'dbtemplates') loadDbTemplates();
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
  document.getElementById('nav-backups').style.display     = isAdmin ? '' : 'none';
  document.getElementById('nav-applogs').style.display     = isAdmin ? '' : 'none';

  // Admin-only UI controls
  if (isAdmin) {
    document.getElementById('db-scope-toggle').style.display = '';
    document.getElementById('btn-create-tpl').style.display  = '';
    setInterval(refreshThreatBadge, 30_000);
  }

  // Admin + member (not guest)
  document.getElementById('btn-create-db').style.display       = (isAdmin || isMember) ? '' : 'none';
  document.getElementById('btn-import-dataset').style.display  = (isAdmin || isMember) ? '' : 'none';
  document.getElementById('btn-from-template').style.display   = (isAdmin || isMember) ? '' : 'none';
  document.getElementById('btn-schema-builder').style.display  = (isAdmin || isMember) ? '' : 'none';
  document.getElementById('nav-apikeys').style.display         = (isAdmin || isMember) ? '' : 'none';
  document.getElementById('nav-webhooks').style.display        = (isAdmin || isMember) ? '' : 'none';
  document.getElementById('btn-create-webhook').style.display  = (isAdmin || isMember) ? '' : 'none';
  document.getElementById('nav-stream').style.display          = (isAdmin || isMember) ? '' : 'none';
  document.getElementById('nav-relations').style.display       = (isAdmin || isMember) ? '' : 'none';

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
  apiKeys:       { label: 'API Keys',      color: 'var(--accent-h)',  link: 'apikeys'   },
  webhooks:      { label: 'Webhooks',      color: 'var(--accent)',    link: 'webhooks'  },
  credentials:   { label: 'Credentials',  color: 'var(--warn)',      link: 'credentials'},
  relationships: { label: 'Relationships', color: 'var(--success)',   link: 'relations' },
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
  create_key:         { label: 'Generated API key'     },
  update_key:         { label: 'Updated key role'      },
  delete_key:         { label: 'Revoked API key'       },
  create_rel:         { label: 'Created relationship'  },
  delete_rel:         { label: 'Deleted relationship'  },
  login:              { label: 'Logged in'             },
  logout:             { label: 'Logged out'            },
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

let _dbScope = 'mine'; // 'mine' | 'all'  (admin only)

function setDbScope(scope) {
  _dbScope = scope;
  document.getElementById('db-scope-mine').classList.toggle('scope-btn-active', scope === 'mine');
  document.getElementById('db-scope-all').classList.toggle('scope-btn-active', scope === 'all');
  loadDatabases();
}

async function loadDatabases() {
  const qs   = (_dbScope === 'all' && currentUser.role === 'admin') ? '?scope=all' : '';
  const dbs  = await api('GET', `/databases${qs}`);
  const list = document.getElementById('db-list');

  if (dbs.length === 0) {
    const canCreate = currentUser.role === 'admin' || currentUser.role === 'member';
    list.innerHTML = `<div class="empty-state">
      ${canCreate
        ? 'No databases yet. Click <b>+ New Database</b> to create one, or use <b>From Template</b> to start instantly.'
        : 'No databases yet. Ask your admin to set up a template you can instantiate.'}
    </div>`;
    return;
  }

  list.innerHTML = dbs.map(d => {
    const isOwner = d.createdBy === currentUser.username;
    const isAdmin = currentUser.role === 'admin';
    const canModify = isAdmin || isOwner;
    const ownerTag = (!isOwner && isAdmin)
      ? `<span style="font-size:.65rem;background:rgba(245,158,11,.12);color:#f59e0b;border:1px solid rgba(245,158,11,.25);padding:1px 7px;border-radius:10px;margin-left:6px;">${esc(d.createdBy)}</span>`
      : '';
    return `
    <div class="db-card" data-id="${d.id}">
      <div class="db-card-name">${esc(d.name)}${ownerTag}</div>
      <div class="db-card-meta">Created by ${esc(d.createdBy)} &bull; ${fmtDate(d.createdAt)}</div>
      <div class="db-card-count"><span class="record-count-badge">${d.recordCount ?? 0} record${(d.recordCount ?? 0) !== 1 ? 's' : ''}</span></div>
      <div class="db-card-fields">
        ${d.fields.map(f => `<span class="field-chip">${esc(f.name)}${f.required ? '<span style="color:var(--danger);font-size:.7rem">*</span>' : ''}<span class="badge badge-${f.type}" style="margin-left:4px">${f.type}</span></span>`).join('')}
      </div>
      <div class="db-card-actions" onclick="event.stopPropagation()">
        <button class="btn btn-sm btn-outline" onclick="openRecords('${d.id}')">${IC.open} Open</button>
        <button class="btn btn-sm btn-outline" onclick="openShareModal('${d.id}','${esc(d.name)}')">${IC.share} Share</button>
        ${canModify ? `
          <button class="btn btn-sm btn-outline" onclick="editDatabase('${d.id}')">${IC.edit} Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteDatabase('${d.id}','${esc(d.name)}')">${IC.trash} Delete</button>
        ` : ''}
      </div>
    </div>`;
  }).join('');
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
          ${canEdit ? `<button class="btn-icon" title="Edit" onclick="editRecord('${r.id}')">${IC.edit}</button>` : ''}
          ${canEdit ? `<button class="btn-icon del" title="Delete" onclick="deleteRecord('${r.id}')">${IC.trash}</button>` : ''}
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
          <button class="btn-icon" onclick="editUser('${u.id}','${esc(u.username)}','${u.role}')">${IC.edit} Edit</button>
          ${u.username!=='admin'&&u.username!=='guest'
            ? `<button class="btn-icon del" onclick="deleteUser('${u.id}','${esc(u.username)}')">${IC.trash} Delete</button>`
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
// ── Key role helpers ──────────────────────────────────────────────────────────
const KEY_ROLE_META = {
  admin:  { label: 'Admin',  cls: 'key-role-admin',  desc: 'Full control — manage databases, records, users, keys' },
  editor: { label: 'Editor', cls: 'key-role-editor', desc: 'Read + Write — create, update and delete databases and records' },
  viewer: { label: 'Viewer', cls: 'key-role-viewer', desc: 'Read Only — can only read databases and records (no writes)' },
};

function keyRoleBadge(role) {
  const m = KEY_ROLE_META[role] || KEY_ROLE_META.editor;
  return `<span class="key-role-badge ${m.cls}" title="${m.desc}">${m.label}</span>`;
}

// Role options available to the current user (can't create keys above own level)
function availableKeyRoles() {
  const role = currentUser.role;
  if (role === 'admin')  return ['admin', 'editor', 'viewer'];
  if (role === 'member') return ['editor', 'viewer'];
  return ['viewer'];
}

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
      <thead><tr>
        <th>Name</th>
        <th>Role</th>
        <th>Key Preview</th>
        <th>Created</th>
        <th>Last Used</th>
        <th>Actions</th>
      </tr></thead>
      <tbody>${keys.map(k => {
        const role = k.role || 'editor';
        return `<tr>
          <td><strong>${esc(k.name)}</strong></td>
          <td>${keyRoleBadge(role)}</td>
          <td><code class="key-preview">${esc(k.keyPreview)}</code></td>
          <td>${fmtDate(k.createdAt)}</td>
          <td>${k.lastUsed ? fmtDate(k.lastUsed) : '<span style="color:var(--text-muted)">Never</span>'}</td>
          <td>
            <div class="actions-cell">
              <button class="btn btn-ghost btn-xs" onclick="changeKeyRole('${k.id}','${esc(k.name)}','${role}')">${IC.role} Role</button>
              <button class="btn-icon del" onclick="revokeApiKey('${k.id}','${esc(k.name)}')">${IC.trash} Revoke</button>
            </div>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  } catch (err) {
    wrap.innerHTML = `<p class="empty-state" style="color:var(--danger)">${esc(err.message)}</p>`;
  }
}

document.getElementById('btn-create-key').onclick = () => {
  const roles   = availableKeyRoles();
  const options = roles.map(r => {
    const m = KEY_ROLE_META[r];
    return `<option value="${r}"${r === 'editor' ? ' selected' : ''}>${m.label} — ${m.desc}</option>`;
  }).join('');

  openModal('Generate API Key', `
    <label>Key Name <span style="color:var(--text-muted);font-weight:400">(e.g. "CI Pipeline", "Read-only Monitor")</span></label>
    <input id="key-name-input" type="text" placeholder="e.g. Production Script" maxlength="60" />

    <label style="margin-top:14px">
      Role
      <span style="color:var(--text-muted);font-weight:400;font-size:.8rem"> — controls what this key can do</span>
    </label>
    <select id="key-role-input" class="input" onchange="updateKeyRoleDesc()">
      ${options}
    </select>
    <div id="key-role-desc-box" class="key-role-desc-box"></div>`,
    async () => {
      const name = document.getElementById('key-name-input').value.trim();
      const role = document.getElementById('key-role-input').value;
      if (!name) return toast('Key name is required', 'error');
      try {
        const result = await api('POST', '/keys', { name, role });
        closeModal();
        openModal('Your New API Key', `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            ${keyRoleBadge(result.role)}
            <span style="color:var(--text-muted);font-size:.84rem">${KEY_ROLE_META[result.role]?.desc || ''}</span>
          </div>
          <p style="color:var(--text-muted);font-size:.84rem;margin-bottom:12px">
            Copy this key now. It will <strong style="color:var(--danger)">not be shown again</strong>.
          </p>
          <div class="key-reveal-box">
            <code id="new-key-value">${esc(result.key)}</code>
            <button class="btn btn-sm btn-outline" onclick="copyApiKey()">${IC.copy} Copy</button>
          </div>
          <p style="color:var(--text-muted);font-size:.78rem;margin-top:10px">
            Use as: <code>X-API-Key: ${esc(result.key)}</code>
          </p>`, null);
        loadApiKeys();
        toast('API key created!', 'success');
      } catch (err) { toast(err.message, 'error'); }
    }, 'Generate');

  // Initialise description box
  setTimeout(updateKeyRoleDesc, 0);
};

function updateKeyRoleDesc() {
  const sel = document.getElementById('key-role-input');
  const box = document.getElementById('key-role-desc-box');
  if (!sel || !box) return;
  const m = KEY_ROLE_META[sel.value] || KEY_ROLE_META.editor;
  box.className = `key-role-desc-box key-role-desc-${sel.value}`;
  box.innerHTML = `<span class="key-role-badge ${m.cls}" style="margin-right:6px">${m.label}</span>${m.desc}`;
}

function copyApiKey() {
  const val = document.getElementById('new-key-value').textContent;
  navigator.clipboard.writeText(val).then(() => toast('Key copied to clipboard!', 'success'));
}

function changeKeyRole(id, name, currentRole) {
  const roles   = availableKeyRoles();
  const options = roles.map(r => {
    const m = KEY_ROLE_META[r];
    return `<option value="${r}"${r === currentRole ? ' selected' : ''}>${m.label} — ${m.desc}</option>`;
  }).join('');

  openModal('Change Key Role', `
    <p style="margin-bottom:12px">Update role for key <strong>${esc(name)}</strong>:</p>
    <select id="change-role-input" class="input" onchange="updateChangeRoleDesc()">
      ${options}
    </select>
    <div id="change-role-desc-box" class="key-role-desc-box"></div>
    <p style="color:var(--text-muted);font-size:.8rem;margin-top:10px">
      Active requests using this key will immediately use the new permissions.
    </p>`,
    async () => {
      const role = document.getElementById('change-role-input').value;
      try {
        await api('PATCH', `/keys/${id}`, { role });
        closeModal();
        toast(`Key role updated to ${role}`, 'success');
        loadApiKeys();
      } catch (err) { toast(err.message, 'error'); }
    }, 'Update Role');

  setTimeout(updateChangeRoleDesc, 0);
}

function updateChangeRoleDesc() {
  const sel = document.getElementById('change-role-input');
  const box = document.getElementById('change-role-desc-box');
  if (!sel || !box) return;
  const m = KEY_ROLE_META[sel.value] || KEY_ROLE_META.editor;
  box.className = `key-role-desc-box key-role-desc-${sel.value}`;
  box.innerHTML = `<span class="key-role-badge ${m.cls}" style="margin-right:6px">${m.label}</span>${m.desc}`;
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

/* ══════════════════════════════════════════════════════════════════════════════
   LIVE STREAM VIEW
   ══════════════════════════════════════════════════════════════════════════════ */
let _ws            = null;   // active WebSocket
let _streamCount   = 0;      // total events received this session
let _activePills   = new Set(['*']);  // current subscription set

const STREAM_EVENT_META = {
  record_added:      { label: 'Record Added',      cls: 'se-added'   },
  record_updated:    { label: 'Record Updated',    cls: 'se-updated' },
  record_deleted:    { label: 'Record Deleted',    cls: 'se-deleted' },
  database_created:  { label: 'Database Created',  cls: 'se-dbcreate'},
  database_deleted:  { label: 'Database Deleted',  cls: 'se-dbdelete'},
};

function initStreamView() {
  // Populate the database pills from the current database list
  api('GET', '/databases').then(dbs => {
    const pillBox = document.getElementById('stream-db-pills');
    // Keep the "All Databases" pill, rebuild the rest
    pillBox.innerHTML = `<button class="stream-pill${_activePills.has('*') ? ' active' : ''}" data-dbid="*">All Databases</button>`;
    dbs.forEach(d => {
      const pill = document.createElement('button');
      pill.className = 'stream-pill' + (_activePills.has(d.id) ? ' active' : '');
      pill.dataset.dbid = d.id;
      pill.textContent = d.name;
      pillBox.appendChild(pill);
    });
    // Toggle active on click
    pillBox.querySelectorAll('.stream-pill').forEach(p => {
      p.onclick = () => {
        if (p.dataset.dbid === '*') {
          pillBox.querySelectorAll('.stream-pill').forEach(x => x.classList.remove('active'));
          p.classList.add('active');
          _activePills = new Set(['*']);
        } else {
          pillBox.querySelector('[data-dbid="*"]').classList.remove('active');
          p.classList.toggle('active');
          _activePills = new Set(
            [...pillBox.querySelectorAll('.stream-pill.active')].map(x => x.dataset.dbid)
          );
          if (_activePills.size === 0) {
            pillBox.querySelector('[data-dbid="*"]').classList.add('active');
            _activePills = new Set(['*']);
          }
        }
      };
    });
  }).catch(() => {});

  // Wire up buttons (guard against re-registration)
  document.getElementById('btn-stream-connect').onclick    = streamConnect;
  document.getElementById('btn-stream-disconnect').onclick = streamDisconnect;
  document.getElementById('btn-stream-clear').onclick      = () => {
    document.getElementById('stream-feed').innerHTML = '<p class="empty-state">Feed cleared.</p>';
    _streamCount = 0;
    updateStreamCount();
  };
  document.getElementById('btn-stream-apply-sub').onclick = () => {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      const subs = [..._activePills];
      _ws.send(JSON.stringify({ type: 'subscribe', databases: subs }));
      toast(`Subscribed to: ${subs.join(', ')}`, 'success');
    } else {
      toast('Not connected', 'error');
    }
  };
}

function updateStreamCount() {
  const el = document.getElementById('stream-event-count');
  if (el) el.textContent = _streamCount === 1 ? '1 event' : `${_streamCount} events`;
}

function setWsBadge(state) {
  const badge = document.getElementById('ws-status-badge');
  const btnC  = document.getElementById('btn-stream-connect');
  const btnD  = document.getElementById('btn-stream-disconnect');
  if (!badge) return;
  badge.className = `ws-badge ws-badge-${state}`;
  if (state === 'on') {
    badge.textContent = '● Connected';
    btnC.style.display = 'none';
    btnD.style.display = '';
  } else if (state === 'connecting') {
    badge.textContent = '◌ Connecting…';
    btnC.style.display = 'none';
    btnD.style.display = '';
  } else {
    badge.textContent = '● Disconnected';
    btnC.style.display = '';
    btnD.style.display = 'none';
  }
}

function appendStreamEvent(msg) {
  const feed = document.getElementById('stream-feed');
  if (!feed) return;

  // Remove placeholder
  const empty = feed.querySelector('.empty-state');
  if (empty) empty.remove();

  const meta = STREAM_EVENT_META[msg.event] || { label: msg.event, cls: 'se-other' };
  const time = new Date(msg.timestamp).toLocaleTimeString();

  const row = document.createElement('div');
  row.className = 'stream-event-row';
  row.innerHTML = `
    <span class="se-time">${esc(time)}</span>
    <span class="se-badge ${meta.cls}">${meta.label}</span>
    <span class="se-db">${esc(msg.database || '—')}</span>
    <details class="se-details">
      <summary>payload</summary>
      <pre>${esc(JSON.stringify(msg.data, null, 2))}</pre>
    </details>`;

  // Prepend so newest is at top
  feed.insertBefore(row, feed.firstChild);

  // Cap feed at 200 rows to prevent memory bloat
  while (feed.children.length > 200) feed.removeChild(feed.lastChild);

  _streamCount++;
  updateStreamCount();
}

async function streamConnect() {
  if (_ws && _ws.readyState === WebSocket.OPEN) return;
  setWsBadge('connecting');
  try {
    const { token } = await api('GET', '/stream/token');
    const proto     = location.protocol === 'https:' ? 'wss' : 'ws';
    _ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);

    _ws.onopen = () => {
      setWsBadge('on');
      document.getElementById('stream-sub-panel').style.display = '';
      // Auto-subscribe to current pill selection
      _ws.send(JSON.stringify({ type: 'subscribe', databases: [..._activePills] }));
      const info = document.getElementById('stream-conn-info');
      if (info) info.textContent = `Connected as ${currentUser.username}`;
    };

    _ws.onmessage = ({ data }) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (msg.type === 'connected' || msg.type === 'subscribed' ||
          msg.type === 'unsubscribed' || msg.type === 'pong') return; // control frames
      appendStreamEvent(msg);
    };

    _ws.onclose = () => {
      setWsBadge('off');
      _ws = null;
    };

    _ws.onerror = () => {
      toast('WebSocket error — connection closed', 'error');
      setWsBadge('off');
      _ws = null;
    };
  } catch (err) {
    toast('Could not connect: ' + err.message, 'error');
    setWsBadge('off');
  }
}

function streamDisconnect() {
  if (_ws) { _ws.close(); _ws = null; }
  setWsBadge('off');
  document.getElementById('stream-sub-panel').style.display = 'none';
}

/* ══════════════════════════════════════════════════════════════════════════════
   DYNAMIC RELATIONSHIP ENGINE VIEW
   ══════════════════════════════════════════════════════════════════════════════ */

let _joinRows    = [];   // last join result rows (for CSV export)
let _joinCols    = [];   // last join result column names
let _joinCount   = 0;    // running join counter for unique IDs

async function loadRelations() {
  await Promise.all([renderRelList(), populateRelFromDb()]);
  wireRelExplorer();
}

// ── Relationship list ─────────────────────────────────────────────────────────
async function renderRelList() {
  const wrap = document.getElementById('rel-list');
  wrap.innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    const rels = await api('GET', '/relationships');
    if (rels.length === 0) {
      wrap.innerHTML = '<p class="empty-state">No relationships yet. Click <b>+ New Relationship</b> to define one.</p>';
      return;
    }
    wrap.innerHTML = `<table>
      <thead><tr>
        <th>Name</th><th>Type</th><th>From</th><th>→</th><th>To</th><th>Created By</th><th>Actions</th>
      </tr></thead>
      <tbody>${rels.map(r => `<tr>
        <td><strong>${esc(r.name)}</strong></td>
        <td><span class="rel-type-badge rel-type-${r.type.replace('-','')}">
          ${r.type === 'one-to-one' ? '1 → 1' : '1 → N'}
        </span></td>
        <td><code class="rel-field-code">${esc(r.fromDbName)}</code>
            <span class="rel-dot">.</span>
            <code class="rel-field-code">${esc(r.fromField)}</code></td>
        <td class="rel-arrow">→</td>
        <td><code class="rel-field-code">${esc(r.toDbName)}</code>
            <span class="rel-dot">.</span>
            <code class="rel-field-code">${esc(r.toField)}</code></td>
        <td style="color:var(--text-muted)">${esc(r.createdBy)}</td>
        <td><div class="actions-cell">
          <button class="btn-icon del" onclick="deleteRelationship('${r.id}','${esc(r.name)}')">${IC.trash} Delete</button>
        </div></td>
      </tr>`).join('')}</tbody>
    </table>`;
  } catch (err) {
    wrap.innerHTML = `<p class="empty-state" style="color:var(--danger)">${esc(err.message)}</p>`;
  }
}

// ── Create relationship modal ─────────────────────────────────────────────────
document.getElementById('btn-create-rel').onclick = async () => {
  let dbs = [];
  try { dbs = await api('GET', '/databases'); } catch (_) {}

  const dbOpts = dbs.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  const relFieldOpts = (dbId) => {
    const d = dbs.find(x => x.id === dbId);
    if (!d) return '';
    const sys = ['id','createdBy','createdAt','updatedAt'];
    return [...sys, ...d.fields.map(f => f.name)]
      .map(n => `<option value="${n}">${n}</option>`).join('');
  };

  openModal('New Relationship', `
    <label>Name <span style="color:var(--text-muted);font-weight:400">(optional — auto-generated if blank)</span></label>
    <input id="rel-name-inp" type="text" placeholder="e.g. orders → users" maxlength="80" />

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
      <div>
        <label>From Database</label>
        <select id="rel-from-inp" onchange="updateRelFieldOpts()">
          <option value="">— select —</option>${dbOpts}
        </select>
      </div>
      <div>
        <label>From Field <span style="color:var(--text-muted);font-size:.78rem">(the FK field)</span></label>
        <select id="rel-fromfield-inp"><option value="">— pick database first —</option></select>
      </div>
      <div>
        <label>To Database</label>
        <select id="rel-to-inp" onchange="updateRelFieldOpts()">
          <option value="">— select —</option>${dbOpts}
        </select>
      </div>
      <div>
        <label>To Field <span style="color:var(--text-muted);font-size:.78rem">(usually <code>id</code>)</span></label>
        <select id="rel-tofield-inp"><option value="">— pick database first —</option></select>
      </div>
    </div>

    <label style="margin-top:12px">Cardinality</label>
    <select id="rel-type-inp">
      <option value="one-to-many" selected>One-to-Many (1 → N)  e.g. user has many orders</option>
      <option value="one-to-one" >One-to-One  (1 → 1)  e.g. user has one profile</option>
    </select>

    <div id="rel-create-preview" style="margin-top:12px"></div>`,
    async () => {
      const name      = document.getElementById('rel-name-inp').value.trim();
      const fromDb    = document.getElementById('rel-from-inp').value;
      const fromField = document.getElementById('rel-fromfield-inp').value;
      const toDb      = document.getElementById('rel-to-inp').value;
      const toField   = document.getElementById('rel-tofield-inp').value;
      const type      = document.getElementById('rel-type-inp').value;
      if (!fromDb || !fromField || !toDb || !toField) {
        return toast('Fill in all four From / To fields', 'error');
      }
      try {
        await api('POST', '/relationships', { name, fromDb, fromField, toDb, toField, type });
        closeModal();
        toast('Relationship created!', 'success');
        renderRelList();
        populateRelFromDb();
      } catch (err) { toast(err.message, 'error'); }
    }, 'Create');

  // Store dbs for the dynamic field loader
  window._relModalDbs = dbs;
  window._relFieldOpts = relFieldOpts;
};

function updateRelFieldOpts() {
  const dbs        = window._relModalDbs || [];
  const fromId     = document.getElementById('rel-from-inp')?.value;
  const toId       = document.getElementById('rel-to-inp')?.value;
  const fromSel    = document.getElementById('rel-fromfield-inp');
  const toSel      = document.getElementById('rel-tofield-inp');

  function buildOpts(dbId) {
    const d = dbs.find(x => x.id === dbId);
    if (!d) return '<option value="">— pick database first —</option>';
    const sys = ['id','createdBy','createdAt','updatedAt'];
    return [...sys, ...d.fields.map(f => f.name)]
      .map(n => `<option value="${n}">${n}</option>`).join('');
  }

  if (fromSel) fromSel.innerHTML = buildOpts(fromId);
  if (toSel)   toSel.innerHTML   = buildOpts(toId);
}

async function deleteRelationship(id, name) {
  openModal('Delete Relationship',
    `<p>Delete relationship <b>${esc(name)}</b>?<br>
     <span style="color:var(--text-muted);font-size:.84rem">The databases and records themselves are not affected.</span></p>`,
    async () => {
      try {
        await api('DELETE', `/relationships/${id}`);
        closeModal();
        toast('Relationship deleted', 'success');
        renderRelList();
        populateRelFromDb();
      } catch (err) { toast(err.message, 'error'); }
    }, 'Delete');
}

// ── Join Explorer ─────────────────────────────────────────────────────────────
async function populateRelFromDb() {
  let dbs = [];
  try { dbs = await api('GET', '/databases'); } catch (_) {}
  const sel = document.getElementById('rel-from-db');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— select a database —</option>' +
    dbs.map(d => `<option value="${d.id}"${d.id===cur?' selected':''}>${esc(d.name)}</option>`).join('');
  window._relAllDbs = dbs;
}

function wireRelExplorer() {
  document.getElementById('btn-add-join').onclick   = addJoinRow;
  document.getElementById('btn-add-where').onclick  = addWhereRow;
  document.getElementById('btn-run-join').onclick   = runJoin;
}

function addJoinRow() {
  const dbs    = window._relAllDbs || [];
  const dbOpts = dbs.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  const idx    = ++_joinCount;
  const list   = document.getElementById('rel-joins-list');
  const row    = document.createElement('div');
  row.className = 'rel-join-row';
  row.id        = `rel-join-${idx}`;
  row.innerHTML = `
    <div class="rel-join-inner">
      <span class="rel-join-label">JOIN</span>

      <div class="rel-join-col">
        <label class="rel-mini-label">From field</label>
        <input class="rel-join-fromfield" type="text" placeholder="e.g. userId" style="width:110px" />
      </div>
      <span class="rel-arrow">→</span>
      <div class="rel-join-col">
        <label class="rel-mini-label">Database</label>
        <select class="rel-join-todb" onchange="onJoinDbChange(${idx})">
          <option value="">— pick —</option>${dbOpts}
        </select>
      </div>
      <div class="rel-join-col">
        <label class="rel-mini-label">On field</label>
        <select class="rel-join-tofield">
          <option value="">id</option>
        </select>
      </div>
      <div class="rel-join-col">
        <label class="rel-mini-label">Alias</label>
        <input class="rel-join-as" type="text" placeholder="as…" style="width:80px" />
      </div>
      <div class="rel-join-col">
        <label class="rel-mini-label">Type</label>
        <select class="rel-join-type" style="width:130px">
          <option value="one-to-many">1 → N (array)</option>
          <option value="one-to-one" >1 → 1 (object)</option>
        </select>
      </div>
      <button class="btn-icon del rel-join-del" onclick="removeJoinRow(${idx})" title="Remove join">✕</button>
    </div>`;
  list.appendChild(row);
}

function onJoinDbChange(idx) {
  const row    = document.getElementById(`rel-join-${idx}`);
  const dbId   = row.querySelector('.rel-join-todb').value;
  const dbs    = window._relAllDbs || [];
  const d      = dbs.find(x => x.id === dbId);
  const toSel  = row.querySelector('.rel-join-tofield');
  if (!d) { toSel.innerHTML = '<option value="id">id</option>'; return; }
  const sys = ['id','createdBy','createdAt','updatedAt'];
  toSel.innerHTML = [...sys, ...d.fields.map(f => f.name)]
    .map(n => `<option value="${n}">${n}</option>`).join('');
}

function removeJoinRow(idx) {
  document.getElementById(`rel-join-${idx}`)?.remove();
}

function addWhereRow() {
  const dbs    = window._relAllDbs || [];
  const fromId = document.getElementById('rel-from-db').value;
  const srcDb  = dbs.find(d => d.id === fromId);
  const flds   = srcDb
    ? ['id','createdBy','createdAt','updatedAt',...srcDb.fields.map(f=>f.name)]
    : ['id'];

  const idx  = ++_joinCount;
  const list = document.getElementById('rel-where-list');
  const row  = document.createElement('div');
  row.className = 'rel-where-row';
  row.id        = `rel-where-${idx}`;
  row.innerHTML = `
    <select class="rel-where-field">
      ${flds.map(f=>`<option value="${f}">${f}</option>`).join('')}
    </select>
    <select class="rel-where-op">
      <option value="=">=</option>
      <option value="!=">≠</option>
      <option value=">">></option>
      <option value="<"><</option>
    </select>
    <input class="rel-where-val" type="text" placeholder="value" style="width:120px" />
    <button class="btn-icon del" onclick="document.getElementById('rel-where-${idx}').remove()" title="Remove">✕</button>`;
  list.appendChild(row);
}

async function runJoin() {
  const fromDb = document.getElementById('rel-from-db').value;
  if (!fromDb) return toast('Select a FROM database', 'error');

  // Collect joins
  const joinRows = [...document.querySelectorAll('.rel-join-row')];
  const joins    = joinRows.map(row => ({
    fromField: row.querySelector('.rel-join-fromfield').value.trim(),
    toDb:      row.querySelector('.rel-join-todb').value,
    toField:   row.querySelector('.rel-join-tofield').value || 'id',
    as:        row.querySelector('.rel-join-as').value.trim() || undefined,
    type:      row.querySelector('.rel-join-type').value,
  })).filter(j => j.fromField && j.toDb);

  // Collect where
  const whereRows = [...document.querySelectorAll('.rel-where-row')];
  const where     = {};
  for (const row of whereRows) {
    const field = row.querySelector('.rel-where-field').value;
    const op    = row.querySelector('.rel-where-op').value;
    const val   = row.querySelector('.rel-where-val').value;
    if (!field || val === '') continue;
    const key = op === '!=' ? `!${field}` : op === '>' ? `${field}>` : op === '<' ? `${field}<` : field;
    where[key] = val;
  }

  const limit  = Number(document.getElementById('rel-limit').value) || 100;
  const result = document.getElementById('rel-results');
  const elapsed = document.getElementById('rel-elapsed');
  result.innerHTML  = '<p class="empty-state">Running join…</p>';
  elapsed.textContent = '';

  try {
    const res = await api('POST', '/relationships/join', { fromDb, joins, where, limit });
    _joinRows = res.rows;
    _joinCols = res.rows.length > 0 ? deriveJoinCols(res.rows) : [];
    elapsed.textContent = `${res.rowCount} row${res.rowCount!==1?'s':''} · ${res.elapsed} ms`;
    renderJoinResults(res);
  } catch (err) {
    result.innerHTML = `<p class="empty-state" style="color:var(--danger)">${esc(err.message)}</p>`;
  }
}

function deriveJoinCols(rows) {
  const keys = new Set();
  for (const row of rows.slice(0, 20)) Object.keys(row).forEach(k => keys.add(k));
  return [...keys];
}

function renderJoinResults(res) {
  const wrap = document.getElementById('rel-results');
  if (!res.rows || res.rows.length === 0) {
    wrap.innerHTML = '<p class="empty-state">No matching records.</p>';
    return;
  }

  const cols = _joinCols;

  const renderCell = (val) => {
    if (val === null || val === undefined) return '<span style="color:var(--text-muted)">null</span>';
    if (Array.isArray(val)) {
      if (val.length === 0) return '<span class="join-badge join-badge-empty">[ 0 ]</span>';
      return `<details class="join-nested">
        <summary class="join-badge join-badge-arr">[${val.length} record${val.length!==1?'s':''}]</summary>
        <pre>${esc(JSON.stringify(val, null, 2))}</pre>
      </details>`;
    }
    if (typeof val === 'object') {
      return `<details class="join-nested">
        <summary class="join-badge join-badge-obj">{ object }</summary>
        <pre>${esc(JSON.stringify(val, null, 2))}</pre>
      </details>`;
    }
    return esc(String(val));
  };

  wrap.innerHTML = `
    ${res.truncated ? `<p class="rel-truncate-warn">&#9888; Results truncated to ${res.rows.length} rows (${res.rowCount} total).</p>` : ''}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:.8rem;color:var(--text-muted)">
        ${res.rowCount} row${res.rowCount!==1?'s':''} from <strong>${esc(res.sourceDb)}</strong>
        ${res.truncated ? `(showing ${res.rows.length})` : ''}
      </span>
      <button class="btn btn-xs btn-outline" onclick="exportJoinCSV()">${IC.download} Export CSV</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${res.rows.map(row =>
          `<tr>${cols.map(c => `<td>${renderCell(row[c])}</td>`).join('')}</tr>`
        ).join('')}</tbody>
      </table>
    </div>`;
}

function exportJoinCSV() {
  if (_joinRows.length === 0) return toast('No results to export', 'error');
  const cols = _joinCols;
  const lines = [
    cols.join(','),
    ..._joinRows.map(row => cols.map(c => {
      const v = row[c];
      const s = (v === null || v === undefined) ? '' :
                (typeof v === 'object') ? JSON.stringify(v) : String(v);
      return `"${s.replace(/"/g,'""')}"`;
    }).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `join_result_${Date.now()}.csv`;
  a.click();
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
// ── Schema insert-mode toggle (SQL vs Fluent) ─────────────────────────────────
let _schemaInsertMode = 'sql'; // 'sql' | 'fluent'
document.getElementById('schema-mode-sql').addEventListener('click', () => {
  _schemaInsertMode = 'sql';
  document.getElementById('schema-mode-sql').classList.add('active');
  document.getElementById('schema-mode-fluent').classList.remove('active');
});
document.getElementById('schema-mode-fluent').addEventListener('click', () => {
  _schemaInsertMode = 'fluent';
  document.getElementById('schema-mode-fluent').classList.add('active');
  document.getElementById('schema-mode-sql').classList.remove('active');
});

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
        <button class="schema-table-btn" onclick="insertTableQuery(${JSON.stringify(t.name)})" title="Click to generate a query">
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
  const q  = /\s/.test(name) ? `\`${name}\`` : name;
  if (_schemaInsertMode === 'fluent') {
    el.value = `${q}.limit(100)`;
  } else {
    el.value = `SELECT *\nFROM ${q}\nLIMIT 100`;
  }
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

function renderQueryResults(el, { columns, rows, rowCount, elapsed, truncated, isFluent, translatedSql }) {
  const translatedBanner = (isFluent && translatedSql)
    ? `<div class="query-translated"><span class="qt-label">Translated to SQL</span><code class="qt-sql">${esc(translatedSql)}</code></div>`
    : '';

  if (!columns.length) {
    el.innerHTML = translatedBanner + '<div class="query-empty-state">Query returned no results.</div>';
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
    ${translatedBanner}
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
        <button class="btn btn-sm btn-ghost" onclick="copyText(${JSON.stringify(ep.path.replace('/:id',''))})" title="Copy base URL">${IC.copy}</button>
        <button class="btn btn-sm btn-ghost" onclick="toggleCurl('curl-${api.slug}-${i}')" title="Show curl example">&lt;/&gt;</button>
      </div>
    </div>
    <div class="curl-block hidden" id="curl-${api.slug}-${i}">
      <button class="curl-copy-btn" onclick="copyText(${JSON.stringify(ep.curl)})" title="Copy">${IC.copy}</button>
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
            <button class="btn btn-sm btn-ghost" onclick="copyText(${JSON.stringify(baseUrl)})" title="Copy base URL">${IC.copy}</button>
          </div>
        </div>
        <div class="api-card-meta" style="display:flex;align-items:center;gap:8px;">
          <span class="record-count-badge">${api.recordCount} record${api.recordCount !== 1 ? 's' : ''}</span>
          <span class="record-count-badge">${api.fields.length} field${api.fields.length !== 1 ? 's' : ''}</span>
          <button class="btn btn-sm btn-primary" onclick="openApiDocs(${JSON.stringify(api)})" style="margin-left:4px;">${IC.docs} Docs</button>
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
          <button class="btn btn-sm btn-ghost" onclick="copyText(${JSON.stringify(h.url)})" title="Copy URL">${IC.copy}</button>
        </div>
        <div class="wh-meta-row">
          <span class="wh-last-delivery">${lastStatus}</span>
          <span style="color:var(--text-muted);font-size:.73rem">Created ${fmtDate(h.createdAt)}</span>
          ${h.secret ? '<span class="wh-signed-badge">🔒 Signed</span>' : ''}
        </div>
      </div>
      <div class="wh-card-actions">
        <button class="btn btn-sm btn-outline" onclick="testWebhook('${h.id}')" title="Send test payload">${IC.play} Test</button>
        <button class="btn btn-sm btn-outline" onclick="viewDeliveries('${h.id}','${esc(h.event)}')" title="Delivery log">${IC.chart} Log</button>
        <button class="btn btn-sm btn-outline" onclick="toggleWebhook('${h.id}',${h.active})">${h.active ? IC.pause + ' Pause' : IC.play + ' Resume'}</button>
        <button class="btn btn-sm btn-danger"  onclick="deleteWebhook('${h.id}','${esc(h.event)}')">${IC.trash}</button>
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
    <button class="btn btn-ghost" id="import-back-btn"><svg class="bi" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5L4 7l5 4.5"/></svg> Back</button>
    <button class="btn btn-primary" id="import-submit-btn">${IC.upload} Import ${rows.length} Rows</button>`;
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
          <button class="btn btn-ghost btn-sm cred-reveal-btn" onclick="revealCredential('${c.id}')">${IC.eye} Reveal</button>
          <button class="btn btn-ghost btn-sm cred-copy-btn hidden" id="ccopy-${c.id}" onclick="copyCredential('${c.id}')">${IC.copy} Copy</button>
        </div>
      </div>
      <div class="cred-actions">
        <button class="btn btn-outline btn-sm" onclick="editCredential('${c.id}', '${esc(c.name)}', '${esc(c.description || '')}')">${IC.edit} Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCredential('${c.id}', '${esc(c.name)}')">${IC.trash} Delete</button>
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
    btn.innerHTML = IC.check + ' Copied';
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


/* ══════════════════════════════════════════════════════════════════════════════
   Backups
   ══════════════════════════════════════════════════════════════════════════════ */

function fmtBytes(b) {
  if (b < 1024)         return `${b} B`;
  if (b < 1024 * 1024)  return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

function backupTypeLabel(filename) {
  if (filename.startsWith('full_')) return '<span class="bk-badge bk-badge-full">Full</span>';
  return '<span class="bk-badge bk-badge-db">Database</span>';
}

async function loadBackups() {
  const listEl = document.getElementById('backup-list');
  listEl.innerHTML = '<p class="empty-state">Loading backups…</p>';
  try {
    const files = await api('GET', '/backups');
    renderBackupList(files);
  } catch (err) {
    listEl.innerHTML = `<p class="empty-state" style="color:var(--danger)">${esc(err.message)}</p>`;
  }
  // Also load and display the schedule
  await loadBackupSchedule();
}

async function loadBackupSchedule() {
  try {
    const { hours, enabled } = await api('GET', '/backup/schedule');
    const selectEl = document.getElementById('backup-schedule-select');
    const statusEl = document.getElementById('schedule-status');
    if (selectEl) {
      selectEl.value = hours === 0 ? 'disabled' : String(hours);
      if (statusEl) {
        if (hours === 0) {
          statusEl.textContent = '(Auto-backups disabled)';
        } else {
          statusEl.textContent = `(Next backup in ~${hours}h)`;
        }
      }
    }
  } catch (err) {
    console.error('Failed to load backup schedule:', err.message);
  }
}

async function saveBackupSchedule() {
  const selectEl = document.getElementById('backup-schedule-select');
  const statusEl = document.getElementById('schedule-status');
  const btn = document.getElementById('btn-save-schedule');
  if (!selectEl || !btn) return;

  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = 'Saving…';
  try {
    const value = selectEl.value;
    const hours = value === 'disabled' ? 0 : parseInt(value);
    await api('PUT', '/backup/schedule', { hours });
    toast('Backup schedule updated', 'success');
    if (statusEl) {
      statusEl.textContent = hours === 0 ? '(Auto-backups disabled)' : `(Every ${hours} hours)`;
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

function renderBackupList(files) {
  const listEl = document.getElementById('backup-list');
  if (!files.length) {
    listEl.innerHTML = '<p class="empty-state">No backups yet. Click <strong>Create Backup</strong> to save a snapshot.</p>';
    return;
  }

  const rows = files.map(f => `
    <tr>
      <td class="bk-name">
        ${backupTypeLabel(f.filename)}
        <span class="bk-filename">${esc(f.filename)}</span>
      </td>
      <td class="bk-size">${fmtBytes(f.size)}</td>
      <td class="bk-date">${new Date(f.createdAt).toLocaleString()}</td>
      <td class="bk-actions">
        <button class="btn btn-outline btn-xs" onclick="downloadBackup('${esc(f.filename)}')">${IC.download} Download</button>
        <button class="btn btn-primary btn-xs" onclick="confirmRestore('${esc(f.filename)}')">${IC.refresh} Restore</button>
        <button class="btn btn-danger btn-xs" onclick="confirmDeleteBackup('${esc(f.filename)}')">${IC.trash}</button>
      </td>
    </tr>`).join('');

  listEl.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Size</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function createBackup() {
  const btn = document.getElementById('btn-create-backup');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const result = await api('POST', '/backup');
    toast(`Backup created — ${result.files.length} file(s) written`, 'success');
    loadBackups();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = IC.download + ' Create Backup';
  }
}

function downloadBackup(filename) {
  window.open(`/api/backup/${encodeURIComponent(filename)}`, '_blank');
}

function confirmRestore(filename) {
  const isFullBackup = filename.startsWith('full_');
  const warning = isFullBackup
    ? '<p style="color:var(--danger);margin-top:8px;font-size:.84rem"><strong>Full restore:</strong> This will replace ALL databases, records, users, API keys, webhooks and credentials with the backup contents.</p>'
    : '<p style="color:var(--warn);margin-top:8px;font-size:.84rem"><strong>Database restore:</strong> The database and its records from this backup will be merged/replaced. Other data is untouched.</p>';

  openModal('Restore Backup', `
    <p>Restore from <strong>${esc(filename)}</strong>?</p>
    ${warning}
    <p style="color:var(--text-muted);font-size:.84rem;margin-top:6px">The page will reload after a successful full restore.</p>
  `, async () => {
    try {
      const result = await api('POST', '/restore', { filename });
      closeModal();
      toast(result.message, 'success');
      if (isFullBackup) setTimeout(() => location.reload(), 1200);
      else loadBackups();
    } catch (err) { toast(err.message, 'error'); }
  }, 'Restore');
}

function confirmDeleteBackup(filename) {
  openModal('Delete Backup', `
    <p>Permanently delete <strong>${esc(filename)}</strong>?</p>
    <p style="color:var(--text-muted);font-size:.84rem;margin-top:8px">This cannot be undone.</p>
  `, async () => {
    try {
      await api('DELETE', `/backup/${encodeURIComponent(filename)}`);
      closeModal();
      toast('Backup deleted', 'success');
      loadBackups();
    } catch (err) { toast(err.message, 'error'); }
  }, 'Delete');
}

document.getElementById('btn-create-backup').onclick  = createBackup;
document.getElementById('btn-refresh-backups').onclick = loadBackups;
document.getElementById('btn-save-schedule').onclick   = saveBackupSchedule;

// ─── Share Links ─────────────────────────────────────────────────────────────

async function openShareModal(dbId, dbName) {
  let links = [];
  try {
    links = await api('GET', `/databases/${dbId}/shares`);
  } catch (e) { /* ignore, show empty */ }

  const permBadge = perm => {
    const colors = { view: '#3b82f6', edit: '#22c55e', admin: '#f59e0b' };
    const labels = { view: 'View Only', edit: 'Can Edit', admin: 'Admin' };
    return `<span style="background:${colors[perm]}22;color:${colors[perm]};border:1px solid ${colors[perm]}44;padding:2px 8px;border-radius:12px;font-size:.72rem;font-weight:600;text-transform:uppercase">${labels[perm]}</span>`;
  };

  const linksHtml = links.length === 0
    ? `<p style="color:var(--text-muted);font-size:.84rem;padding:12px 0">No active share links yet.</p>`
    : `<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
        ${links.map(l => `
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
              <div style="display:flex;align-items:center;gap:8px">
                ${permBadge(l.permission)}
                ${l.label ? `<span style="font-size:.82rem;color:var(--text-muted)">${esc(l.label)}</span>` : ''}
              </div>
              <div style="display:flex;gap:6px">
                <button class="btn btn-sm btn-outline" onclick="copyShareLink('${l.shareUrl}')">Copy Link</button>
                <button class="btn btn-sm btn-danger" onclick="revokeShareLink('${l.token}','${dbId}','${esc(dbName)}')">Revoke</button>
              </div>
            </div>
            <div style="margin-top:6px;font-size:.75rem;color:var(--text-muted)">
              ${l.accessCount} view${l.accessCount !== 1 ? 's' : ''}
              &bull; Created by ${esc(l.createdBy)}
              &bull; ${fmtDate(l.createdAt)}
              ${l.expiresAt ? `&bull; Expires ${fmtDate(l.expiresAt)}` : ''}
            </div>
          </div>`).join('')}
      </div>`;

  const isAdmin = currentUser.role === 'admin';
  const adminOpt = isAdmin ? `<option value="admin">Admin (full access)</option>` : '';

  const body = `
    <div style="margin-bottom:18px">
      <div style="font-size:.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Active Links</div>
      ${linksHtml}
    </div>
    <hr style="border-color:var(--border);margin:16px 0">
    <div style="font-size:.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Generate New Link</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:5px">Permission</label>
        <select id="share-perm" style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:7px;font-size:.86rem">
          <option value="view">View Only</option>
          <option value="edit">Can Edit</option>
          ${adminOpt}
        </select>
      </div>
      <div>
        <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:5px">Expires In</label>
        <select id="share-expires" style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:7px;font-size:.86rem">
          <option value="">Never</option>
          <option value="3600">1 Hour</option>
          <option value="86400">1 Day</option>
          <option value="604800">7 Days</option>
          <option value="2592000">30 Days</option>
        </select>
      </div>
    </div>
    <div style="margin-top:12px">
      <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:5px">Label (optional)</label>
      <input id="share-label" type="text" maxlength="80" placeholder="e.g. For the marketing team"
        style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:7px;font-size:.86rem">
    </div>
    <div id="share-result" style="display:none;margin-top:14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 14px">
      <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:6px">Share link generated:</div>
      <div style="display:flex;align-items:center;gap:8px">
        <code id="share-url-text" style="flex:1;font-size:.82rem;word-break:break-all;color:var(--accent)"></code>
        <button class="btn btn-sm btn-outline" onclick="copyShareLink(document.getElementById('share-url-text').textContent)">Copy</button>
      </div>
    </div>`;

  openModal(`\uD83D\uDD17 Share "${dbName}"`, body, async () => {
    const permission = document.getElementById('share-perm').value;
    const expiresIn  = document.getElementById('share-expires').value || undefined;
    const label      = document.getElementById('share-label').value.trim();
    try {
      const result = await api('POST', `/databases/${dbId}/share`, { permission, expiresIn, label });
      const fullUrl = `${location.origin}${result.shareUrl}`;
      document.getElementById('share-result').style.display = '';
      document.getElementById('share-url-text').textContent = fullUrl;
      // Refresh the links list without closing modal
      try {
        const updated = await api('GET', `/databases/${dbId}/shares`);
        // rebuild the active links section
        const linksSection = document.querySelector('#modal-body > div:first-child');
        if (linksSection) {
          linksSection.innerHTML = `
            <div style="font-size:.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Active Links</div>
            ${updated.length === 0 ? '<p style="color:var(--text-muted);font-size:.84rem;padding:12px 0">No active share links yet.</p>' :
              `<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
                ${updated.map(l => `
                  <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
                      <div style="display:flex;align-items:center;gap:8px">
                        ${permBadge(l.permission)}
                        ${l.label ? `<span style="font-size:.82rem;color:var(--text-muted)">${esc(l.label)}</span>` : ''}
                      </div>
                      <div style="display:flex;gap:6px">
                        <button class="btn btn-sm btn-outline" onclick="copyShareLink('${l.shareUrl}')">Copy Link</button>
                        <button class="btn btn-sm btn-danger" onclick="revokeShareLink('${l.token}','${dbId}','${esc(dbName)}')">Revoke</button>
                      </div>
                    </div>
                    <div style="margin-top:6px;font-size:.75rem;color:var(--text-muted)">
                      ${l.accessCount} view${l.accessCount !== 1 ? 's' : ''}
                      &bull; Created by ${esc(l.createdBy)}
                      &bull; ${fmtDate(l.createdAt)}
                      ${l.expiresAt ? `&bull; Expires ${fmtDate(l.expiresAt)}` : ''}
                    </div>
                  </div>`).join('')}
              </div>`}`;
        }
      } catch (e) { /* ignore refresh error */ }
    } catch (err) { toast(err.message, 'error'); }
    return false; // Keep modal open
  }, 'Generate Link');
}

function copyShareLink(urlOrPath) {
  const full = urlOrPath.startsWith('http') ? urlOrPath : `${location.origin}${urlOrPath}`;
  navigator.clipboard.writeText(full).then(() => toast('Link copied to clipboard!', 'success'))
    .catch(() => toast(full, 'info'));
}

async function revokeShareLink(token, dbId, dbName) {
  if (!confirm('Revoke this share link? Anyone using it will lose access.')) return;
  try {
    await api('DELETE', `/shares/${token}`);
    toast('Share link revoked', 'success');
    closeModal();
    openShareModal(dbId, dbName);
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Database Templates Marketplace ─────────────────────────────────────────

const DB_TEMPLATES = [
  {
    id: 'crm',
    name: 'CRM',
    icon: '👥',
    category: 'Sales',
    description: 'Track customers, contacts, and companies.',
    defaultName: 'customers',
    fields: [
      { name: 'name',    type: 'string',  required: true  },
      { name: 'email',   type: 'string',  required: true  },
      { name: 'phone',   type: 'string',  required: false },
      { name: 'company', type: 'string',  required: false },
      { name: 'status',  type: 'string',  required: false },
    ],
  },
  {
    id: 'inventory',
    name: 'Inventory',
    icon: '📦',
    category: 'Operations',
    description: 'Manage products, stock levels, and pricing.',
    defaultName: 'inventory',
    fields: [
      { name: 'product',  type: 'string',  required: true  },
      { name: 'sku',      type: 'string',  required: false },
      { name: 'price',    type: 'number',  required: true  },
      { name: 'quantity', type: 'number',  required: true  },
      { name: 'category', type: 'string',  required: false },
    ],
  },
  {
    id: 'expenses',
    name: 'Expenses',
    icon: '💰',
    category: 'Finance',
    description: 'Log and categorize team or personal expenses.',
    defaultName: 'expenses',
    fields: [
      { name: 'title',    type: 'string',  required: true  },
      { name: 'amount',   type: 'number',  required: true  },
      { name: 'date',     type: 'date',    required: true  },
      { name: 'category', type: 'string',  required: false },
      { name: 'paid_by',  type: 'string',  required: false },
    ],
  },
  {
    id: 'bug-tracker',
    name: 'Bug Tracker',
    icon: '🐛',
    category: 'Engineering',
    description: 'Track issues, bugs, and their resolution status.',
    defaultName: 'bugs',
    fields: [
      { name: 'title',      type: 'string',  required: true  },
      { name: 'priority',   type: 'string',  required: true  },
      { name: 'status',     type: 'string',  required: true  },
      { name: 'assignee',   type: 'string',  required: false },
      { name: 'reported_by',type: 'string',  required: false },
    ],
  },
  {
    id: 'job-applications',
    name: 'Job Applications',
    icon: '💼',
    category: 'HR',
    description: 'Track candidates, roles, and hiring pipeline.',
    defaultName: 'job_applications',
    fields: [
      { name: 'company',  type: 'string',  required: true  },
      { name: 'role',     type: 'string',  required: true  },
      { name: 'status',   type: 'string',  required: true  },
      { name: 'applied',  type: 'date',    required: false },
      { name: 'notes',    type: 'string',  required: false },
    ],
  },
  {
    id: 'project-tasks',
    name: 'Project Tasks',
    icon: '✅',
    category: 'Project Management',
    description: 'Manage tasks, owners, and deadlines.',
    defaultName: 'tasks',
    fields: [
      { name: 'task',      type: 'string',  required: true  },
      { name: 'owner',     type: 'string',  required: false },
      { name: 'due_date',  type: 'date',    required: false },
      { name: 'status',    type: 'string',  required: true  },
      { name: 'priority',  type: 'string',  required: false },
    ],
  },
  {
    id: 'events',
    name: 'Events',
    icon: '📅',
    category: 'Marketing',
    description: 'Plan and track events, venues, and attendance.',
    defaultName: 'events',
    fields: [
      { name: 'event_name', type: 'string',  required: true  },
      { name: 'date',       type: 'date',    required: true  },
      { name: 'location',   type: 'string',  required: false },
      { name: 'attendees',  type: 'number',  required: false },
      { name: 'status',     type: 'string',  required: false },
    ],
  },
  {
    id: 'subscriptions',
    name: 'Subscriptions',
    icon: '🔄',
    category: 'Finance',
    description: 'Monitor recurring software or service costs.',
    defaultName: 'subscriptions',
    fields: [
      { name: 'service',    type: 'string',  required: true  },
      { name: 'cost',       type: 'number',  required: true  },
      { name: 'billing',    type: 'string',  required: false },
      { name: 'renewal',    type: 'date',    required: false },
      { name: 'status',     type: 'string',  required: false },
    ],
  },
  {
    id: 'leads',
    name: 'Sales Leads',
    icon: '🎯',
    category: 'Sales',
    description: 'Capture and qualify inbound sales leads.',
    defaultName: 'leads',
    fields: [
      { name: 'name',    type: 'string',  required: true  },
      { name: 'email',   type: 'string',  required: true  },
      { name: 'source',  type: 'string',  required: false },
      { name: 'score',   type: 'number',  required: false },
      { name: 'status',  type: 'string',  required: true  },
    ],
  },
  {
    id: 'content-calendar',
    name: 'Content Calendar',
    icon: '📝',
    category: 'Marketing',
    description: 'Schedule blog posts, social content, and campaigns.',
    defaultName: 'content_calendar',
    fields: [
      { name: 'title',      type: 'string',  required: true  },
      { name: 'channel',    type: 'string',  required: false },
      { name: 'publish_date', type: 'date',  required: false },
      { name: 'author',     type: 'string',  required: false },
      { name: 'status',     type: 'string',  required: true  },
    ],
  },
];

const TEMPLATE_CATEGORIES = [...new Set(DB_TEMPLATES.map(t => t.category))];

function openTemplateMarketplace() {
  let activeCategory = 'All';
  let selectedTemplate = null;

  function renderCards(category) {
    const filtered = category === 'All'
      ? DB_TEMPLATES
      : DB_TEMPLATES.filter(t => t.category === category);

    return filtered.map(t => `
      <div class="tpl-card${selectedTemplate?.id === t.id ? ' selected' : ''}"
           onclick="selectTemplate('${t.id}')" data-id="${t.id}">
        <div class="tpl-icon">${t.icon}</div>
        <div class="tpl-info">
          <div class="tpl-name">${esc(t.name)}</div>
          <div class="tpl-desc">${esc(t.description)}</div>
          <div class="tpl-fields">
            ${t.fields.map(f => `<span class="tpl-field-chip">${esc(f.name)}</span>`).join('')}
          </div>
        </div>
        <div class="tpl-category-tag">${esc(t.category)}</div>
      </div>`).join('');
  }

  function categoryPills() {
    const all = ['All', ...TEMPLATE_CATEGORIES];
    return all.map(c => `
      <button class="tpl-cat-pill${activeCategory === c ? ' active' : ''}"
              onclick="filterTemplates('${esc(c)}')">${esc(c)}</button>`).join('');
  }

  const body = `
    <style>
      .tpl-cats { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px; }
      .tpl-cat-pill {
        padding:4px 12px; border-radius:20px; font-size:.78rem; font-weight:500;
        border:1px solid var(--border); background:transparent; color:var(--text-muted);
        cursor:pointer; transition:all .15s;
      }
      .tpl-cat-pill:hover  { border-color:var(--accent); color:var(--accent); }
      .tpl-cat-pill.active { background:var(--accent); border-color:var(--accent); color:#fff; }
      .tpl-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; max-height:380px; overflow-y:auto; margin-bottom:16px; }
      @media(max-width:520px) { .tpl-grid { grid-template-columns:1fr; } }
      .tpl-card {
        display:flex; flex-direction:column; gap:6px;
        background:var(--bg); border:1px solid var(--border); border-radius:10px;
        padding:12px 14px; cursor:pointer; transition:all .15s; position:relative;
      }
      .tpl-card:hover  { border-color:var(--accent); }
      .tpl-card.selected { border-color:var(--accent); background:rgba(99,102,241,.07); }
      .tpl-icon { font-size:1.5rem; line-height:1; }
      .tpl-name { font-weight:600; font-size:.9rem; }
      .tpl-desc { font-size:.78rem; color:var(--text-muted); margin-top:2px; }
      .tpl-fields { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
      .tpl-field-chip {
        padding:2px 7px; border-radius:10px; font-size:.7rem;
        background:rgba(99,102,241,.1); color:var(--accent);
        border:1px solid rgba(99,102,241,.2);
      }
      .tpl-category-tag {
        position:absolute; top:10px; right:10px;
        font-size:.65rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:.06em;
      }
      .tpl-name-row { display:flex; flex-direction:column; gap:4px; }
      .tpl-name-row label { font-size:.8rem; color:var(--text-muted); }
      .tpl-name-row input {
        background:var(--bg); border:1px solid var(--border); color:var(--text);
        padding:8px 10px; border-radius:7px; font-size:.875rem; width:100%; outline:none;
      }
      .tpl-name-row input:focus { border-color:var(--accent); }
    </style>
    <div class="tpl-cats" id="tpl-cats">${categoryPills()}</div>
    <div class="tpl-grid" id="tpl-grid">${renderCards('All')}</div>
    <div class="tpl-name-row">
      <label>Database name</label>
      <input id="tpl-db-name" type="text" placeholder="Choose a name for your database…">
    </div>`;

  // Expose helpers to onclick handlers
  window.filterTemplates = (cat) => {
    activeCategory = cat;
    document.getElementById('tpl-cats').innerHTML = categoryPills();
    document.getElementById('tpl-grid').innerHTML = renderCards(cat);
  };

  window.selectTemplate = (id) => {
    selectedTemplate = DB_TEMPLATES.find(t => t.id === id) || null;
    document.querySelectorAll('.tpl-card').forEach(el => {
      el.classList.toggle('selected', el.dataset.id === id);
    });
    const nameInput = document.getElementById('tpl-db-name');
    if (nameInput && selectedTemplate && !nameInput.value) {
      nameInput.value = selectedTemplate.defaultName;
    }
  };

  openModal('🧩 Template Marketplace', body, async () => {
    if (!selectedTemplate) return toast('Pick a template first', 'error');
    const name = document.getElementById('tpl-db-name').value.trim();
    if (!name) return toast('Database name is required', 'error');
    try {
      await api('POST', '/databases', { name, fields: selectedTemplate.fields });
      closeModal();
      toast(`✅ "${name}" created from ${selectedTemplate.name} template!`, 'success');
      loadDatabases();
    } catch (err) { toast(err.message, 'error'); }
  }, 'Create Database');
}

document.getElementById('btn-from-template').onclick = openTemplateMarketplace;

// ─── Interactive API Docs Overlay ────────────────────────────────────────────

const DOCS_METHOD_META = {
  GET_list:   { color: '#2dce89', bg: 'rgba(45,206,137,.12)', label: 'GET',    title: 'List all records',   hasBody: false, hasId: false },
  GET_one:    { color: '#2dce89', bg: 'rgba(45,206,137,.12)', label: 'GET',    title: 'Get record by ID',   hasBody: false, hasId: true  },
  POST:       { color: '#6574ff', bg: 'rgba(101,116,255,.12)',label: 'POST',   title: 'Create a record',    hasBody: true,  hasId: false },
  PUT:        { color: '#ffa94d', bg: 'rgba(255,169,77,.12)', label: 'PUT',    title: 'Update a record',    hasBody: true,  hasId: true  },
  DELETE:     { color: '#f06565', bg: 'rgba(240,101,101,.12)',label: 'DELETE', title: 'Delete a record',    hasBody: false, hasId: true  },
};

let _docsApi = null;  // the current database api object shown in docs

function openApiDocs(apiObj) {
  _docsApi = apiObj;
  const baseUrl = `${location.origin}/api/v1/${apiObj.slug}`;

  document.getElementById('apidoc-title').textContent = `${apiObj.name} API`;
  document.getElementById('apidoc-baseurl').textContent = baseUrl;

  // Schema chips
  document.getElementById('apidoc-schema').innerHTML = apiObj.fields.map(f => `
    <div style="background:#141728;border:1px solid #252a3d;border-radius:8px;padding:8px 14px;display:flex;align-items:center;gap:10px;">
      <span style="font-weight:600;color:#dde2f2;font-size:.85rem;">${esc(f.name)}</span>
      <span style="background:rgba(99,102,241,.15);color:#818cf8;border:1px solid rgba(99,102,241,.25);padding:1px 7px;border-radius:10px;font-size:.7rem;">${esc(f.type)}</span>
      ${f.required ? '<span style="color:#f87171;font-size:.7rem;font-weight:600;">required</span>' : '<span style="color:#6b7280;font-size:.7rem;">optional</span>'}
    </div>`).join('');

  // Build endpoint sections
  const exBody = buildExampleBody(apiObj.fields);
  const endpoints = [
    { key: 'GET_list',  method: 'GET',    url: baseUrl,       paramNote: '?limit=50&offset=0' },
    { key: 'GET_one',   method: 'GET',    url: baseUrl + '/:id' },
    { key: 'POST',      method: 'POST',   url: baseUrl },
    { key: 'PUT',       method: 'PUT',    url: baseUrl + '/:id' },
    { key: 'DELETE',    method: 'DELETE', url: baseUrl + '/:id' },
  ];

  document.getElementById('apidoc-endpoints').innerHTML = endpoints.map((ep, i) => {
    const meta = DOCS_METHOD_META[ep.key];
    const epId = `ep-${i}`;
    return buildEndpointSection(ep, meta, epId, exBody, apiObj.fields);
  }).join('');

  document.getElementById('apidoc-overlay').style.display = '';
  document.body.style.overflow = 'hidden';

  // Pre-fill API key if user has one stored in the page
  tryPrefillApiKey();
}

function closeApiDocs() {
  document.getElementById('apidoc-overlay').style.display = 'none';
  document.body.style.overflow = '';
  _docsApi = null;
}

function toggleApiKeyVis() {
  const inp = document.getElementById('apidoc-apikey');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

function tryPrefillApiKey() {
  // If the user already typed a key in a previous session this page load, reuse it
  const saved = sessionStorage.getItem('apidoc_key');
  const inp   = document.getElementById('apidoc-apikey');
  if (saved && inp) inp.value = saved;
}

function buildExampleBody(fields) {
  const obj = {};
  for (const f of fields) {
    obj[f.name] = f.type === 'number' ? 0
                : f.type === 'boolean' ? false
                : f.type === 'date'    ? new Date().toISOString().slice(0, 10)
                : 'example';
  }
  return JSON.stringify({ data: obj }, null, 2);
}

function buildEndpointSection(ep, meta, epId, exBody, fields) {
  const displayUrl = ep.url + (ep.paramNote ? ep.paramNote : '');
  const curlLines  = buildCurl(ep, meta, exBody);

  const paramsHtml = ep.key === 'GET_list' ? `
    <div class="docs-params">
      <div class="docs-params-title">Query Parameters</div>
      <div class="docs-param-row"><code>limit</code><span>number</span><span style="color:#6b7280">Max records to return (default 100)</span></div>
      <div class="docs-param-row"><code>offset</code><span>number</span><span style="color:#6b7280">Skip N records for pagination</span></div>
    </div>` : '';

  const idParamHtml = meta.hasId ? `
    <div class="docs-params">
      <div class="docs-params-title">Path Parameter</div>
      <div class="docs-param-row"><code>:id</code><span>string</span><span style="color:#6b7280">UUID of the record</span></div>
    </div>` : '';

  const bodyHtml = meta.hasBody ? `
    <div class="docs-params">
      <div class="docs-params-title">Request Body <span style="color:#6b7280;font-weight:400">(application/json)</span></div>
      ${fields.map(f => `
        <div class="docs-param-row">
          <code>${esc(f.name)}</code>
          <span>${esc(f.type)}</span>
          <span style="color:${f.required ? '#f87171' : '#6b7280'}">${f.required ? 'required' : 'optional'}</span>
        </div>`).join('')}
    </div>` : '';

  return `
    <div class="docs-ep-section" id="${epId}-section">
      <div class="docs-ep-header" onclick="toggleDocsSection('${epId}')">
        <div style="display:flex;align-items:center;gap:12px;min-width:0;">
          <span class="docs-method-badge" style="background:${meta.bg};color:${meta.color};border-color:${meta.color}44;">${meta.label}</span>
          <code class="docs-ep-path">${esc(ep.url)}</code>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
          <span style="color:#9ca3af;font-size:.82rem;">${esc(meta.title)}</span>
          <span class="docs-chevron" id="${epId}-chevron">▶</span>
        </div>
      </div>

      <div class="docs-ep-body hidden" id="${epId}-body">
        ${paramsHtml}${idParamHtml}${bodyHtml}

        <!-- cURL example -->
        <div class="docs-params" style="margin-top:0;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <div class="docs-params-title" style="margin-bottom:0;">cURL Example</div>
            <button class="docs-copy-btn" onclick="copyText(${JSON.stringify(curlLines)})">Copy</button>
          </div>
          <pre class="docs-curl-pre">${esc(curlLines)}</pre>
        </div>

        <!-- Try It panel -->
        <div class="docs-tryit-wrap">
          <div style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-bottom:10px;">Try It</div>
          ${meta.hasId ? `<div style="margin-bottom:10px;">
            <label style="font-size:.78rem;color:#9ca3af;display:block;margin-bottom:4px;">Record ID</label>
            <input id="${epId}-record-id" type="text" placeholder="Paste a record UUID…"
              style="width:100%;background:#0c0e1a;border:1px solid #252a3d;color:#dde2f2;padding:7px 10px;border-radius:7px;font-size:.82rem;font-family:monospace;outline:none;">
          </div>` : ''}
          ${ep.key === 'GET_list' ? `<div style="display:flex;gap:8px;margin-bottom:10px;">
            <div style="flex:1">
              <label style="font-size:.78rem;color:#9ca3af;display:block;margin-bottom:4px;">limit</label>
              <input id="${epId}-limit" type="number" value="50" min="1" max="500"
                style="width:100%;background:#0c0e1a;border:1px solid #252a3d;color:#dde2f2;padding:7px 10px;border-radius:7px;font-size:.82rem;outline:none;">
            </div>
            <div style="flex:1">
              <label style="font-size:.78rem;color:#9ca3af;display:block;margin-bottom:4px;">offset</label>
              <input id="${epId}-offset" type="number" value="0" min="0"
                style="width:100%;background:#0c0e1a;border:1px solid #252a3d;color:#dde2f2;padding:7px 10px;border-radius:7px;font-size:.82rem;outline:none;">
            </div>
          </div>` : ''}
          ${meta.hasBody ? `<div style="margin-bottom:10px;">
            <label style="font-size:.78rem;color:#9ca3af;display:block;margin-bottom:4px;">Request body (JSON)</label>
            <textarea id="${epId}-body" rows="6" spellcheck="false"
              style="width:100%;background:#0c0e1a;border:1px solid #252a3d;color:#dde2f2;padding:8px 10px;border-radius:7px;font-size:.8rem;font-family:monospace;resize:vertical;outline:none;">${esc(exBody)}</textarea>
          </div>` : ''}
          <div style="display:flex;align-items:center;gap:10px;">
            <button onclick="sendTryIt('${epId}','${ep.key}','${ep.url}')"
              style="background:#6366f1;color:#fff;border:none;padding:8px 20px;border-radius:8px;font-size:.85rem;font-weight:500;cursor:pointer;">
              ▶ Send
            </button>
            <span id="${epId}-status" style="font-size:.8rem;"></span>
          </div>
          <div id="${epId}-response" style="display:none;margin-top:12px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <div style="font-size:.75rem;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.08em;">Response</div>
              <button class="docs-copy-btn" onclick="copyResponseJson('${epId}')">Copy</button>
            </div>
            <pre id="${epId}-response-body" class="docs-curl-pre" style="max-height:320px;overflow-y:auto;"></pre>
          </div>
        </div>
      </div>
    </div>`;
}

function buildCurl(ep, meta, exBody) {
  const apiKey = 'YOUR_API_KEY';
  const url    = ep.url.replace('/:id', '/RECORD_ID');
  if (meta.label === 'GET' && !meta.hasId) {
    return `curl -H "X-API-Key: ${apiKey}" \\\n  "${url}?limit=50&offset=0"`;
  }
  if (meta.label === 'GET') {
    return `curl -H "X-API-Key: ${apiKey}" \\\n  "${url}"`;
  }
  if (meta.hasBody) {
    return `curl -X ${meta.label} \\\n  -H "X-API-Key: ${apiKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '${exBody.replace(/'/g, "\\'")}' \\\n  "${url}"`;
  }
  return `curl -X ${meta.label} \\\n  -H "X-API-Key: ${apiKey}" \\\n  "${url}"`;
}

function toggleDocsSection(epId) {
  const body    = document.getElementById(`${epId}-body`);
  const chevron = document.getElementById(`${epId}-chevron`);
  const hidden  = body.classList.toggle('hidden');
  chevron.textContent = hidden ? '▶' : '▼';
}

async function sendTryIt(epId, epKey, urlTemplate) {
  const apiKeyEl = document.getElementById('apidoc-apikey');
  const apiKey   = apiKeyEl.value.trim();
  if (!apiKey) { toast('Paste your API key in the bar above first', 'error'); return; }

  sessionStorage.setItem('apidoc_key', apiKey);

  const statusEl   = document.getElementById(`${epId}-status`);
  const responseEl = document.getElementById(`${epId}-response`);
  const bodyEl     = document.getElementById(`${epId}-response-body`);

  // Build URL
  let url = urlTemplate;
  if (DOCS_METHOD_META[epKey].hasId) {
    const recId = (document.getElementById(`${epId}-record-id`) || {}).value?.trim();
    if (!recId) { toast('Enter a Record ID', 'error'); return; }
    url = url.replace('/:id', `/${recId}`);
  }
  if (epKey === 'GET_list') {
    const limit  = document.getElementById(`${epId}-limit`)?.value  || 50;
    const offset = document.getElementById(`${epId}-offset`)?.value || 0;
    url += `?limit=${limit}&offset=${offset}`;
  }

  // Build fetch options
  const opts = { headers: { 'X-API-Key': apiKey } };
  const meta = DOCS_METHOD_META[epKey];
  opts.method = meta.label;

  if (meta.hasBody) {
    const raw = document.getElementById(`${epId}-body`)?.value || '{}';
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { toast('Request body is not valid JSON', 'error'); return; }
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(parsed);
  }

  statusEl.textContent = 'Sending…';
  statusEl.style.color = '#9ca3af';
  responseEl.style.display = 'none';

  const t0 = Date.now();
  try {
    const res   = await fetch(url, opts);
    const ms    = Date.now() - t0;
    const text  = await res.text();
    let pretty;
    try { pretty = JSON.stringify(JSON.parse(text), null, 2); }
    catch { pretty = text; }

    const ok = res.status < 400;
    statusEl.textContent = `${res.status} ${res.statusText}  •  ${ms}ms`;
    statusEl.style.color = ok ? '#2dce89' : '#f06565';
    bodyEl.textContent   = pretty;
    bodyEl.style.color   = ok ? '#a5f3c4' : '#fca5a5';
    responseEl.style.display = '';
    responseEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    statusEl.textContent = 'Network error: ' + err.message;
    statusEl.style.color = '#f06565';
  }
}

function copyResponseJson(epId) {
  const text = document.getElementById(`${epId}-response-body`)?.textContent || '';
  navigator.clipboard.writeText(text).then(() => toast('Copied!', 'success'));
}

// Inject docs overlay styles once
(function injectDocsStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .docs-ep-section {
      border: 1px solid #252a3d;
      border-radius: 10px;
      margin-bottom: 10px;
      overflow: hidden;
    }
    .docs-ep-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      cursor: pointer;
      gap: 12px;
      transition: background .15s;
    }
    .docs-ep-header:hover { background: rgba(255,255,255,.025); }
    .docs-ep-body {
      padding: 0 18px 18px;
      border-top: 1px solid #252a3d;
    }
    .docs-ep-body.hidden { display: none; }
    .docs-method-badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 6px;
      font-size: .72rem;
      font-weight: 700;
      letter-spacing: .05em;
      border: 1px solid transparent;
      flex-shrink: 0;
      min-width: 56px;
      text-align: center;
    }
    .docs-ep-path {
      font-size: .82rem;
      color: #dde2f2;
      word-break: break-all;
    }
    .docs-chevron {
      color: #6b7280;
      font-size: .7rem;
      transition: transform .15s;
    }
    .docs-params {
      background: #0c0e1a;
      border: 1px solid #252a3d;
      border-radius: 8px;
      padding: 12px 14px;
      margin-top: 14px;
    }
    .docs-params-title {
      font-size: .72rem;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: #6b7280;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .docs-param-row {
      display: grid;
      grid-template-columns: 140px 80px 1fr;
      gap: 8px;
      padding: 5px 0;
      border-bottom: 1px solid #1a1e2e;
      font-size: .82rem;
      align-items: center;
    }
    .docs-param-row:last-child { border-bottom: none; }
    .docs-param-row code { color: #a5b4fc; font-family: monospace; }
    .docs-param-row span:nth-child(2) { color: #818cf8; font-size: .75rem; }
    .docs-curl-pre {
      background: #0c0e1a;
      border: 1px solid #252a3d;
      border-radius: 8px;
      padding: 12px 14px;
      font-size: .78rem;
      font-family: monospace;
      white-space: pre-wrap;
      word-break: break-all;
      color: #a5f3c4;
      margin: 0;
    }
    .docs-copy-btn {
      background: none;
      border: 1px solid #252a3d;
      color: #9ca3af;
      padding: 3px 10px;
      border-radius: 6px;
      font-size: .72rem;
      cursor: pointer;
    }
    .docs-copy-btn:hover { border-color: #6366f1; color: #6366f1; }
    .docs-tryit-wrap {
      margin-top: 14px;
      background: #141728;
      border: 1px solid #252a3d;
      border-radius: 8px;
      padding: 14px;
    }
    @media (max-width: 600px) {
      .docs-param-row { grid-template-columns: 1fr 1fr; }
      .docs-param-row span:nth-child(3) { grid-column: 1/-1; }
    }
  `;
  document.head.appendChild(style);
}());

// ─── Visual Drag-and-Drop Schema Builder ─────────────────────────────────────

const SB_PAL = ['#6366f1','#8b5cf6','#ec4899','#06b6d4','#10b981','#f59e0b','#3b82f6','#ef4444'];
const SB_TW  = 264;   // table card width
const SB_HH  = 44;    // header height
const SB_FH  = 36;    // field row height

let _sbTables = [];   // { id, name, x, y, color, dbId?, fields:[{id,name,type,required}] }
let _sbRels   = [];   // { id, fromTbl, fromField, toTbl, toField, relType }
let _sbCtr    = 0;
let _sbDrag   = null; // { tblId, sx, sy, ox, oy }
let _sbConn   = null; // { fromTbl, fromField, cx, cy }

const sbId = () => `sb${++_sbCtr}`;

// ── Type auto-suggester ───────────────────────────────────────────────────────
function sbSuggestType(name) {
  const n = name.toLowerCase();
  if (/price|cost|amount|salary|budget|age|count|qty|quantity|score|total|rate|fee|size|weight|height|width|year|num/.test(n))
    return 'number';
  if (/date|_at$|_on$|time$|dob$|expir|deadline|birthday|created|updated/.test(n))
    return 'date';
  if (/^is_|^has_|active$|enabled$|verified$|visible$|published$|deleted$|archived$/.test(n))
    return 'boolean';
  return 'string';
}

// ── Open / Close ──────────────────────────────────────────────────────────────
function openSchemaBuilder() {
  _sbTables = []; _sbRels = []; _sbCtr = 0; _sbDrag = null; _sbConn = null;
  document.getElementById('sb-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';

  api('GET', '/databases').then(dbs => {
    if (!dbs.length) {
      sbAddTable(100, 90, false);
    } else {
      const cols = Math.min(dbs.length, 3);
      dbs.forEach((db, i) => {
        _sbTables.push({
          id: sbId(), name: db.name, dbId: db.id,
          x: 80 + (i % cols) * 320,
          y: 80 + Math.floor(i / cols) * 300,
          color: SB_PAL[i % SB_PAL.length],
          fields: db.fields.map(f => ({ id: sbId(), name: f.name, type: f.type, required: !!f.required })),
        });
      });
    }
    sbRenderAll();
  }).catch(() => { sbAddTable(100, 90, false); sbRenderAll(); });
}

function closeSchemaBuilder() {
  document.getElementById('sb-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

// ── Table CRUD ────────────────────────────────────────────────────────────────
function sbAddTable(x, y, doRender = true) {
  const tbl = {
    id: sbId(),
    name: 'new_table',
    x: x ?? 80 + (_sbTables.length % 3) * 320,
    y: y ?? 80 + Math.floor(_sbTables.length / 3) * 300,
    color: SB_PAL[_sbTables.length % SB_PAL.length],
    fields: [{ id: sbId(), name: 'id', type: 'string', required: true }],
  };
  _sbTables.push(tbl);
  if (doRender) {
    sbRenderAll();
    setTimeout(() => { const el = document.getElementById(`sbt-name-${tbl.id}`); if (el) { el.focus(); el.select(); } }, 40);
  }
  return tbl;
}

function sbDeleteTable(tblId, e) {
  if (e) e.stopPropagation();
  _sbTables = _sbTables.filter(t => t.id !== tblId);
  _sbRels   = _sbRels.filter(r => r.fromTbl !== tblId && r.toTbl !== tblId);
  sbRenderAll();
}

// ── Field CRUD ────────────────────────────────────────────────────────────────
function sbAddField(tblId) {
  const tbl = _sbTables.find(t => t.id === tblId);
  if (!tbl) return;
  const f = { id: sbId(), name: '', type: 'string', required: false };
  tbl.fields.push(f);
  sbRenderAll();
  setTimeout(() => { const el = document.getElementById(`sbf-name-${f.id}`); if (el) el.focus(); }, 40);
}

function sbDeleteField(tblId, fieldId, e) {
  if (e) e.stopPropagation();
  const tbl = _sbTables.find(t => t.id === tblId);
  if (!tbl) return;
  tbl.fields = tbl.fields.filter(f => f.id !== fieldId);
  _sbRels = _sbRels.filter(r =>
    !(r.fromTbl === tblId && r.fromField === fieldId) &&
    !(r.toTbl   === tblId && r.toField   === fieldId)
  );
  sbRenderAll();
}

function sbUpdateTableName(tblId, val) {
  const tbl = _sbTables.find(t => t.id === tblId);
  if (tbl) { tbl.name = val; sbUpdateSvg(); }
}

function sbUpdateFieldName(tblId, fieldId, val) {
  const tbl = _sbTables.find(t => t.id === tblId);
  if (!tbl) return;
  const f = tbl.fields.find(x => x.id === fieldId);
  if (!f) return;
  f.name = val;
  if (!f._manualType) {
    const sug = sbSuggestType(val);
    if (f.type !== sug) {
      f.type = sug;
      const sel = document.getElementById(`sbf-type-${fieldId}`);
      if (sel) sel.value = sug;
    }
  }
}

function sbUpdateFieldType(tblId, fieldId, val) {
  const tbl = _sbTables.find(t => t.id === tblId);
  const f   = tbl?.fields.find(x => x.id === fieldId);
  if (f) { f.type = val; f._manualType = true; }
}

function sbUpdateFieldReq(tblId, fieldId, val) {
  const tbl = _sbTables.find(t => t.id === tblId);
  const f   = tbl?.fields.find(x => x.id === fieldId);
  if (f) f.required = val;
}

function sbDeleteRelation(relId) {
  _sbRels = _sbRels.filter(r => r.id !== relId);
  sbUpdateSvg();
}

// ── Drag (move tables) ────────────────────────────────────────────────────────
function sbStartDrag(e, tblId) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'SPAN') return;
  e.preventDefault();
  const tbl = _sbTables.find(t => t.id === tblId);
  if (!tbl) return;
  _sbDrag = { tblId, sx: e.clientX, sy: e.clientY, ox: tbl.x, oy: tbl.y };
  document.getElementById(`sbt-${tblId}`)?.classList.add('sb-dragging');
}

function sbOnMouseMove(e) {
  if (_sbDrag) {
    const tbl = _sbTables.find(t => t.id === _sbDrag.tblId);
    if (tbl) {
      tbl.x = Math.max(0, _sbDrag.ox + (e.clientX - _sbDrag.sx));
      tbl.y = Math.max(0, _sbDrag.oy + (e.clientY - _sbDrag.sy));
      const el = document.getElementById(`sbt-${tbl.id}`);
      if (el) { el.style.left = tbl.x + 'px'; el.style.top = tbl.y + 'px'; }
      sbUpdateSvg();
    }
  }
  if (_sbConn) {
    const wrap = document.getElementById('sb-canvas-wrap');
    const rect = wrap.getBoundingClientRect();
    _sbConn.cx = e.clientX - rect.left + wrap.scrollLeft;
    _sbConn.cy = e.clientY - rect.top  + wrap.scrollTop;
    sbUpdateSvg();
  }
}

function sbOnMouseUp(e) {
  if (_sbDrag) {
    document.getElementById(`sbt-${_sbDrag.tblId}`)?.classList.remove('sb-dragging');
    _sbDrag = null;
  }
  if (_sbConn) { _sbConn = null; sbUpdateSvg(); }
}

// ── Connect (draw relations) ──────────────────────────────────────────────────
function sbStartConnect(e, tblId, fieldId) {
  e.stopPropagation(); e.preventDefault();
  const wrap = document.getElementById('sb-canvas-wrap');
  const rect = wrap.getBoundingClientRect();
  _sbConn = {
    fromTbl: tblId, fromField: fieldId,
    cx: e.clientX - rect.left + wrap.scrollLeft,
    cy: e.clientY - rect.top  + wrap.scrollTop,
  };
}

function sbFinishConnect(e, tblId, fieldId) {
  e.stopPropagation();
  if (!_sbConn) return;
  if (_sbConn.fromTbl === tblId && _sbConn.fromField === fieldId) {
    _sbConn = null; sbUpdateSvg(); return;
  }
  _sbRels.push({
    id: sbId(),
    fromTbl: _sbConn.fromTbl, fromField: _sbConn.fromField,
    toTbl:   tblId,           toField:   fieldId,
    relType: document.getElementById('sb-rel-type').value,
  });
  _sbConn = null;
  sbUpdateSvg();
}

// ── Position helpers ──────────────────────────────────────────────────────────
function sbDotPos(tblId, fieldId, side) {
  const tbl = _sbTables.find(t => t.id === tblId);
  if (!tbl) return null;
  const fi = tbl.fields.findIndex(f => f.id === fieldId);
  if (fi < 0) return null;
  return {
    x: side === 'right' ? tbl.x + SB_TW : tbl.x,
    y: tbl.y + SB_HH + fi * SB_FH + SB_FH / 2,
  };
}

// ── Render ────────────────────────────────────────────────────────────────────
function sbRenderAll() {
  const canvas = document.getElementById('sb-canvas');
  if (!canvas) return;
  canvas.querySelectorAll('.sb-table').forEach(el => el.remove());
  for (const tbl of _sbTables) {
    const div = document.createElement('div');
    div.className = 'sb-table';
    div.id = `sbt-${tbl.id}`;
    div.style.cssText = `left:${tbl.x}px;top:${tbl.y}px;--tbl-color:${tbl.color};`;
    div.innerHTML = sbTableHtml(tbl);
    canvas.appendChild(div);
  }
  sbUpdateSvg();
}

function sbTableHtml(tbl) {
  const fields = tbl.fields.map(f => `
    <div class="sb-field-row">
      <span class="sb-dot" title="Drag to connect"
            onmousedown="sbStartConnect(event,'${tbl.id}','${f.id}')"
            onmouseup="sbFinishConnect(event,'${tbl.id}','${f.id}')">&#9679;</span>
      <input class="sb-finput" id="sbf-name-${f.id}" value="${esc(f.name)}" placeholder="field name"
             oninput="sbUpdateFieldName('${tbl.id}','${f.id}',this.value)"
             onmousedown="event.stopPropagation()" />
      <select class="sb-ftype" id="sbf-type-${f.id}"
              onchange="sbUpdateFieldType('${tbl.id}','${f.id}',this.value)"
              onmousedown="event.stopPropagation()">
        ${['string','number','boolean','date'].map(t =>
          `<option value="${t}"${f.type===t?' selected':''}>${t[0].toUpperCase()}</option>`
        ).join('')}
      </select>
      <label class="sb-req" title="Required" onmousedown="event.stopPropagation()">
        <input type="checkbox" ${f.required ? 'checked' : ''} onchange="sbUpdateFieldReq('${tbl.id}','${f.id}',this.checked)">R
      </label>
      <button class="sb-xbtn" onclick="sbDeleteField('${tbl.id}','${f.id}',event)" title="Remove"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8"/></svg></button>
    </div>`).join('');

  return `
    <div class="sb-thead" onmousedown="sbStartDrag(event,'${tbl.id}')">
      <input class="sb-tname" id="sbt-name-${tbl.id}" value="${esc(tbl.name)}"
             oninput="sbUpdateTableName('${tbl.id}',this.value)" onmousedown="event.stopPropagation()">
      ${tbl.dbId ? '<span class="sb-exists-tag">existing</span>' : ''}
      <button class="sb-xbtn sb-xbtn-tbl" onclick="sbDeleteTable('${tbl.id}',event)" title="Delete table"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8"/></svg></button>
    </div>
    <div class="sb-tbody">${fields}</div>
    <div class="sb-tfoot">
      <button class="sb-add-field" onclick="sbAddField('${tbl.id}')">+ field</button>
    </div>`;
}

// ── SVG Arrows ────────────────────────────────────────────────────────────────
const SB_REL_COLOR = { 'one-to-one': '#6366f1', 'one-to-many': '#10b981', 'many-to-many': '#f59e0b' };
const SB_REL_LABEL = { 'one-to-one': '1:1',     'one-to-many': '1:N',     'many-to-many': 'N:M'    };

function sbUpdateSvg() {
  const svg = document.getElementById('sb-svg');
  if (!svg) return;

  const defs = `<defs>
    ${Object.entries(SB_REL_COLOR).map(([k, c]) => `
      <marker id="sbm-${k}" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto">
        <polygon points="0 0,9 4,0 8" fill="${c}" />
      </marker>`).join('')}
  </defs>`;

  const arrows = _sbRels.map(rel => {
    const s = sbDotPos(rel.fromTbl, rel.fromField, 'right');
    const t = sbDotPos(rel.toTbl,   rel.toField,   'left');
    if (!s || !t) return '';
    const col = SB_REL_COLOR[rel.relType] || '#6366f1';
    const lbl = SB_REL_LABEL[rel.relType] || '?';
    const dx  = Math.max(70, Math.abs(t.x - s.x) * 0.45);
    const d   = `M${s.x},${s.y} C${s.x+dx},${s.y} ${t.x-dx},${t.y} ${t.x},${t.y}`;
    const mx  = (s.x + t.x) / 2;
    const my  = (s.y + t.y) / 2 - 12;
    return `
      <path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="6,3"
            marker-end="url(#sbm-${rel.relType})" style="cursor:pointer;"
            onclick="sbDeleteRelation('${rel.id}')"
            onmouseenter="this.setAttribute('stroke-width','3')"
            onmouseleave="this.setAttribute('stroke-width','2')" />
      <rect x="${mx-16}" y="${my-8}" width="32" height="16" rx="4"
            fill="#141728" stroke="${col}" stroke-width="1" style="pointer-events:none;" />
      <text x="${mx}" y="${my+5}" text-anchor="middle" fill="${col}" font-size="10"
            font-family="monospace" font-weight="700" style="pointer-events:none;">${lbl}</text>`;
  }).join('');

  const tempLine = _sbConn ? (() => {
    const s = sbDotPos(_sbConn.fromTbl, _sbConn.fromField, 'right');
    if (!s) return '';
    return `
      <line x1="${s.x}" y1="${s.y}" x2="${_sbConn.cx}" y2="${_sbConn.cy}"
            stroke="#6366f1" stroke-width="2" stroke-dasharray="6,3" opacity=".75" style="pointer-events:none;" />
      <circle cx="${s.x}" cy="${s.y}" r="5" fill="#6366f1" style="pointer-events:none;" />
      <circle cx="${_sbConn.cx}" cy="${_sbConn.cy}" r="4" fill="#6366f1" opacity=".6" style="pointer-events:none;" />`;
  })() : '';

  svg.innerHTML = defs + arrows + tempLine;
}

// ── Deploy ────────────────────────────────────────────────────────────────────
async function sbDeploy() {
  const newTbls = _sbTables.filter(t => !t.dbId);
  if (!_sbTables.length) return toast('Add at least one table first', 'error');
  if (_sbTables.some(t => !t.name.trim()))              return toast('All tables need a name', 'error');
  if (_sbTables.some(t => t.fields.some(f => !f.name.trim()))) return toast('All fields need a name', 'error');

  const btn = document.getElementById('sb-deploy-btn');
  btn.disabled = true; btn.textContent = 'Deploying…';

  try {
    // 1. Create new databases
    for (const tbl of newTbls) {
      const res = await api('POST', '/databases', {
        name:   tbl.name.trim(),
        fields: tbl.fields.map(f => ({ name: f.name.trim(), type: f.type, required: !!f.required })),
      });
      tbl.dbId = res.id;
    }

    // 2. Create relationships
    let relOk = 0, relFail = 0;
    for (const rel of _sbRels) {
      const fTbl = _sbTables.find(t => t.id === rel.fromTbl);
      const tTbl = _sbTables.find(t => t.id === rel.toTbl);
      const fFld = fTbl?.fields.find(f => f.id === rel.fromField);
      const tFld = tTbl?.fields.find(f => f.id === rel.toField);
      if (!fTbl?.dbId || !tTbl?.dbId || !fFld || !tFld) { relFail++; continue; }

      const pairs = rel.relType === 'many-to-many'
        ? [ { from: fTbl.dbId, fromF: fFld.name, to: tTbl.dbId, toF: tFld.name, type: 'one-to-many' },
            { from: tTbl.dbId, fromF: tFld.name, to: fTbl.dbId, toF: fFld.name, type: 'one-to-many' } ]
        : [ { from: fTbl.dbId, fromF: fFld.name, to: tTbl.dbId, toF: tFld.name, type: rel.relType } ];

      for (const p of pairs) {
        try {
          await api('POST', '/relationships', { fromDb: p.from, fromField: p.fromF, toDb: p.to, toField: p.toF, type: p.type });
          relOk++;
        } catch { relFail++; }
      }
    }

    const created = newTbls.length;
    toast(`✅ ${created} table${created!==1?'s':''} + ${relOk} relation${relOk!==1?'s':''} deployed!`, 'success');
    if (relFail) toast(`${relFail} relation(s) skipped — check field names match`, 'error');
    loadDatabases();
    setTimeout(closeSchemaBuilder, 700);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '⚡ Deploy to FluxDB';
  }
}

// ── Wire up buttons ───────────────────────────────────────────────────────────
document.getElementById('btn-schema-builder').onclick = openSchemaBuilder;
document.getElementById('sb-add-table-btn').onclick   = () => sbAddTable();
document.getElementById('sb-deploy-btn').onclick      = sbDeploy;

// ── Inject Schema Builder CSS ─────────────────────────────────────────────────
(function injectSbStyles() {
  const s = document.createElement('style');
  s.textContent = `
    #sb-overlay { display: none; }
    .sb-table {
      position: absolute;
      width: ${SB_TW}px;
      background: #141728;
      border: 1px solid color-mix(in srgb, var(--tbl-color) 30%, #252a3d);
      border-radius: 10px;
      box-shadow: 0 4px 20px rgba(0,0,0,.5);
      user-select: none;
      z-index: 2;
      transition: box-shadow .15s;
    }
    .sb-table:hover { box-shadow: 0 6px 28px rgba(0,0,0,.6); }
    .sb-dragging { box-shadow: 0 10px 40px rgba(0,0,0,.7) !important; z-index: 10 !important; opacity: .92; }
    .sb-thead {
      padding: 0 8px 0 12px;
      height: ${SB_HH}px;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: grab;
      background: color-mix(in srgb, var(--tbl-color) 12%, #141728);
      border-bottom: 1px solid color-mix(in srgb, var(--tbl-color) 25%, #252a3d);
      border-radius: 9px 9px 0 0;
    }
    .sb-thead:active { cursor: grabbing; }
    .sb-tname {
      flex: 1;
      background: none;
      border: none;
      color: #dde2f2;
      font-size: .88rem;
      font-weight: 700;
      outline: none;
      min-width: 0;
    }
    .sb-tname:focus {
      background: rgba(255,255,255,.05);
      border-radius: 4px;
      padding: 0 4px;
    }
    .sb-exists-tag {
      font-size: .62rem;
      background: rgba(16,185,129,.15);
      color: #34d399;
      border: 1px solid rgba(16,185,129,.3);
      padding: 1px 6px;
      border-radius: 10px;
      flex-shrink: 0;
    }
    .sb-tbody { padding: 2px 0; }
    .sb-field-row {
      height: ${SB_FH}px;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 8px;
      border-bottom: 1px solid rgba(255,255,255,.04);
    }
    .sb-field-row:last-child { border-bottom: none; }
    .sb-field-row:hover { background: rgba(255,255,255,.025); }
    .sb-dot {
      color: #4b5563;
      font-size: .65rem;
      cursor: crosshair;
      flex-shrink: 0;
      padding: 4px 2px;
      transition: color .15s, transform .1s;
      user-select: none;
    }
    .sb-dot:hover { color: var(--tbl-color, #6366f1); transform: scale(1.4); }
    .sb-finput {
      flex: 1;
      background: none;
      border: none;
      color: #dde2f2;
      font-size: .78rem;
      outline: none;
      min-width: 0;
    }
    .sb-finput:focus { background: rgba(255,255,255,.05); border-radius: 3px; padding: 0 3px; }
    .sb-finput::placeholder { color: #374151; }
    .sb-ftype {
      background: rgba(99,102,241,.1);
      border: 1px solid rgba(99,102,241,.2);
      color: #a5b4fc;
      font-size: .68rem;
      border-radius: 5px;
      padding: 2px 4px;
      outline: none;
      flex-shrink: 0;
      cursor: pointer;
    }
    .sb-req {
      font-size: .65rem;
      color: #6b7280;
      display: flex;
      align-items: center;
      gap: 2px;
      flex-shrink: 0;
      cursor: pointer;
    }
    .sb-req input { accent-color: #6366f1; }
    .sb-xbtn {
      background: none;
      border: none;
      color: #374151;
      font-size: .75rem;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 4px;
      flex-shrink: 0;
      line-height: 1;
      transition: color .15s, background .15s;
    }
    .sb-xbtn:hover { color: #ef4444; background: rgba(239,68,68,.1); }
    .sb-xbtn-tbl:hover { color: #ef4444; }
    .sb-tfoot {
      padding: 5px 8px;
      border-top: 1px solid rgba(255,255,255,.05);
      border-radius: 0 0 9px 9px;
    }
    .sb-add-field {
      background: none;
      border: 1px dashed #374151;
      color: #6b7280;
      font-size: .75rem;
      padding: 3px 10px;
      border-radius: 6px;
      cursor: pointer;
      width: 100%;
      transition: border-color .15s, color .15s;
    }
    .sb-add-field:hover { border-color: var(--tbl-color, #6366f1); color: var(--tbl-color, #6366f1); }
    #sb-svg path { pointer-events: stroke; }
    #sb-svg path:hover { filter: brightness(1.3); }
  `;
  document.head.appendChild(s);
}());

// ─── System Templates View ────────────────────────────────────────────────────

const TPL_CAT_COLORS = {
  'CRM': '#6366f1', 'Content': '#8b5cf6', 'Engineering': '#ec4899',
  'Finance': '#10b981', 'HR': '#06b6d4', 'E-Commerce': '#f59e0b',
  'Operations': '#3b82f6', 'General': '#6b7280',
};

async function loadDbTemplates() {
  const wrap = document.getElementById('dbtpl-list');
  wrap.innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    const tpls = await api('GET', '/db-templates');
    if (!tpls.length) {
      const hint = currentUser.role === 'admin'
        ? 'No templates yet. Click <b>+ Create Template</b> to build a reusable system for your users.'
        : 'No system templates available yet. Ask your admin to create some.';
      wrap.innerHTML = `<div class="empty-state">${hint}</div>`;
      return;
    }

    // Group by category
    const groups = {};
    for (const t of tpls) {
      const cat = t.category || 'General';
      (groups[cat] = groups[cat] || []).push(t);
    }

    wrap.innerHTML = Object.entries(groups).map(([cat, items]) => `
      <div style="margin-bottom:32px;">
        <div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);margin-bottom:12px;font-weight:600;">${esc(cat)}</div>
        <div class="grid-cards" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr));">
          ${items.map(t => renderTplCard(t)).join('')}
        </div>
      </div>`).join('');
  } catch (e) {
    wrap.innerHTML = `<p class="empty-state" style="color:var(--danger)">${esc(e.message)}</p>`;
  }
}

function renderTplCard(t) {
  const isAdmin = currentUser.role === 'admin';
  const catColor = TPL_CAT_COLORS[t.category] || '#6b7280';
  const dbChips  = t.databases.map(d =>
    `<span style="background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.2);color:#a5b4fc;padding:2px 8px;border-radius:10px;font-size:.72rem;">${esc(d.name)}</span>`
  ).join('');
  const adminBtns = isAdmin ? `
    <button class="btn btn-sm btn-outline" onclick="openEditTplModal(${JSON.stringify(t.id)})">${IC.edit} Edit</button>
    <button class="btn btn-sm btn-danger"  onclick="deleteTpl(${JSON.stringify(t.id)}, ${JSON.stringify(t.name)})">${IC.trash}</button>` : '';
  return `
    <div class="db-card" style="display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;align-items:flex-start;gap:12px;">
        <span style="font-size:2rem;line-height:1;flex-shrink:0;">${esc(t.icon || '🗄️')}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:.95rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${esc(t.name)}
            <span style="background:${catColor}18;color:${catColor};border:1px solid ${catColor}44;padding:1px 8px;border-radius:10px;font-size:.65rem;font-weight:600;">${esc(t.category || 'General')}</span>
          </div>
          <div style="font-size:.8rem;color:var(--text-muted);margin-top:4px;line-height:1.4;">${esc(t.description || '')}</div>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;">${dbChips}</div>
      <div style="font-size:.75rem;color:var(--text-muted);">
        ${t.databases.length} database${t.databases.length !== 1 ? 's' : ''}
        &bull; ${t.relationships.length} relationship${t.relationships.length !== 1 ? 's' : ''}
        &bull; by ${esc(t.createdBy)}
      </div>
      <div class="db-card-actions" style="margin-top:auto;" onclick="event.stopPropagation()">
        <button class="btn btn-sm btn-primary" onclick="openInstantiateModal(${JSON.stringify(t)})">${IC.deploy} Instantiate</button>
        ${adminBtns}
      </div>
    </div>`;
}

// ── Instantiate ───────────────────────────────────────────────────────────────
function openInstantiateModal(tpl) {
  const dbList = tpl.databases.map(d =>
    `<li style="font-size:.82rem;color:var(--text-muted);padding:2px 0;">
       <b style="color:var(--text);" id="preview-${d.name}">${esc(d.name)}</b>
       — ${d.fields.length} field${d.fields.length !== 1 ? 's' : ''}
     </li>`
  ).join('');

  const body = `
    <p style="font-size:.85rem;color:var(--text-muted);margin-bottom:16px;">
      Creates a private copy of <b>${esc(tpl.name)}</b> inside your tenant space.
    </p>
    <div style="margin-bottom:16px;">
      <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:6px;">
        Prefix <span style="color:var(--text-muted);font-weight:400;">(optional — useful if instantiating multiple times)</span>
      </label>
      <input id="tpl-prefix" type="text" placeholder='e.g. "mystore" → mystore_orders, mystore_products'
        style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px 11px;border-radius:8px;font-size:.875rem;outline:none;"
        oninput="updateInstantiatePreview(${JSON.stringify(tpl.databases.map(d => d.name))})">
    </div>
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 16px;">
      <div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:8px;">Will create</div>
      <ul style="list-style:none;padding:0;margin:0;">${dbList}</ul>
      ${tpl.relationships.length ? `<div style="font-size:.75rem;color:var(--text-muted);margin-top:8px;">+ ${tpl.relationships.length} relationship${tpl.relationships.length !== 1 ? 's' : ''} auto-wired</div>` : ''}
    </div>`;

  openModal(`⚡ Instantiate "${tpl.name}"`, body, async () => {
    const prefix = document.getElementById('tpl-prefix').value.trim();
    try {
      const result = await api('POST', `/db-templates/${tpl.id}/instantiate`, { prefix });
      closeModal();
      toast(`✅ Created ${result.created.length} database${result.created.length !== 1 ? 's' : ''}!`, 'success');
      loadDatabases();
      navigate('databases');
    } catch (err) {
      toast(err.message, 'error');
    }
  }, '⚡ Create');
}

function updateInstantiatePreview(names) {
  const prefix = document.getElementById('tpl-prefix')?.value.trim() || '';
  for (const n of names) {
    const el = document.getElementById(`preview-${n}`);
    if (el) el.textContent = prefix ? `${prefix}_${n}` : n;
  }
}

// ── Admin: Create / Edit template ─────────────────────────────────────────────
function openCreateTplModal(existing) {
  const edit = !!existing;
  // Build databases section state
  let tplDbs   = existing ? JSON.parse(JSON.stringify(existing.databases))   : [];
  let tplRels  = existing ? JSON.parse(JSON.stringify(existing.relationships)): [];

  function rebuildForm() {
    const dbsHtml = tplDbs.map((d, di) => `
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <input class="tpl-db-name" data-di="${di}" value="${esc(d.name)}" placeholder="database name"
            style="flex:1;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:5px 9px;border-radius:6px;font-size:.82rem;outline:none;"
            oninput="tplUpdateDbName(${di},this.value)">
          <button onclick="tplRemoveDb(${di})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:.9rem;padding:2px 6px;">&#10005;</button>
        </div>
        ${d.fields.map((f, fi) => `
          <div style="display:flex;gap:6px;margin-bottom:5px;align-items:center;">
            <input value="${esc(f.name)}" placeholder="field name"
              style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:5px;font-size:.78rem;outline:none;"
              oninput="tplUpdateField(${di},${fi},'name',this.value)">
            <select style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px 7px;border-radius:5px;font-size:.78rem;outline:none;"
                    onchange="tplUpdateField(${di},${fi},'type',this.value)">
              ${['string','number','boolean','date'].map(t =>
                `<option value="${t}"${f.type===t?' selected':''}>${t}</option>`).join('')}
            </select>
            <label style="font-size:.72rem;color:var(--text-muted);display:flex;align-items:center;gap:3px;cursor:pointer;">
              <input type="checkbox" ${f.required?'checked':''} onchange="tplUpdateField(${di},${fi},'required',this.checked)"> Req
            </label>
            <button onclick="tplRemoveField(${di},${fi})" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:.8rem;">&#10005;</button>
          </div>`).join('')}
        <button onclick="tplAddField(${di})"
          style="background:none;border:1px dashed var(--border);color:var(--text-muted);padding:3px 10px;border-radius:5px;font-size:.75rem;cursor:pointer;width:100%;margin-top:4px;">
          + field</button>
      </div>`).join('');

    const dbNames = tplDbs.map(d => d.name);
    const relHtml = tplRels.map((r, ri) => `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">
        <select style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:6px;font-size:.78rem;outline:none;"
                onchange="tplUpdateRel(${ri},'fromDb',this.value)">
          ${dbNames.map(n=>`<option value="${n}"${r.fromDb===n?' selected':''}>${esc(n)}</option>`).join('')}
        </select>
        <input value="${esc(r.fromField)}" placeholder="field"
          style="width:90px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:6px;font-size:.78rem;outline:none;"
          oninput="tplUpdateRel(${ri},'fromField',this.value)">
        <span style="color:var(--text-muted);font-size:.8rem;">→</span>
        <select style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:6px;font-size:.78rem;outline:none;"
                onchange="tplUpdateRel(${ri},'toDb',this.value)">
          ${dbNames.map(n=>`<option value="${n}"${r.toDb===n?' selected':''}>${esc(n)}</option>`).join('')}
        </select>
        <input value="${esc(r.toField)}" placeholder="field"
          style="width:90px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:6px;font-size:.78rem;outline:none;"
          oninput="tplUpdateRel(${ri},'toField',this.value)">
        <select style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:6px;font-size:.78rem;outline:none;"
                onchange="tplUpdateRel(${ri},'type',this.value)">
          <option value="one-to-many"${r.type==='one-to-many'?' selected':''}>1:N</option>
          <option value="one-to-one"${r.type==='one-to-one'?' selected':''}>1:1</option>
        </select>
        <button onclick="tplRemoveRel(${ri})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:.85rem;">&#10005;</button>
      </div>`).join('');

    document.getElementById('tpl-dbs-wrap').innerHTML  = dbsHtml;
    document.getElementById('tpl-rels-wrap').innerHTML = relHtml ||
      '<p style="font-size:.78rem;color:var(--text-muted);padding:4px 0;">No relationships defined.</p>';
  }

  // Expose mutation helpers to onclick handlers
  window.tplUpdateDbName  = (di, v)       => { tplDbs[di].name = v; rebuildForm(); };
  window.tplRemoveDb      = (di)          => { tplDbs.splice(di, 1); rebuildForm(); };
  window.tplAddField      = (di)          => { tplDbs[di].fields.push({name:'',type:'string',required:false}); rebuildForm(); };
  window.tplUpdateField   = (di, fi, k, v)=> { tplDbs[di].fields[fi][k] = v; };
  window.tplRemoveField   = (di, fi)      => { tplDbs[di].fields.splice(fi,1); rebuildForm(); };
  window.tplUpdateRel     = (ri, k, v)    => { tplRels[ri][k] = v; };
  window.tplRemoveRel     = (ri)          => { tplRels.splice(ri, 1); rebuildForm(); };
  window.tplAddDb         = ()            => {
    tplDbs.push({ name: 'new_db', fields: [{ name: 'id', type: 'string', required: true }] });
    rebuildForm();
  };
  window.tplAddRel = () => {
    if (tplDbs.length < 2) return toast('Add at least 2 databases first', 'error');
    tplRels.push({ fromDb: tplDbs[0].name, fromField: 'id', toDb: tplDbs[1].name, toField: 'id', type: 'one-to-many' });
    rebuildForm();
  };

  const body = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
      <div>
        <label style="font-size:.78rem;color:var(--text-muted);display:block;margin-bottom:5px;">Template Name</label>
        <input id="tpl-name" value="${esc(existing?.name||'')}" placeholder="e.g. E-Commerce Platform"
          style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:7px;font-size:.875rem;outline:none;">
      </div>
      <div>
        <label style="font-size:.78rem;color:var(--text-muted);display:block;margin-bottom:5px;">Category</label>
        <input id="tpl-cat" value="${esc(existing?.category||'')}" placeholder="e.g. E-Commerce, HR, CRM"
          style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:7px;font-size:.875rem;outline:none;">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 3fr;gap:10px;margin-bottom:14px;">
      <div>
        <label style="font-size:.78rem;color:var(--text-muted);display:block;margin-bottom:5px;">Icon (emoji)</label>
        <input id="tpl-icon" value="${esc(existing?.icon||'🗄️')}" maxlength="4"
          style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:7px;font-size:1.3rem;text-align:center;outline:none;">
      </div>
      <div>
        <label style="font-size:.78rem;color:var(--text-muted);display:block;margin-bottom:5px;">Description</label>
        <input id="tpl-desc" value="${esc(existing?.description||'')}" placeholder="Short description of what this template is for"
          style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:7px;font-size:.875rem;outline:none;">
      </div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);font-weight:600;">Databases</div>
      <button onclick="tplAddDb()" style="background:none;border:1px solid var(--border);color:var(--text-muted);padding:3px 10px;border-radius:6px;font-size:.75rem;cursor:pointer;">+ Add Database</button>
    </div>
    <div id="tpl-dbs-wrap" style="max-height:260px;overflow-y:auto;margin-bottom:14px;"></div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);font-weight:600;">Relationships</div>
      <button onclick="tplAddRel()" style="background:none;border:1px solid var(--border);color:var(--text-muted);padding:3px 10px;border-radius:6px;font-size:.75rem;cursor:pointer;">+ Add Relationship</button>
    </div>
    <div id="tpl-rels-wrap"></div>`;

  openModal(edit ? `Edit "${existing.name}"` : 'Create System Template', body, async () => {
    const name = document.getElementById('tpl-name').value.trim();
    if (!name) return toast('Template name is required', 'error');
    if (!tplDbs.length) return toast('Add at least one database', 'error');
    if (tplDbs.some(d => !d.name.trim())) return toast('All databases need a name', 'error');
    if (tplDbs.some(d => !d.fields.length)) return toast('Each database needs at least one field', 'error');
    if (tplDbs.some(d => d.fields.some(f => !f.name.trim()))) return toast('All fields need a name', 'error');

    const payload = {
      name,
      category:      document.getElementById('tpl-cat').value.trim()  || 'General',
      icon:          document.getElementById('tpl-icon').value.trim()  || '🗄️',
      description:   document.getElementById('tpl-desc').value.trim(),
      databases:     tplDbs,
      relationships: tplRels,
    };
    try {
      if (edit) {
        await api('PUT', `/db-templates/${existing.id}`, payload);
        toast('Template updated!', 'success');
      } else {
        await api('POST', '/db-templates', payload);
        toast('Template created!', 'success');
      }
      closeModal();
      loadDbTemplates();
    } catch (err) { toast(err.message, 'error'); }
  }, edit ? 'Save Changes' : 'Create Template');

  // Must call rebuildForm AFTER openModal so the containers exist in DOM
  setTimeout(rebuildForm, 10);
  document.getElementById('modal-box').classList.add('modal-wide');
}

function openEditTplModal(id) {
  api('GET', '/db-templates').then(tpls => {
    const t = tpls.find(x => x.id === id);
    if (t) openCreateTplModal(t);
    else toast('Template not found', 'error');
  });
}

async function deleteTpl(id, name) {
  if (!confirm(`Delete template "${name}"? This won't affect already-instantiated databases.`)) return;
  try {
    await api('DELETE', `/db-templates/${id}`);
    toast('Template deleted', 'success');
    loadDbTemplates();
  } catch (err) { toast(err.message, 'error'); }
}

document.getElementById('btn-create-tpl').onclick = () => openCreateTplModal(null);

// ── Scope toggle CSS ──────────────────────────────────────────────────────────
(function() {
  const s = document.createElement('style');
  s.textContent = `
    .scope-btn { background:none;border:none;color:var(--text-muted);padding:5px 13px;font-size:.78rem;cursor:pointer;transition:all .15s; }
    .scope-btn:hover { color:var(--text); }
    .scope-btn-active { background:var(--accent);color:#fff !important;border-radius:6px; }
  `;
  document.head.appendChild(s);
}());

// ─── App Logs view ────────────────────────────────────────────────────────────
let _logLevel = '';

async function loadAppLogs() {
  const container = document.getElementById('log-entries');
  container.innerHTML = '<p style="color:var(--text-muted);padding:20px 0">Loading…</p>';
  try {
    const params  = _logLevel ? `?level=${_logLevel}&limit=300` : '?limit=300';
    const entries = await api('GET', `/logs${params}`);
    if (!entries.length) {
      container.innerHTML = '<p class="empty-state">No log entries found.</p>';
      return;
    }
    container.innerHTML = entries.map(e => {
      const lvl     = e.level || 'INFO';
      const meta    = e.meta ? `<pre class="log-entry-meta">${esc(JSON.stringify(e.meta, null, 2))}</pre>` : '';
      const tsShort = e.ts ? new Date(e.ts).toLocaleString() : '—';
      return `<div class="log-entry log-entry-${lvl.toLowerCase()}">
        <span class="log-badge log-badge-${lvl.toLowerCase()}">${esc(lvl)}</span>
        <span class="log-entry-ts">${tsShort}</span>
        <span class="log-entry-msg">${esc(e.msg || '')}</span>
        ${meta}
      </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = `<p class="empty-state" style="color:var(--danger)">${esc(err.message)}</p>`;
  }
}

// Level pill filter
document.getElementById('log-level-pills').addEventListener('click', e => {
  const btn = e.target.closest('.log-level-pill');
  if (!btn) return;
  document.querySelectorAll('.log-level-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _logLevel = btn.dataset.level;
  loadAppLogs();
});

document.getElementById('btn-refresh-logs').onclick = loadAppLogs;

document.getElementById('btn-clear-logs').onclick = () => {
  openModal('Clear Logs', '<p>Delete all current log entries? Rotated files are kept.</p>',
    async () => {
      await api('DELETE', '/logs');
      toast('Logs cleared', 'success');
      loadAppLogs();
    }, 'Clear');
};
