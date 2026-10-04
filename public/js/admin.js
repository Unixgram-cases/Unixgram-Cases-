const API = '';
let adminToken = localStorage.getItem('adminToken');
let editingCaseId = null;

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;
  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data;
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

document.getElementById('btn-admin-login').addEventListener('click', async () => {
  const password = document.getElementById('admin-pass').value;
  const err = document.getElementById('admin-login-err');
  try {
    const data = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password })
    });
    adminToken = data.token;
    localStorage.setItem('adminToken', adminToken);
    hide(document.getElementById('admin-login'));
    show(document.getElementById('admin-app'));
    loadStats();
  } catch (e) {
    err.textContent = e.message;
    show(err);
  }
});

document.getElementById('btn-admin-logout').addEventListener('click', (e) => {
  e.preventDefault();
  adminToken = null;
  localStorage.removeItem('adminToken');
  location.reload();
});

document.querySelectorAll('.admin-sidebar a[data-tab]').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.admin-sidebar a').forEach(x => x.classList.remove('active'));
    a.classList.add('active');
    document.querySelectorAll('.tab').forEach(t => hide(t));
    show(document.getElementById('tab-' + a.dataset.tab));
    if (a.dataset.tab === 'stats') loadStats();
    if (a.dataset.tab === 'topups') loadTopups();
    if (a.dataset.tab === 'cases') loadCasesAdmin();
    if (a.dataset.tab === 'users') loadUsers();
    if (a.dataset.tab === 'admins') loadAdmins();
  });
});

async function loadStats() {
  const s = await api('/api/admin/stats');
  document.getElementById('stats-cards').innerHTML = `
    <div style="background:var(--card);padding:20px;border-radius:12px;border:1px solid var(--border)">
      <div style="color:var(--muted);font-size:0.85rem">Пользователи</div>
      <div style="font-size:1.8rem;font-weight:700">${s.usersCount}</div>
    </div>
    <div style="background:var(--card);padding:20px;border-radius:12px;border:1px solid var(--border)">
      <div style="color:var(--muted);font-size:0.85rem">Общий баланс</div>
      <div style="font-size:1.8rem;font-weight:700">${s.totalBalance} ⭐</div>
    </div>
    <div style="background:var(--card);padding:20px;border-radius:12px;border:1px solid var(--border)">
      <div style="color:var(--muted);font-size:0.85rem">Кейсов</div>
      <div style="font-size:1.8rem;font-weight:700">${s.casesCount}</div>
    </div>
    <div style="background:var(--card);padding:20px;border-radius:12px;border:1px solid var(--border)">
      <div style="color:var(--muted);font-size:0.85rem">Ожидают пополнения</div>
      <div style="font-size:1.8rem;font-weight:700">${s.pendingTopups}</div>
    </div>
  `;
  document.getElementById('recent-tx').innerHTML = s.recentTx.map(t => 
    `<div class="history-item"><span>${t.type} ${t.unixgramUsername || ''} ${t.caseName || t.amount || ''}</span>
     <span>${new Date(t.createdAt).toLocaleString('ru')}</span></div>`
  ).join('') || '<p style="color:var(--muted)">Пусто</p>';
}

async function loadTopups() {
  const list = await api('/api/admin/topups');
  document.getElementById('topups-body').innerHTML = list.map(t => `
    <tr>
      <td>${t.unixgramUsername}</td>
      <td>${t.amount} ⭐</td>
      <td class="status-\( {t.status}"> \){t.status}</td>
      <td>${new Date(t.createdAt).toLocaleString('ru')}</td>
      <td>
        ${t.status === 'pending' ? `
          <button class="btn btn-sm btn-primary" onclick="processTopup('${t.id}','approve')">✓</button>
          <button class="btn btn-sm btn-outline" onclick="processTopup('${t.id}','reject')">✗</button>
        ` : '—'}
      </td>
    </tr>
  `).join('');
}

async function processTopup(id, action) {
  await api(`/api/admin/topup/${id}`, { method: 'POST', body: JSON.stringify({ action }) });
  loadTopups();
  loadStats();
}

async function loadCasesAdmin() {
  const cases = await api('/api/admin/cases');
  document.getElementById('cases-admin-list').innerHTML = cases.map(c => `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <strong>${c.name}</strong> — ${c.price} ⭐
          <div style="font-size:0.85rem;color:var(--muted);margin-top:4px">
            \( {c.items.map(i => ` \){i.name} (${i.chance}%)`).join(', ')}
          </div>
        </div>
        <div>
          <button class="btn btn-sm btn-outline" onclick="editCase('${c.id}')">Изменить</button>
          <button class="btn btn-sm" style="background:#ef4444;color:white" onclick="deleteCase('${c.id}')">Удалить</button>
        </div>
      </div>
    </div>
  `).join('');
}

