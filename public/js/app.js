const API = '';
let token = localStorage.getItem('token');
let currentUser = null;
let currentCase = null;

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data;
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  const name = document.getElementById('name').value.trim();
  let unixgram = document.getElementById('unixgram').value.trim();
  if (!unixgram.startsWith('@')) unixgram = '@' + unixgram;

  try {
    const data = await api('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ email, name, unixgramUsername: unixgram, googleId: 'demo-' + email })
    });
    token = data.token;
    localStorage.setItem('token', token);
    currentUser = data.user;
    showMain();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('btn-logout').addEventListener('click', () => {
  token = null;
  localStorage.removeItem('token');
  currentUser = null;
  hide(document.getElementById('main-screen'));
  show(document.getElementById('login-screen'));
});

async function showMain() {
  hide(document.getElementById('login-screen'));
  show(document.getElementById('main-screen'));
  await refreshUser();
  await loadCases();
  await loadHistory();
}

async function refreshUser() {
  try {
    currentUser = await api('/api/me');
    document.getElementById('user-name').textContent = currentUser.unixgramUsername || currentUser.name;
    document.getElementById('balance').textContent = currentUser.balance;
  } catch {
    token = null;
    localStorage.removeItem('token');
    location.reload();
  }
}

async function loadCases() {
  const cases = await api('/api/cases');
  const grid = document.getElementById('cases-list');
  grid.innerHTML = cases.map(c => `
    <div class="case-card" data-id="${c.id}">
      <h3>${c.name}</h3>
      <div class="price">${c.price} ⭐</div>
      <p>${c.description || ''}</p>
    </div>
  `).join('');

  grid.querySelectorAll('.case-card').forEach(card => {
    card.addEventListener('click', () => openCaseModal(card.dataset.id));
  });
}

async function openCaseModal(id) {
  currentCase = await api(`/api/cases/${id}`);
  document.getElementById('case-title').textContent = currentCase.name;
  document.getElementById('case-desc').textContent = currentCase.description || '';
  document.getElementById('case-price').textContent = currentCase.price + ' ⭐';
  
  const preview = document.getElementById('items-preview');
  preview.innerHTML = currentCase.items.map(it => `
    <div class="item-chip" style="border-color:\( {it.color}; color: \){it.color}">
      \( {it.name} ( \){it.chance}%) → ${it.value}⭐
    </div>
  `).join('');

  hide(document.getElementById('open-result'));
  document.getElementById('btn-open').disabled = false;
  show(document.getElementById('case-modal'));
}

document.getElementById('close-case').addEventListener('click', () => {
  hide(document.getElementById('case-modal'));
});

document.getElementById('btn-open').addEventListener('click', async () => {
  if (!currentCase) return;
  const btn = document.getElementById('btn-open');
  btn.disabled = true;
  btn.textContent = 'Открываем...';

  try {
    const result = await api(`/api/cases/${currentCase.id}/open`, { method: 'POST' });
    const resEl = document.getElementById('open-result');
    resEl.innerHTML = `
      <div style="font-size:2rem">🎉</div>
      <div class="won-name" style="color:\( {result.item.color}"> \){result.item.name}</div>
      <div>+${result.item.value} ⭐</div>
      <div style="margin-top:8px;color:var(--muted)">Баланс: ${result.newBalance} ⭐</div>
    `;
    show(resEl);
    document.getElementById('balance').textContent = result.newBalance;
    await loadHistory();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Открыть кейс';
  }
});

document.getElementById('btn-topup').addEventListener('click', () => {
  document.getElementById('topup-amount').value = '';
  document.getElementById('topup-comment').value = '';
  hide(document.getElementById('topup-msg'));
  show(document.getElementById('topup-modal'));
});

document.getElementById('close-topup').addEventListener('click', () => {
  hide(document.getElementById('topup-modal'));
});

document.getElementById('btn-submit-topup').addEventListener('click', async () => {
  const amount = Number(document.getElementById('topup-amount').value);
  const comment = document.getElementById('topup-comment').value;
  const msg = document.getElementById('topup-msg');
  try {
    const res = await api('/api/topup', {
      method: 'POST',
      body: JSON.stringify({ amount, comment })
    });
    msg.className = 'msg success';
    msg.textContent = res.message;
    show(msg);
  } catch (err) {
    msg.className = 'msg error';
    msg.textContent = err.message;
    show(msg);
  }
});

async function loadHistory() {
  try {
    const list = await api('/api/history');
    const el = document.getElementById('history-list');
    if (!list.length) {
      el.innerHTML = '<p style="color:var(--muted)">Пока пусто</p>';
      return;
    }
    el.innerHTML = list.map(t => {
      if (t.type === 'case_open') {
        return `<div class="history-item">
          <span>Открыл «${t.caseName}» → ${t.wonItem}</span>
          <span class="${t.wonValue - t.price >= 0 ? 'positive' : 'negative'}">
            \( {t.wonValue - t.price >= 0 ? '+' : ''} \){t.wonValue - t.price} ⭐
          </span>
        </div>`;
      }
      if (t.type === 'topup_request') {
        return `<div class="history-item">
          <span>Заявка на +\( {t.amount} ⭐ <span class="status- \){t.status}">(${t.status})</span></span>
          <span>${new Date(t.createdAt).toLocaleString('ru')}</span>
        </div>`;
      }
      return '';
    }).join('');
  } catch {}
}

if (token) {
  showMain().catch(() => {
    token = null;
    localStorage.removeItem('token');
  });
} else {
  show(document.getElementById('login-screen'));
}
