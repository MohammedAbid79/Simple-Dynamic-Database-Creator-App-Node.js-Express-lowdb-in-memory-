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
  const old = document.querySelector('.modal-footer');
  if (old) old.remove();
}

document.getElementById('modal-close-btn').onclick = closeModal;
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

/* ── Auth ──────────────────────────────────────────────────────────────────── */
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('l-username').value.trim();
  const password = document.getElementById('l-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.classList.add('hidden');
  try {
    currentUser = await api('POST', '/auth/login', { username, password });
    bootApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

document.getElementById('logout-btn').onclick = async () => {
  await api('POST', '/auth/logout');
  currentUser = null;
  showScreen('login-screen');
};

/* ── Navigation ────────────────────────────────────────────────────────────── */
document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    showView('view-' + btn.dataset.view);
    if (btn.dataset.view === 'databases') loadDatabases();
    if (btn.dataset.view === 'users')     loadUsers();
    if (btn.dataset.view === 'activity')  loadActivity();
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

  // User badge
  const badge = document.getElementById('user-badge');
  badge.innerHTML = `<strong>${currentUser.username}</strong>
    <span class="role-tag role-${currentUser.role}">${currentUser.role.toUpperCase()}</span>`;

  // Admin-only UI
  if (currentUser.role === 'admin') {
    document.getElementById('nav-users').style.display = '';
    document.getElementById('nav-activity').style.display = '';
    document.getElementById('btn-create-db').style.display = '';
  } else {
    document.getElementById('nav-users').style.display = 'none';
    document.getElementById('nav-activity').style.display = 'none';
    document.getElementById('btn-create-db').style.display = 'none';
  }

  showView('view-databases');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.nav-btn[data-view="databases"]').classList.add('active');

  await loadDatabases();
}

/* ── Initialise: check existing session ────────────────────────────────────── */
(async () => {
  try {
    currentUser = await api('GET', '/auth/me');
    bootApp();
  } catch (_) {
    showScreen('login-screen');
  }
})();

/* ════════════════════════════════════════════════════════════════════════════
   DATABASE VIEW
   ════════════════════════════════════════════════════════════════════════════ */
async function loadDatabases() {
  const dbs  = await api('GET', '/databases');
  const list = document.getElementById('db-list');

  if (dbs.length === 0) {
    list.innerHTML = `<div class="empty-state">
      ${currentUser.role === 'admin'
        ? 'No databases yet. Click <b>+ New Database</b> to create one.'
        : 'No databases available. Ask an admin to create one.'}
    </div>`;
    return;
  }

  list.innerHTML = dbs.map(d => `
    <div class="db-card" data-id="${d.id}">
      <div class="db-card-name">${esc(d.name)}</div>
      <div class="db-card-meta">Created by ${esc(d.createdBy)} &bull; ${fmtDate(d.createdAt)}</div>
      <div class="db-card-count"><span class="record-count-badge">${d.recordCount ?? 0} record${(d.recordCount ?? 0) !== 1 ? 's' : ''}</span></div>
      <div class="db-card-fields">
        ${d.fields.map(f => `<span class="field-chip">${esc(f.name)}<span class="badge badge-${f.type}" style="margin-left:4px">${f.type}</span></span>`).join('')}
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
    ? db.fields.map(f => fieldRow(f.name, f.type)).join('')
    : fieldRow();
  return `
    <label>Database Name</label>
    <input id="db-name-input" type="text" value="${nameVal}" placeholder="e.g. Products" />
    <label style="margin-top:18px">Fields</label>
    <div id="fields-list">${fieldsHtml}</div>
    <button type="button" class="btn btn-outline btn-sm" style="margin-top:8px" onclick="addFieldRow()">+ Add Field</button>`;
}

function fieldRow(name = '', type = 'string') {
  return `<div class="field-row">
    <input type="text" placeholder="field name" value="${esc(name)}" class="field-name" />
    <select class="field-type">
      ${['string','number','boolean','date'].map(t =>
        `<option value="${t}"${t===type?' selected':''}>${t}</option>`).join('')}
    </select>
    <button type="button" class="remove-field" onclick="this.closest('.field-row').remove()" title="Remove field">&times;</button>
  </div>`;
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
    if (name) result.push({ name, type });
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
    const canEdit = currentUser.role === 'admin' || r.createdBy === currentUser.username;
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
    const val = record ? (record.data[f.name] ?? '') : '';
    let input;
    if (f.type === 'boolean') {
      input = `<select id="rf-${esc(f.name)}">
        <option value="">— select —</option>
        <option value="true"${val===true||val==='true'?' selected':''}>true</option>
        <option value="false"${val===false||val==='false'?' selected':''}>false</option>
      </select>`;
    } else if (f.type === 'date') {
      input = `<input id="rf-${esc(f.name)}" type="date" value="${esc(val)}" />`;
    } else if (f.type === 'number') {
      input = `<input id="rf-${esc(f.name)}" type="number" value="${esc(String(val))}" step="any" />`;
    } else {
      input = `<input id="rf-${esc(f.name)}" type="text" value="${esc(String(val))}" />`;
    }
    return `<label>${esc(f.name)} <span class="badge badge-${f.type}">${f.type}</span></label>${input}`;
  }).join('');
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
  update_db:     { icon: '✏️',  label: 'Updated database',  color: 'var(--accent)' },
  delete_db:     { icon: '🗑️',  label: 'Deleted database',  color: 'var(--danger)' },
  create_record: { icon: '➕',  label: 'Added record',      color: 'var(--success)' },
  update_record: { icon: '🔄',  label: 'Updated record',    color: 'var(--accent)' },
  delete_record: { icon: '❌',  label: 'Deleted record',    color: 'var(--danger)' },
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