function addItemRow(item = {}) {
  const div = document.createElement('div');
  div.className = 'item-row';
  div.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:center';
  div.innerHTML = `
    <input placeholder="Название" value="${item.name || ''}" class="cf-item-name">
    <input type="number" placeholder="Ценность" value="${item.value || ''}" class="cf-item-value">
    <input type="number" placeholder="Шанс %" value="${item.chance || ''}" class="cf-item-chance">
    <select class="cf-item-rarity">
      <option value="common" ${item.rarity==='common'?'selected':''}>common</option>
      <option value="uncommon" ${item.rarity==='uncommon'?'selected':''}>uncommon</option>
      <option value="rare" ${item.rarity==='rare'?'selected':''}>rare</option>
      <option value="epic" ${item.rarity==='epic'?'selected':''}>epic</option>
      <option value="legendary" ${item.rarity==='legendary'?'selected':''}>legendary</option>
    </select>
    <button class="btn btn-sm" style="background:#ef4444;color:white" onclick="this.parentElement.remove()">×</button>
  `;
  document.getElementById('cf-items').appendChild(div);
}

document.getElementById('btn-new-case').addEventListener('click', () => {
  editingCaseId = null;
  document.getElementById('case-form-title').textContent = 'Новый кейс';
  document.getElementById('cf-name').value = '';
  document.getElementById('cf-price').value = '';
  document.getElementById('cf-desc').value = '';
  document.getElementById('cf-items').innerHTML = '';
  addItemRow();
  addItemRow();
  show(document.getElementById('case-form'));
});

document.getElementById('btn-add-item').addEventListener('click', () => addItemRow());

document.getElementById('btn-cancel-case').addEventListener('click', () => {
  hide(document.getElementById('case-form'));
});

document.getElementById('btn-save-case').addEventListener('click', async () => {
  const name = document.getElementById('cf-name').value.trim();
  const price = document.getElementById('cf-price').value;
  const description = document.getElementById('cf-desc').value;
  const items = [...document.querySelectorAll('.item-row')].map(row => ({
    name: row.querySelector('.cf-item-name').value,
    value: row.querySelector('.cf-item-value').value,
    chance: row.querySelector('.cf-item-chance').value,
    rarity: row.querySelector('.cf-item-rarity').value,
    color: '#a78bfa'
  })).filter(i => i.name && i.value && i.chance);

  if (!name || !price || !items.length) return alert('Заполните всё');

  try {
    if (editingCaseId) {
      await api(`/api/admin/cases/${editingCaseId}`, {
        method: 'PUT',
        body: JSON.stringify({ name, price, description, items })
      });
    } else {
      await api('/api/admin/cases', {
        method: 'POST',
        body: JSON.stringify({ name, price, description, items })
      });
    }
    hide(document.getElementById('case-form'));
    loadCasesAdmin();
  } catch (e) {
    alert(e.message);
  }
});

async function editCase(id) {
  const cases = await api('/api/admin/cases');
  const c = cases.find(x => x.id === id);
  if (!c) return;
  editingCaseId = id;
  document.getElementById('case-form-title').textContent = 'Редактировать: ' + c.name;
  document.getElementById('cf-name').value = c.name;
  document.getElementById('cf-price').value = c.price;
  document.getElementById('cf-desc').value = c.description || '';
  document.getElementById('cf-items').innerHTML = '';
  c.items.forEach(it => addItemRow(it));
  show(document.getElementById('case-form'));
}

async function deleteCase(id) {
  if (!confirm('Удалить кейс?')) return;
  await api(`/api/admin/cases/${id}`, { method: 'DELETE' });
  loadCasesAdmin();
}

async function loadUsers() {
  const users = await api('/api/admin/users');
  document.getElementById('users-body').innerHTML = users.map(u => `
    <tr>
      <td>${u.name}</td>
      <td>${u.unixgramUsername}</td>
      <td>${u.email}</td>
      <td>${u.balance} ⭐</td>
      <td>${new Date(u.createdAt).toLocaleDateString('ru')}</td>
    </tr>
  `).join('');
}

async function loadAdmins() {
  const data = await api('/api/admin/admins');
  document.getElementById('owner-name').textContent = data.owner;
  document.getElementById('admins-list').innerHTML = data.admins.map(a => `
    <li style="padding:8px 0;display:flex;justify-content:space-between;max-width:300px">
      ${a} \( {a === data.owner ? '(владелец)' : `<button class="btn btn-sm" style="background:#ef4444;color:white" onclick="removeAdmin(' \){a}')">Удалить</button>`}
    </li>
  `).join('');
}

document.getElementById('btn-add-admin').addEventListener('click', async () => {
  let username = document.getElementById('new-admin').value.trim();
  if (!username.startsWith('@')) username = '@' + username;
  try {
    await api('/api/admin/admins', { method: 'POST', body: JSON.stringify({ username }) });
    document.getElementById('new-admin').value = '';
    loadAdmins();
  } catch (e) { alert(e.message); }
});

async function removeAdmin(username) {
  if (!confirm('Удалить ' + username + '?')) return;
  await api(`/api/admin/admins/${encodeURIComponent(username)}`, { method: 'DELETE' });
  loadAdmins();
}

document.getElementById('btn-change-pass').addEventListener('click', async () => {
  const newPassword = document.getElementById('new-pass').value;
  try {
    await api('/api/admin/password', { method: 'POST', body: JSON.stringify({ newPassword }) });
    alert('Пароль изменён');
    document.getElementById('new-pass').value = '';
  } catch (e) { alert(e.message); }
});

if (adminToken) {
  hide(document.getElementById('admin-login'));
  show(document.getElementById('admin-app'));
  loadStats();
                                                             }
