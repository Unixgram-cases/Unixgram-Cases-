const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'unixgram-cases-secret-key-change-me';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // сменить!

// Paths
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CASES_FILE = path.join(DATA_DIR, 'cases.json');
const ADMINS_FILE = path.join(DATA_DIR, 'admins.json');
const TX_FILE = path.join(DATA_DIR, 'transactions.json');

// Helpers
function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return Array.isArray(arguments[1]) ? [] : {};
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Init admins if needed
function initAdmins() {
  let admins = readJSON(ADMINS_FILE);
  if (!admins.passwordHash || admins.passwordHash.includes('zqKzq')) {
    const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    admins = {
      owner: '@gold',
      passwordHash: hash,
      admins: ['@gold']
    };
    writeJSON(ADMINS_FILE, admins);
    console.log('Админ пароль инициализирован (по умолчанию: admin123). Смените в .env!');
  }
  return admins;
}

initAdmins();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware for users
function authUser(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Нет токена' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Неверный токен' });
  }
}

// Auth middleware for admins
function authAdmin(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Нет токена' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.isAdmin) return res.status(403).json({ error: 'Не админ' });
    req.admin = decoded;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Неверный токен' });
  }
}

// ============ USER ROUTES ============

// Регистрация / вход через Google (мок) + Unixgram username
app.post('/api/auth/google', (req, res) => {
  const { googleId, email, name, unixgramUsername } = req.body;
  if (!unixgramUsername || !unixgramUsername.startsWith('@')) {
    return res.status(400).json({ error: 'Укажите юзернейм Unixgram в формате @username' });
  }
  if (!email) return res.status(400).json({ error: 'Email обязателен' });

  let users = readJSON(USERS_FILE);
  let user = users.find(u => u.email === email || u.unixgramUsername === unixgramUsername);

  if (!user) {
    user = {
      id: uuidv4(),
      googleId: googleId || null,
      email,
      name: name || email.split('@')[0],
      unixgramUsername,
      balance: 0,
      inventory: [],
      createdAt: new Date().toISOString()
    };
    users.push(user);
    writeJSON(USERS_FILE, users);
  } else {
    // Update username if changed
    user.unixgramUsername = unixgramUsername;
    user.name = name || user.name;
    writeJSON(USERS_FILE, users);
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, unixgramUsername: user.unixgramUsername },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      unixgramUsername: user.unixgramUsername,
      balance: user.balance
    }
  });
});

// Профиль
app.get('/api/me', authUser, (req, res) => {
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    unixgramUsername: user.unixgramUsername,
    balance: user.balance,
    inventory: user.inventory || []
  });
});

// Список кейсов
app.get('/api/cases', (req, res) => {
  const cases = readJSON(CASES_FILE);
  res.json(cases.map(c => ({
    id: c.id,
    name: c.name,
    price: c.price,
    image: c.image,
    description: c.description,
    itemsCount: c.items.length
  })));
});

// Детали кейса
app.get('/api/cases/:id', (req, res) => {
  const cases = readJSON(CASES_FILE);
  const c = cases.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Кейс не найден' });
  res.json(c);
});

// Открыть кейс
app.post('/api/cases/:id/open', authUser, (req, res) => {
  const cases = readJSON(CASES_FILE);
  const caseData = cases.find(x => x.id === req.params.id);
  if (!caseData) return res.status(404).json({ error: 'Кейс не найден' });

  let users = readJSON(USERS_FILE);
  const userIdx = users.findIndex(u => u.id === req.user.id);
  if (userIdx === -1) return res.status(404).json({ error: 'Пользователь не найден' });

  const user = users[userIdx];
  if (user.balance < caseData.price) {
    return res.status(400).json({ error: 'Недостаточно звёзд' });
  }

  // Roll item by chance
  const totalChance = caseData.items.reduce((s, i) => s + i.chance, 0);
  let roll = Math.random() * totalChance;
  let wonItem = caseData.items[0];
  for (const item of caseData.items) {
    if (roll < item.chance) {
      wonItem = item;
      break;
    }
    roll -= item.chance;
  }

  // Deduct price, add value (or inventory)
  user.balance -= caseData.price;
  user.balance += wonItem.value; // сразу конвертируем в звёзды
  // Optionally keep in inventory:
  // user.inventory = user.inventory || [];
  // user.inventory.push({ ...wonItem, openedAt: new Date().toISOString() });

  users[userIdx] = user;
  writeJSON(USERS_FILE, users);

  // Log tx
  let txs = readJSON(TX_FILE);
  txs.push({
    id: uuidv4(),
    type: 'case_open',
    userId: user.id,
    unixgramUsername: user.unixgramUsername,
    caseId: caseData.id,
    caseName: caseData.name,
    price: caseData.price,
    wonItem: wonItem.name,
    wonValue: wonItem.value,
    balanceAfter: user.balance,
    createdAt: new Date().toISOString()
  });
  writeJSON(TX_FILE, txs);

  res.json({
    success: true,
    item: wonItem,
    newBalance: user.balance,
    message: `Вы выиграли: ${wonItem.name} (+${wonItem.value} ⭐)`
  });
});

