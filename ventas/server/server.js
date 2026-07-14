const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../www'), {
  maxAge: '0',
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store');
  }
}));

const DB_PATH = path.join(__dirname, 'ventas.db');
const SQL_FILE = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
let db;

initSqlJs().then(SQL => {
  db = new SQL.Database(SQL_FILE);
  if (!SQL_FILE) {
    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT,
        stock INTEGER NOT NULL DEFAULT 0,
        costPrice REAL NOT NULL DEFAULT 0,
        salePrice REAL NOT NULL DEFAULT 0,
        barcode TEXT,
        sku TEXT,
        supplier TEXT,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        address TEXT,
        notes TEXT,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY,
        clientId TEXT,
        clientName TEXT NOT NULL,
        saleDate TEXT NOT NULL,
        subtotal REAL NOT NULL,
        taxAmount REAL NOT NULL DEFAULT 0,
        totalAmount REAL NOT NULL,
        paymentMethod TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sale_items (
        id TEXT PRIMARY KEY,
        saleId TEXT NOT NULL,
        productId TEXT,
        productName TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unitPrice REAL NOT NULL,
        subtotal REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        saleId TEXT,
        amount REAL NOT NULL,
        paymentDate TEXT NOT NULL,
        paymentMethod TEXT NOT NULL,
        notes TEXT
      );
      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        category TEXT NOT NULL
      );
    `);
    persistDb();
  }
});

function persistDb() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function generateId(prefix) {
  return prefix + '_' + Math.random().toString(36).substring(2, 9);
}

function ok(res, data) {
  res.json({ ok: true, data });
}

function fail(res, status, message) {
  res.status(status).json({ ok: false, error: message });
}

function runParams(sql, params) {
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();
  persistDb();
}

function getParams(sql, params) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.getAsObject();
  stmt.free();
  return row || null;
}

function allParams(sql, params) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/products', (req, res) => {
  const rows = allParams('SELECT * FROM products ORDER BY createdAt DESC', []);
  ok(res, rows);
});

app.get('/api/products/:id', (req, res) => {
  const row = getParams('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!row) return fail(res, 404, 'Producto no encontrado');
  ok(res, row);
});

app.post('/api/products', (req, res) => {
  const { name, description, category, stock, costPrice, salePrice, barcode, sku, supplier } = req.body;
  if (!name) return fail(res, 400, 'Nombre es requerido');
  const id = generateId('prod');
  const createdAt = new Date().toISOString();
  runParams('INSERT INTO products (id, name, description, category, stock, costPrice, salePrice, barcode, sku, supplier, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [id, name, description || '', category || '', stock || 0, costPrice || 0, salePrice || 0, barcode || '', sku || '', supplier || '', createdAt]);
  const row = getParams('SELECT * FROM products WHERE id = ?', [id]);
  ok(res, row);
});

app.put('/api/products/:id', (req, res) => {
  const { name, description, category, stock, costPrice, salePrice, barcode, sku, supplier } = req.body;
  const exists = getParams('SELECT id FROM products WHERE id = ?', [req.params.id]);
  if (!exists) return fail(res, 404, 'Producto no encontrado');
  runParams('UPDATE products SET name = ?, description = ?, category = ?, stock = ?, costPrice = ?, salePrice = ?, barcode = ?, sku = ?, supplier = ? WHERE id = ?',
    [name, description || '', category || '', stock || 0, costPrice || 0, salePrice || 0, barcode || '', sku || '', supplier || '', req.params.id]);
  ok(res, { id: req.params.id });
});

app.delete('/api/products/:id', (req, res) => {
  const exists = getParams('SELECT id FROM products WHERE id = ?', [req.params.id]);
  if (!exists) return fail(res, 404, 'Producto no encontrado');
  runParams('DELETE FROM products WHERE id = ?', [req.params.id]);
  ok(res, { id: req.params.id });
});

app.get('/api/clients', (req, res) => {
  const rows = allParams('SELECT * FROM clients ORDER BY createdAt DESC', []);
  ok(res, rows);
});

app.get('/api/clients/:id', (req, res) => {
  const row = getParams('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  if (!row) return fail(res, 404, 'Cliente no encontrado');
  ok(res, row);
});

app.post('/api/clients', (req, res) => {
  const { name, phone, email, address, notes } = req.body;
  if (!name) return fail(res, 400, 'Nombre es requerido');
  const id = generateId('cli');
  const createdAt = new Date().toISOString();
  runParams('INSERT INTO clients (id, name, phone, email, address, notes, createdAt) VALUES (?,?,?,?,?,?,?)',
    [id, name, phone || '', email || '', address || '', notes || '', createdAt]);
  const row = getParams('SELECT * FROM clients WHERE id = ?', [id]);
  ok(res, row);
});

app.put('/api/clients/:id', (req, res) => {
  const { name, phone, email, address, notes } = req.body;
  const exists = getParams('SELECT id FROM clients WHERE id = ?', [req.params.id]);
  if (!exists) return fail(res, 404, 'Cliente no encontrado');
  runParams('UPDATE clients SET name = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ?',
    [name, phone || '', email || '', address || '', notes || '', req.params.id]);
  ok(res, { id: req.params.id });
});

app.delete('/api/clients/:id', (req, res) => {
  const exists = getParams('SELECT id FROM clients WHERE id = ?', [req.params.id]);
  if (!exists) return fail(res, 404, 'Cliente no encontrado');
  runParams('DELETE FROM clients WHERE id = ?', [req.params.id]);
  ok(res, { id: req.params.id });
});

app.get('/api/sales', (req, res) => {
  const rows = allParams('SELECT * FROM sales ORDER BY saleDate DESC', []);
  ok(res, rows);
});

app.get('/api/sales/:id', (req, res) => {
  const sale = getParams('SELECT * FROM sales WHERE id = ?', [req.params.id]);
  if (!sale) return fail(res, 404, 'Venta no encontrada');
  const items = allParams('SELECT * FROM sale_items WHERE saleId = ?', [req.params.id]);
  ok(res, { ...sale, items });
});

app.post('/api/sales', (req, res) => {
  const { clientId, clientName, saleDate, items, subtotal, taxAmount, totalAmount, paymentMethod } = req.body;
  if (!items || !items.length) return fail(res, 400, 'Debe incluir al menos un producto');

  const id = generateId('sale');
  const createdAt = new Date().toISOString();

  db.run('BEGIN TRANSACTION');
  try {
    runParams('INSERT INTO sales (id, clientId, clientName, saleDate, subtotal, taxAmount, totalAmount, paymentMethod, status, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, clientId || null, clientName, saleDate, subtotal || 0, taxAmount || 0, totalAmount || 0, paymentMethod, 'completed', createdAt]);

    const insertItem = db.prepare('INSERT INTO sale_items (id, saleId, productId, productName, quantity, unitPrice, subtotal) VALUES (?,?,?,?,?,?,?)');
    const updateStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
    for (const item of items) {
      const itemId = generateId('item');
      runParams('INSERT INTO sale_items (id, saleId, productId, productName, quantity, unitPrice, subtotal) VALUES (?,?,?,?,?,?,?)',
        [itemId, id, item.productId || null, item.productName, item.quantity, item.unitPrice, item.subtotal]);
      if (item.productId) {
        updateStock.run(item.quantity, item.productId);
      }
    }
    db.run('COMMIT');
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  }

  const sale = getParams('SELECT * FROM sales WHERE id = ?', [id]);
  ok(res, sale);
});

app.delete('/api/sales/:id', (req, res) => {
  const exists = getParams('SELECT id FROM sales WHERE id = ?', [req.params.id]);
  if (!exists) return fail(res, 404, 'Venta no encontrada');

  const items = allParams('SELECT productId, quantity FROM sale_items WHERE saleId = ?', [req.params.id]);
  db.run('BEGIN TRANSACTION');
  try {
    for (const item of items) {
      if (item.productId) runParams('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.productId]);
    }
    runParams('DELETE FROM sale_items WHERE saleId = ?', [req.params.id]);
    runParams('DELETE FROM payments WHERE saleId = ?', [req.params.id]);
    runParams('DELETE FROM sales WHERE id = ?', [req.params.id]);
    db.run('COMMIT');
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  }
  ok(res, { id: req.params.id });
});

app.get('/api/payments', (req, res) => {
  const rows = allParams('SELECT p.*, s.clientName FROM payments p LEFT JOIN sales s ON p.saleId = s.id ORDER BY paymentDate DESC', []);
  ok(res, rows);
});

app.post('/api/payments', (req, res) => {
  const { saleId, amount, paymentDate, paymentMethod, notes } = req.body;
  if (!saleId || amount === undefined || !paymentDate) return fail(res, 400, 'Datos incompletos');
  const id = generateId('pay');
  runParams('INSERT INTO payments (id, saleId, amount, paymentDate, paymentMethod, notes) VALUES (?,?,?,?,?,?)',
    [id, saleId, amount, paymentDate, paymentMethod, notes || '']);
  const row = getParams('SELECT p.*, s.clientName FROM payments p LEFT JOIN sales s ON p.saleId = s.id WHERE p.id = ?', [id]);
  ok(res, row);
});

app.get('/api/expenses', (req, res) => {
  const rows = allParams('SELECT * FROM expenses ORDER BY date DESC', []);
  ok(res, rows);
});

app.post('/api/expenses', (req, res) => {
  const { date, description, amount, category } = req.body;
  if (!date || !description || amount === undefined) return fail(res, 400, 'Datos incompletos');
  const id = generateId('exp');
  runParams('INSERT INTO expenses (id, date, description, amount, category) VALUES (?,?,?,?,?)',
    [id, date, description, amount, category || '']);
  const row = getParams('SELECT * FROM expenses WHERE id = ?', [id]);
  ok(res, row);
});

app.delete('/api/expenses/:id', (req, res) => {
  const exists = getParams('SELECT id FROM expenses WHERE id = ?', [req.params.id]);
  if (!exists) return fail(res, 404, 'Gasto no encontrado');
  runParams('DELETE FROM expenses WHERE id = ?', [req.params.id]);
  ok(res, { id: req.params.id });
});

app.get('/api/reports/summary', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const monthStart = today.substring(0, 8) + '01';
  const salesRow = getParams('SELECT COALESCE(SUM(totalAmount), 0) as total_sales, COUNT(*) as count FROM sales WHERE saleDate >= ?', [monthStart]);
  const expensesRow = getParams('SELECT COALESCE(SUM(amount), 0) as total_expenses FROM expenses WHERE date >= ?', [monthStart]);
  ok(res, {
    month_sales: salesRow.total_sales || 0,
    month_expenses: expensesRow.total_expenses || 0,
    month_profit: (salesRow.total_sales || 0) - (expensesRow.total_expenses || 0),
    sales_count: salesRow.count || 0
  });
});

app.get('/api/reports/top-products', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const monthStart = today.substring(0, 8) + '01';
  const rows = allParams(`
    SELECT si.productName, SUM(si.quantity) as total_qty, SUM(si.subtotal) as total_revenue
    FROM sale_items si
    JOIN sales s ON si.saleId = s.id
    WHERE s.saleDate >= ?
    GROUP BY si.productName
    ORDER BY total_qty DESC
    LIMIT 10
  `, [monthStart]);
  ok(res, rows);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[VENTAS APP] Servidor en http://localhost:${PORT}`);
});

process.on('uncaughtException', err => console.error('Uncaught:', err));
process.on('unhandledRejection', err => console.error('Unhandled:', err));
