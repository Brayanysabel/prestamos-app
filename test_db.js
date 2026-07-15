const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'data', 'prestamos.db'));

db.all("PRAGMA table_info(loans);", (err, rows) => {
  if (err) console.error(err);
  else console.log("loans columns:", rows.map(r => r.name).join(', '));
});