// Заявка на пополнение
app.post('/api/topup', authUser, (req, res) => {
  const { amount, comment } = req.body;
  if (!amount || amount < 1) return res.status(400).json({ error: 'Укажите сумму' });

  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  let txs = readJSON(TX_FILE);
  const tx = {
    id: uuidv4(),
    type: 'topup_request',
    userId: user.id,
    unixgramUsername: user.unixgramUsername,
    amount: Number(amount),
    comment: comment || '',
    status: 'pending', // pending | approved | rejected
    createdAt: new Date().toISOString()
  };
  txs.push(tx);
  writeJSON(TX_FILE, txs);

  res.json({
    success: true,
    message: `Заявка создана. Отправьте ${amount} ⭐ на аккаунт владельца в Unixgram и укажите свой @${user.unixgramUsername.replace('@','')}. Админ подтвердит.`,
    txId: tx.id
  });
});

// История пользователя
app.get('/api/history', authUser, (req, res) => {
  const txs = readJSON(TX_FILE);
  const my = txs.filter(t => t.userId === req.user.id).slice(-50).reverse();
  res.json(my);
});

// ============ ADMIN ROUTES ============

// Логин админа
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const admins = readJSON(ADMINS_FILE);
  if (!bcrypt.compareSync(password, admins.passwordHash)) {
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  const token = jwt.sign(
    { isAdmin: true, username: admins.owner },
    JWT_SECRET,
    { expiresIn: '1d' }
  );
  res.json({ token, owner: admins.owner, admins: admins.admins });
});

// Статистика
app.get('/api/admin/stats', authAdmin, (req, res) => {
  const users = readJSON(USERS_FILE);
  const txs = readJSON(TX_FILE);
  const cases = readJSON(CASES_FILE);
  const pending = txs.filter(t => t.type === 'topup_request' && t.status === 'pending');
  res.json({
    usersCount: users.length,
    totalBalance: users.reduce((s, u) => s + (u.balance || 0), 0),
    casesCount: cases.length,
    pendingTopups: pending.length,
    recentTx: txs.slice(-20).reverse()
  });
});

// Список пользователей
app.get('/api/admin/users', authAdmin, (req, res) => {
  const users = readJSON(USERS_FILE);
  res.json(users.map(u => ({
    id: u.id,
    email: u.email,
    name: u.name,
    unixgramUsername: u.unixgramUsername,
    balance: u.balance,
    createdAt: u.createdAt
  })));
});

// Подтвердить / отклонить пополнение
app.post('/api/admin/topup/:id', authAdmin, (req, res) => {
  const { action } = req.body; // approve | reject
  let txs = readJSON(TX_FILE);
  const txIdx = txs.findIndex(t => t.id === req.params.id && t.type === 'topup_request');
  if (txIdx === -1) return res.status(404).json({ error: 'Заявка не найдена' });

  const tx = txs[txIdx];
  if (tx.status !== 'pending') return res.status(400).json({ error: 'Уже обработана' });

  if (action === 'approve') {
    let users = readJSON(USERS_FILE);
    const uIdx = users.findIndex(u => u.id === tx.userId);
    if (uIdx === -1) return res.status(404).json({ error: 'Юзер не найден' });
    users[uIdx].balance += tx.amount;
    writeJSON(USERS_FILE, users);
    tx.status = 'approved';
    tx.processedAt = new Date().toISOString();
    tx.balanceAfter = users[uIdx].balance;
  } else {
    tx.status = 'rejected';
    tx.processedAt = new Date().toISOString();
  }
  txs[txIdx] = tx;
  writeJSON(TX_FILE, txs);
  res.json({ success: true, tx });
});

