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
    if (btn.dataset.view === 'databases') loadDatabases();
    if (btn.dataset.view === 'users')     loadUsers();
    if (btn.dataset.view === 'activity')  loadActivity();
    if (btn.dataset.view === 'apikeys')   loadApiKeys();
    if (btn.dataset.view === 'query')     loadQuerySchema();
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
  document.getElementById('nav-users').style.display    = isAdmin ? '' : 'none';
  document.getElementById('nav-activity').style.display = isAdmin ? '' : 'none';

  // Admin + member (not guest)
  document.getElementById('btn-create-db').style.display  = (isAdmin || isMember) ? '' : 'none';
  document.getElementById('nav-apikeys').style.display     = (isAdmin || isMember) ? '' : 'none';

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
    window.location.href = '/login';
  }
})();

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
