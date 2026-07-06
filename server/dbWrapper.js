// dbWrapper.js - Conexión real a PostgreSQL (Railway)
// Compatible con la API de sqlite3 que usa server.js (callbacks estilo node)

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || process.env.DATABASE_URL_SHORT;

if (!connectionString) {
  console.error('⚠️  DATABASE_URL no está definida. El servidor arrancará sin base de datos.');
}

const pool = connectionString ? new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10
}) : null;

if (pool) {
  pool.connect()
    .then(client => {
      client.release();
      console.log('Connected to PostgreSQL DB in Cloud');
    })
    .catch(err => {
      console.error('⚠️ Error en conexión inicial a PostgreSQL:', err.message);
    });
}

// Adapta placeholders de SQLite (?) a PostgreSQL ($1, $2, ...)
function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Adapta DDL/DML de SQLite → PostgreSQL
function adaptSql(sql) {
  return sql
    // Tipos SQLite → PostgreSQL
    .replace(/\bINTEGER PRIMARY KEY AUTOINCREMENT\b/gi, 'SERIAL PRIMARY KEY')
    .replace(/\bREAL\b/g, 'DOUBLE PRECISION')
    // INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO')
    // INSERT OR REPLACE → INSERT ... ON CONFLICT ... DO UPDATE (manejado por tabla abajo)
    .replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\s+settings\b/gi, 'INSERT INTO settings')
    // SQLite json_group_array / json_object → PostgreSQL equivalente
    .replace(/json_group_array\(\s*json_object\(/gi, 'json_agg(json_build_object(')
    .replace(/\)\)\s+AS\s+instalments_json/gi, ')) AS instalments_json');
}

// Añade cláusula ON CONFLICT para sentencias que lo necesitan
function addConflictClause(originalSql, adaptedSql) {
  const orig = originalSql.toUpperCase();
  // INSERT OR IGNORE → ON CONFLICT DO NOTHING
  if (/INSERT\s+OR\s+IGNORE/i.test(originalSql)) {
    if (!adaptedSql.toUpperCase().includes('ON CONFLICT')) {
      return adaptedSql.trimEnd().replace(/;?\s*$/, '') + ' ON CONFLICT DO NOTHING';
    }
  }
  // INSERT OR REPLACE INTO settings → ON CONFLICT (companyId, key) DO UPDATE
  if (/INSERT\s+OR\s+REPLACE\s+INTO\s+settings/i.test(originalSql)) {
    if (!adaptedSql.toUpperCase().includes('ON CONFLICT')) {
      return adaptedSql.trimEnd().replace(/;?\s*$/, '') + ' ON CONFLICT (companyId, key) DO UPDATE SET value = EXCLUDED.value';
    }
  }
  return adaptedSql;
}

// db.exec — DDL multi-statement (CREATE TABLE, etc.)
function exec(sql, cb) {
  if (!pool) {
    if (typeof cb === 'function') cb(new Error('No hay conexión a la base de datos'));
    return;
  }
  const adapted = adaptSql(sql);
  const statements = adapted
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

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

// Transform row from lowercase postgres to camelCase
function camelCaseRow(row) {
  if (!row) return row;
  const map = {
    'companyid': 'companyId',
    'clientname': 'clientName',
    'clientid': 'clientId',
    'loanid': 'loanId',
    'createdat': 'createdAt',
    'validuntil': 'validUntil',
    'remainingbalance': 'remainingBalance',
    'interestamount': 'interestAmount',
    'totalpayable': 'totalPayable',
    'instalmentidx': 'instalmentIdx',
    'paymentid': 'paymentId',
    'duedate': 'dueDate',
    'startdate': 'startDate'
  };
  const newRow = {};
  for (let key in row) {
    newRow[map[key] || key] = row[key];
  }
  return newRow;
}

// db.get — primera fila
function get(sql, params, cb) {
  if (typeof params === 'function') { cb = params; params = []; }
  if (!pool) { if (typeof cb === 'function') cb(new Error('Sin DB'), null); return; }
  const adapted = convertPlaceholders(adaptSql(sql));
  pool.query(adapted, params || [])
    .then(result => {
      let row = result.rows[0] || null;
      if (row) row = camelCaseRow(row);
      // Normalizar COUNT(*) de string a number (PostgreSQL retorna strings)
      if (row && row.count !== undefined) row.count = parseInt(row.count, 10);
      if (typeof cb === 'function') cb(null, row);
    })
    .catch(err => {
      console.error('[DB GET ERROR]', err.message, '\nSQL:', adapted);
      if (typeof cb === 'function') cb(err, null);
    });
}

// db.all — todas las filas
function all(sql, params, cb) {
  if (typeof params === 'function') { cb = params; params = []; }
  if (!pool) { if (typeof cb === 'function') cb(new Error('Sin DB'), []); return; }
  const adapted = convertPlaceholders(adaptSql(sql));
  pool.query(adapted, params || [])
    .then(result => {
      const rows = result.rows.map(camelCaseRow);
      if (typeof cb === 'function') cb(null, rows);
    })
    .catch(err => {
      console.error('[DB ALL ERROR]', err.message, '\nSQL:', adapted);
      if (typeof cb === 'function') cb(err, null);
    });
}

// db.run — INSERT / UPDATE / DELETE
function run(sql, params, cb) {
  if (typeof params === 'function') { cb = params; params = []; }
  if (!pool) { if (typeof cb === 'function') cb.call({ changes: 0 }, new Error('Sin DB')); return; }
  let adapted = addConflictClause(sql, convertPlaceholders(adaptSql(sql)));
  pool.query(adapted, params || [])
    .then(result => {
      if (typeof cb === 'function') cb.call({ changes: result.rowCount }, null);
    })
    .catch(err => {
      console.error('[DB RUN ERROR]', err.message, '\nSQL:', adapted);
      if (typeof cb === 'function') cb.call({ changes: 0 }, err);
    });
}

// db.prepare — wrapper compatible con sqlite3
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

// db.serialize — no-op para PostgreSQL
function serialize(fn) {
  if (typeof fn === 'function') fn();
}

module.exports = { exec, get, all, run, prepare, serialize };