// Управление кейсами
app.get('/api/admin/cases', authAdmin, (req, res) => {
  res.json(readJSON(CASES_FILE));
});

app.post('/api/admin/cases', authAdmin, (req, res) => {
  const { name, price, description, items } = req.body;
  if (!name || !price || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Некорректные данные' });
  }
  // Normalize chances to sum ~100
  const total = items.reduce((s, i) => s + Number(i.chance || 0), 0);
  if (total <= 0) return res.status(400).json({ error: 'Шансы должны быть > 0' });

  let cases = readJSON(CASES_FILE);
  const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9а-яё-]/gi, '') + '-' + Date.now().toString(36);
  const newCase = {
    id,
    name,
    price: Number(price),
    image: '/img/default.png',
    description: description || '',
    items: items.map((it, idx) => ({
      id: `item-${idx}`,
      name: it.name,
      value: Number(it.value),
      chance: Number(it.chance),
      rarity: it.rarity || 'common',
      color: it.color || '#9ca3af'
    }))
  };
  cases.push(newCase);
  writeJSON(CASES_FILE, cases);
  res.json(newCase);
});

app.put('/api/admin/cases/:id', authAdmin, (req, res) => {
  let cases = readJSON(CASES_FILE);
  const idx = cases.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Кейс не найден' });

  const { name, price, description, items } = req.body;
  if (name) cases[idx].name = name;
  if (price) cases[idx].price = Number(price);
  if (description !== undefined) cases[idx].description = description;
  if (items && Array.isArray(items)) {
    cases[idx].items = items.map((it, i) => ({
      id: it.id || `item-${i}`,
      name: it.name,
      value: Number(it.value),
      chance: Number(it.chance),
      rarity: it.rarity || 'common',
      color: it.color || '#9ca3af'
    }));
  }
  writeJSON(CASES_FILE, cases);
  res.json(cases[idx]);
});

app.delete('/api/admin/cases/:id', authAdmin, (req, res) => {
  let cases = readJSON(CASES_FILE);
  cases = cases.filter(c => c.id !== req.params.id);
  writeJSON(CASES_FILE, cases);
  res.json({ success: true });
});

// Управление админами
app.get('/api/admin/admins', authAdmin, (req, res) => {
  const admins = readJSON(ADMINS_FILE);
  res.json({ owner: admins.owner, admins: admins.admins });
});

app.post('/api/admin/admins', authAdmin, (req, res) => {
  const { username } = req.body;
  if (!username || !username.startsWith('@')) {
    return res.status(400).json({ error: 'Юзернейм в формате @name' });
  }
  let admins = readJSON(ADMINS_FILE);
  // Only owner can add
  if (req.admin.username !== admins.owner) {
    return res.status(403).json({ error: 'Только владелец может добавлять админов' });
  }
  if (!admins.admins.includes(username)) {
    admins.admins.push(username);
    writeJSON(ADMINS_FILE, admins);
  }
  res.json(admins);
});

app.delete('/api/admin/admins/:username', authAdmin, (req, res) => {
  let admins = readJSON(ADMINS_FILE);
  if (req.admin.username !== admins.owner) {
    return res.status(403).json({ error: 'Только владелец может удалять админов' });
  }
  const uname = decodeURIComponent(req.params.username);
  if (uname === admins.owner) return res.status(400).json({ error: 'Нельзя удалить владельца' });
  admins.admins = admins.admins.filter(a => a !== uname);
  writeJSON(ADMINS_FILE, admins);
  res.json(admins);
});

// Смена пароля админки
app.post('/api/admin/password', authAdmin, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  }
  let admins = readJSON(ADMINS_FILE);
  if (req.admin.username !== admins.owner) {
    return res.status(403).json({ error: 'Только владелец' });
  }
  admins.passwordHash = bcrypt.hashSync(newPassword, 10);
  writeJSON(ADMINS_FILE, admins);
  res.json({ success: true });
});

// Pending topups
app.get('/api/admin/topups', authAdmin, (req, res) => {
  const txs = readJSON(TX_FILE);
  res.json(txs.filter(t => t.type === 'topup_request').reverse());
});

// Fallback to SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Unixgram Cases запущен на http://localhost:${PORT}`);
  console.log(`Админ панель: http://localhost:${PORT}/admin.html`);
  console.log(`Пароль по умолчанию: ${ADMIN_PASSWORD}`);
});
