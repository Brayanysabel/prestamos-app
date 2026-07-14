// dbWrapper.js - Conexión PostgreSQL con retry/keepalive
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('⚠️  DATABASE_URL no definida. El servidor arrancará sin base de datos.');
}

const pool = connectionString ? new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 10000,
  max: 10,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
}) : null;

if (pool) {
  pool.connect()
    .then(client => {
      client.release();
      console.log('✅ Conectado a PostgreSQL');
    })
    .catch(err => {
      console.error('⚠️ Error conexión inicial PostgreSQL:', err.message);
    });
}

function adaptSql(sql) {
  return sql
    .replace(/\bINTEGER PRIMARY KEY AUTOINCREMENT\b/gi, 'SERIAL PRIMARY KEY')
    .replace(/\bREAL\b/g, 'DOUBLE PRECISION')
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO')
    .replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\s+settings\b/gi, 'INSERT INTO settings')
    .replace(/json_group_array\(\s*json_object\(/gi, 'json_agg(json_build_object(')
    .replace(/\)\)\s+AS\s+instalments_json/gi, ')) AS instalments_json');
}

function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function addConflictClause(originalSql, adaptedSql) {
  const orig = originalSql.toUpperCase();
  if (/INSERT\s+OR\s+IGNORE/i.test(originalSql)) {
    if (!adaptedSql.toUpperCase().includes('ON CONFLICT')) {
      return adaptedSql.trimEnd().replace(/;?\s*$/, '') + ' ON CONFLICT DO NOTHING';
    }
  }
  if (/INSERT\s+OR\s+REPLACE\s+INTO\s+settings/i.test(originalSql)) {
    if (!adaptedSql.toUpperCase().includes('ON CONFLICT')) {
      return adaptedSql.trimEnd().replace(/;?\s*$/, '') + ' ON CONFLICT (companyId, key) DO UPDATE SET value = EXCLUDED.value';
    }
  }
  return adaptedSql;
}

function isTransientError(err) {
  if (!err) return false;
  const code = err.code || '';
  const msg = (err.message || '').toLowerCase();
  return (
    code === '57P01' ||
    code === '57P02' ||
    code === '57P03' ||
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    msg.includes('socket closed') ||
    msg.includes('connection terminated') ||
    msg.includes('terminating connection')
  );
}

async function withRetry(fn, retries = 2, delayMs = 300) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries && isTransientError(err)) {
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function exec(sql, cb) {
  if (!pool) {
    if (typeof cb === 'function') cb(new Error('No hay conexión a la base de datos'));
    return;
  }
  const adapted = adaptSql(sql);
  const statements = adapted.split(';').map(s => s.trim()).filter(s => s.length > 0);
  (async () => {
    const client = await pool.connect();
    try {
      for (const stmt of statements) {
        await client.query(stmt);
      }
      if (typeof cb === 'function') cb(null);
    } catch (err) {
      console.error('[DB EXEC ERROR]', err.message);
      if (typeof cb === 'function') cb(err);
    } finally {
      client.release();
    }
  })().catch(err => {
    console.error('[DB EXEC POOL ERROR]', err.message);
    if (typeof cb === 'function') cb(err);
  });
}

function camelCaseRow(row) {
  if (!row) return row;
  const map = {
    companyid: 'companyId', clientname: 'clientName', clientid: 'clientId',
    loanid: 'loanId', createdat: 'createdAt', validuntil: 'validUntil',
    remainingbalance: 'remainingBalance', interestamount: 'interestAmount',
    totalpayable: 'totalPayable', instalmentidx: 'instalmentIdx',
    paymentid: 'paymentId', duedate: 'dueDate', startdate: 'startDate',
    productid: 'productId', saledate: 'saleDate', clientname: 'clientName',
    saleid: 'saleId', itemidx: 'itemIdx', unitprice: 'unitPrice',
    subtotal: 'subTotal', taxamount: 'taxAmount', totalamount: 'totalAmount',
    paymentmethod: 'paymentMethod', productname: 'productName',
    category: 'category', stock: 'stock', costprice: 'costPrice',
    saleprice: 'salePrice', barcode: 'barcode', sku: 'sku',
    description: 'description', supplier: 'supplier'
  };
  const newRow = {};
  for (const key in row) {
    newRow[map[key] || key] = row[key];
  }
  return newRow;
}

function get(sql, params, cb) {
  if (typeof params === 'function') { cb = params; params = []; }
  if (!pool) { if (typeof cb === 'function') cb(new Error('Sin DB'), null); return; }
  const adapted = convertPlaceholders(adaptSql(sql));
  withRetry(() => pool.query(adapted, params || []))
    .then(result => {
      let row = result.rows[0] || null;
      if (row) row = camelCaseRow(row);
      if (row && row.count !== undefined) row.count = parseInt(row.count, 10);
      if (typeof cb === 'function') cb(null, row);
    })
    .catch(err => {
      console.error('[DB GET ERROR]', err.message, '\nSQL:', adapted);
      if (typeof cb === 'function') cb(err, null);
    });
}

function all(sql, params, cb) {
  if (typeof params === 'function') { cb = params; params = []; }
  if (!pool) { if (typeof cb === 'function') cb(new Error('Sin DB'), []); return; }
  const adapted = convertPlaceholders(adaptSql(sql));
  withRetry(() => pool.query(adapted, params || []))
    .then(result => {
      const rows = result.rows.map(camelCaseRow);
      if (typeof cb === 'function') cb(null, rows);
    })
    .catch(err => {
      console.error('[DB ALL ERROR]', err.message, '\nSQL:', adapted);
      if (typeof cb === 'function') cb(err, null);
    });
}

function run(sql, params, cb) {
  if (typeof params === 'function') { cb = params; params = []; }
  if (!pool) { if (typeof cb === 'function') cb.call({ changes: 0 }, new Error('Sin DB')); return; }
  let adapted = addConflictClause(sql, convertPlaceholders(adaptSql(sql)));
  withRetry(() => pool.query(adapted, params || []))
    .then(result => {
      if (typeof cb === 'function') cb.call({ changes: result.rowCount }, null);
    })
    .catch(err => {
      console.error('[DB RUN ERROR]', err.message, '\nSQL:', adapted);
      if (typeof cb === 'function') cb.call({ changes: 0 }, err);
    });
}

function prepare(sql) {
  return {
    run: (...args) => {
      let cb = null;
      if (args.length && typeof args[args.length - 1] === 'function') {
        cb = args.pop();
      }
      const params = Array.isArray(args[0]) && args.length === 1 ? args[0] : args;
      run(sql, params, cb);
    },
    finalize: () => {}
  };
}

function serialize(fn) {
  if (typeof fn === 'function') fn();
}

module.exports = { exec, get, all, run, prepare, serialize };
