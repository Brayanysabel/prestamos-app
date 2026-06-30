const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

const dbPath = path.resolve(__dirname, 'data/prestamos.db');
const db = new sqlite3.Database(dbPath);

console.log("Reiniciando base de datos...");

db.serialize(async () => {
  db.run("DROP TABLE IF EXISTS payments");
  db.run("DROP TABLE IF EXISTS instalments");
  db.run("DROP TABLE IF EXISTS loans");
  db.run("DROP TABLE IF EXISTS clients");
  db.run("DROP TABLE IF EXISTS settings");
  db.run("DROP TABLE IF EXISTS users");
  db.run("DROP TABLE IF EXISTS companies");
  
  console.log("Tablas eliminadas. Por favor reinicia tu servidor (node server/server.js) para que se creen en blanco.");
  db.close();
});
