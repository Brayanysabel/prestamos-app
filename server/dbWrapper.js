const path = require('path');
const fs = require('fs');

const usePg = !!process.env.DATABASE_URL;

function createDB() {
  if (usePg) {
    const { Pool } = require('pg');
    const pool = new Pool({ 
      connectionString: process.env.DATABASE_URL, 
      ssl: { rejectUnauthorized: false } 
    });
    
    console.log('Connected to PostgreSQL DB in Cloud');

    const db = {
      _counter: 0,
      _formatSql: (sql) => {
        db._counter = 0;
        return sql.replace(/\?/g, () => {
          db._counter++;
          return '$' + db._counter;
        });
      },
      get: (sql, params, cb) => {
        if (typeof params === 'function') { cb = params; params = []; }
        pool.query(db._formatSql(sql), params, (err, res) => cb(err, res ? res.rows[0] : null));
      },
      all: (sql, params, cb) => {
        if (typeof params === 'function') { cb = params; params = []; }
        pool.query(db._formatSql(sql), params, (err, res) => cb(err, res ? res.rows : []));
      },
      run: function(sql, params, cb) {
        if (typeof params === 'function') { cb = params; params = []; }
        pool.query(db._formatSql(sql), params, (err, res) => {
          const context = { changes: res ? res.rowCount : 0 };
          if (cb) cb.call(context, err);
        });
      },
      exec: (sql, cb) => {
        let pgSql = sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');
        pool.query(pgSql, cb);
      },
      prepare: (sql) => {
        return {
          run: function(...args) {
            let cb = args.length > 0 && typeof args[args.length - 1] === 'function' ? args.pop() : null;
            if (args.length > 0 && args[args.length - 1] === undefined) {
              args.pop();
            }
            const params = args;
            pool.query(db._formatSql(sql), params, (err, res) => {
              const context = { changes: res ? res.rowCount : 0 };
              if (cb) cb.call(context, err);
            });
          },
          finalize: () => {}
        };
      }
    };
    return db;
  } else {
    const sqlite3 = require('sqlite3').verbose();
    const dataDir = path.resolve(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.resolve(__dirname, '../data/prestamos.db');
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Error connecting to local SQLite', err);
      } else {
        console.log('Connected to SQLite DB at', dbPath);
      }
    });
    return db;
  }
}

module.exports = createDB();
