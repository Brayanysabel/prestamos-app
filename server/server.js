// server/server.js
const express = require('express');
const cors = require('cors');

const path = require('path');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 5050;

// Security Middlewares
app.use(helmet()); // Añade cabeceras de seguridad
app.use(cors({ origin: '*' }));
app.use(express.json());

// Rate Limiting para Login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // Límite de 5 intentos por IP
  message: { error: 'Demasiados intentos fallidos, por favor intente en 15 minutos.' }
});

// app.use('/api/login', loginLimiter); // Desactivado temporalmente para pruebas

// Serve static files from the parent directory
app.use(express.static(path.resolve(__dirname, '../')));

const JWT_SECRET = process.env.JWT_SECRET || 'prestamos_super_secret_key_123!';

// Token auth middleware
app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.method === 'OPTIONS') {
    return next();
  }

  const token = req.headers['x-auth-token'];
  if (!token) {
    return res.status(401).json({ error: 'No autorizado / Token requerido' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
    req.user = decoded; // { username, companyId, plan } // ej. { username: 'admin' }
    next();
  });
});


// Initialize DB
const db = require('./dbWrapper');

// Create tables if they don't exist
const initSql = `
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'basico',
  status TEXT NOT NULL DEFAULT 'active',
  max_loans INTEGER NOT NULL DEFAULT 500,
  max_users INTEGER NOT NULL DEFAULT 2,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  companyId TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  companyId TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  createdAt TEXT
);

CREATE TABLE IF NOT EXISTS loans (
  id TEXT PRIMARY KEY,
  companyId TEXT NOT NULL,
  clientId TEXT NOT NULL,
  clientName TEXT NOT NULL,
  amount REAL NOT NULL,
  rate REAL NOT NULL,
  term INTEGER NOT NULL,
  frequency TEXT NOT NULL,
  type TEXT NOT NULL,
  startDate TEXT NOT NULL,
  totalPayable REAL NOT NULL,
  interestAmount REAL NOT NULL,
  status TEXT NOT NULL,
  remainingBalance REAL NOT NULL,
  FOREIGN KEY (clientId) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS instalments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  companyId TEXT NOT NULL,
  loanId TEXT NOT NULL,
  idx INTEGER NOT NULL,
  dueDate TEXT NOT NULL,
  amount REAL NOT NULL,
  capital REAL NOT NULL,
  interest REAL NOT NULL,
  paid REAL NOT NULL,
  status TEXT NOT NULL,
  FOREIGN KEY (loanId) REFERENCES loans(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  companyId TEXT NOT NULL,
  loanId TEXT NOT NULL,
  instalmentIdx INTEGER NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  FOREIGN KEY (loanId) REFERENCES loans(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT,
  companyId TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (companyId, key)
);
`;

db.exec(initSql, async err => {
  if (err) console.error('Error initializing DB schema', err);
  else {
    // Seed admin user if none exists, or update weak passwords
    const defaultHash = await bcrypt.hash('admin', 10);
    
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
      if (!err && row.count === 0) {
        const stmt = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)");
        stmt.run("admin", defaultHash);
        stmt.finalize();
        console.log("Seeded default admin user with bcrypt.");
      } else {
        // Migration: If any password does NOT start with '$2b$' (bcrypt signature), update it to 'admin' hashed
        db.run("UPDATE users SET password = ? WHERE password NOT LIKE '$2b$%'", [defaultHash], function(err) {
          if (!err && this.changes > 0) {
            console.log(`Migrated ${this.changes} legacy plaintext passwords to secure bcrypt hashes.`);
          }
        });
      }
    });
  }
});

// Helper to generate IDs
function generateId(prefix) {
  return `${prefix}_` + Math.random().toString(36).substring(2, 9);
}

// ----- API Endpoints ----- //

// Settings
app.get('/api/settings', (req, res) => {
  db.all("SELECT key, value FROM settings WHERE companyId = ?", [req.user.companyId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  });
});

app.put('/api/settings', (req, res) => {
  const username = req.user?.username;
  if (!username) return res.status(401).json({ error: 'No autorizado' });

  const { companyName, companyLogo } = req.body;
  const stmt = db.prepare("INSERT OR REPLACE INTO settings (companyId, key, value) VALUES (?, ?, ?)");
  
  try {
    if (companyName !== undefined) stmt.run(req.user.companyId, 'companyName', companyName);
    if (companyLogo !== undefined) stmt.run(req.user.companyId, 'companyLogo', companyLogo);
    stmt.finalize();
    res.json({ message: 'Ajustes guardados correctamente' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Login
app.post('/api/login', (req, res) => {
  let { username, password } = req.body;
  
  if (!username || !password) {
    console.log(`[LOGIN FAILED] Missing fields`);
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }

  username = username.trim(); // <-- Arreglo para celulares que añaden un espacio al final
  console.log(`[LOGIN ATTEMPT] username: '${username}', password: '${password}'`);
  
  db.get("SELECT u.*, c.plan FROM users u JOIN companies c ON u.companyId = c.id WHERE u.username = ?", [username], async (err, row) => {
    if (err) {
      console.log(`[LOGIN FAILED] DB Error:`, err.message);
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      console.log(`[LOGIN FAILED] User not found`);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const isMatch = await bcrypt.compare(password, row.password);
    if (!isMatch) {
      console.log(`[LOGIN FAILED] Password mismatch`);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    console.log(`[LOGIN SUCCESS] User: ${username}`);
    // Generate JWT token
    const token = jwt.sign({ username: row.username, companyId: row.companyId, plan: row.plan }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, username });
  });
});

// Cambiar usuario y contraseña
app.put('/api/users/me', async (req, res) => {
  const username = req.user?.username; // From JWT middleware
  
  if (!username) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const { newUsername, newPassword } = req.body;
  if (!newUsername || !newPassword) {
    return res.status(400).json({ error: 'Nuevo usuario y contraseña son requeridos' });
  }

  try {
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    db.run("UPDATE users SET username = ?, password = ? WHERE username = ?", [newUsername, hashedNewPassword, username], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      // We don't invalidate tokens explicitly since they expire automatically.
      res.json({ message: 'Credenciales actualizadas correctamente. Inicia sesión de nuevo.' });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Respaldo por Correo
app.post('/api/backup/email', (req, res) => {
  const { toEmail, smtpUser, smtpPass } = req.body;
  if (!toEmail) return res.status(400).json({ error: 'Correo destino es requerido' });
  if (!smtpUser || !smtpPass) return res.status(400).json({ error: 'Credenciales SMTP (Remitente) son requeridas' });

  // Recopilar datos
  db.all('SELECT * FROM clients WHERE companyId = ?', [], (err, clients) => {
    if (err) return res.status(500).json({ error: err.message });
    db.all('SELECT * FROM loans', [], (err, loans) => {
      if (err) return res.status(500).json({ error: err.message });
      db.all('SELECT * FROM instalments', [], (err, instalments) => {
        if (err) return res.status(500).json({ error: err.message });
        db.all('SELECT * FROM payments', [], (err, payments) => {
          if (err) return res.status(500).json({ error: err.message });
          
          const backupData = {
            timestamp: new Date().toISOString(),
            clients,
            loans,
            instalments,
            payments
          };
          
          const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
              user: smtpUser,
              pass: smtpPass
            }
          });

          const mailOptions = {
            from: smtpUser,
            to: toEmail,
            subject: 'Respaldo de Base de Datos - PrestamosApp',
            text: 'Se adjunta el respaldo de la base de datos generado el ' + new Date().toLocaleString(),
            attachments: [
              {
                filename: 'prestamos_backup.json',
                content: JSON.stringify(backupData, null, 2)
              }
            ]
          };

          transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
              return res.status(500).json({ error: 'Error al enviar correo: ' + error.message });
            }
            res.json({ message: 'Respaldo enviado exitosamente' });
          });
        });
      });
    });
  });
});

// Clients
app.get('/api/clients', (req, res) => {
  db.all('SELECT * FROM clients WHERE companyId = ?', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/clients', (req, res) => {
  const { name, phone, email, notes } = req.body;
  const id = generateId('cli');
  const createdAt = new Date().toISOString();
  const stmt = db.prepare('INSERT INTO clients (id, name, phone, email, notes, createdAt) VALUES (?,?,?,?,?,?)');
  stmt.run(id, req.user.companyId, req.user.companyId, name, phone, email, notes, createdAt, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id, name, phone, email, notes, createdAt });
  });
  stmt.finalize();
});

// Borrar Cliente Seguro
app.delete('/api/clients/:id', (req, res) => {
  const username = req.user?.username;
  const password = req.body.password;
  const clientId = req.params.id;

  if (!username) return res.status(401).json({ error: 'No autorizado' });
  if (!password) return res.status(400).json({ error: 'Se requiere contraseña para borrar' });

  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(403).json({ error: 'Usuario no encontrado' });
    
    const isMatch = await bcrypt.compare(password, row.password);
    if (!isMatch) {
      return res.status(403).json({ error: 'Contraseña incorrecta' });
    }

    // Borrado en cascada: pagos -> cuotas -> préstamos -> cliente
    db.run("DELETE FROM payments WHERE loanId IN (SELECT id FROM loans WHERE clientId = ?)", [clientId], (err) => {
      db.run("DELETE FROM instalments WHERE loanId IN (SELECT id FROM loans WHERE clientId = ?)", [clientId], (err) => {
        db.run("DELETE FROM loans WHERE clientId = ?", [clientId], (err) => {
          db.run("DELETE FROM clients WHERE id = ? AND companyId = ?", [clientId, req.user.companyId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Cliente eliminado exitosamente' });
          });
        });
      });
    });
  });
});


// Loans
app.get('/api/loans', (req, res) => {
  const sql = `
    SELECT l.*, json_group_array(json_object(
      'idx', i.idx,
      'dueDate', i.dueDate,
      'amount', i.amount,
      'capital', i.capital,
      'interest', i.interest,
      'paid', i.paid,
      'status', i.status
    )) AS instalments_json
    FROM loans l LEFT JOIN instalments i ON l.id = i.loanId WHERE l.companyId = ? GROUP BY l.id`;
  db.all(sql, [req.user.companyId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const loans = rows.map(r => ({
      ...r,
      instalments: JSON.parse(r.instalments_json)
    }));
    res.json(loans);
  });
});

app.post('/api/loans', (req, res) => {
  const loan = req.body; // expect full loan object
  const stmt = db.prepare(`INSERT INTO loans (id, clientId, clientName, amount, rate, term, frequency, type, startDate, totalPayable, interestAmount, status, remainingBalance) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  stmt.run(
    loan.id,
    loan.clientId,
    loan.clientName,
    loan.amount,
    loan.rate,
    loan.term,
    loan.frequency,
    loan.type,
    loan.startDate,
    loan.totalPayable,
    loan.interestAmount,
    loan.status,
    loan.remainingBalance,
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      // Insert instalments
      const insStmt = db.prepare('INSERT INTO instalments (companyId, loanId, idx, dueDate, amount, capital, interest, paid, status) VALUES (?,?,?,?,?,?,?,?,?)');
      loan.instalments.forEach(inst => {
        insStmt.run(req.user.companyId, loan.id, inst.index, inst.dueDate, inst.amount, inst.capital, inst.interest, inst.paid, inst.status);
      });
      insStmt.finalize();
      res.json({ message: 'Loan saved' });
    }
  );
  stmt.finalize();
});

// Borrar Préstamo Seguro
app.delete('/api/loans/:id', (req, res) => {
  const username = req.user?.username;
  const password = req.body.password;
  const loanId = req.params.id;

  if (!username) return res.status(401).json({ error: 'No autorizado' });
  if (!password) return res.status(400).json({ error: 'Se requiere contraseña para borrar' });

  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(403).json({ error: 'Usuario no encontrado' });
    
    const isMatch = await bcrypt.compare(password, row.password);
    if (!isMatch) {
      return res.status(403).json({ error: 'Contraseña incorrecta' });
    }

    // Si la contraseña es correcta, borrar todo lo relacionado al préstamo
    db.run("DELETE FROM payments WHERE loanId = ? AND companyId = ?", [loanId], (err) => {
      db.run("DELETE FROM instalments WHERE loanId = ? AND companyId = ?", [loanId], (err) => {
        db.run("DELETE FROM loans WHERE id = ? AND companyId = ?", [loanId], (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: 'Préstamo eliminado exitosamente' });
        });
      });
    });
  });
});

// Payments
app.post('/api/payments', (req, res) => {
  const { loanId, instalmentIdx, amount, date } = req.body; // date format YYYY-MM-DD
  const paymentId = generateId('pay');
  const stmt = db.prepare('INSERT INTO payments (id, loanId, instalmentIdx, amount, date) VALUES (?,?,?,?,?)');
  stmt.run(paymentId, loanId, instalmentIdx, amount, date, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    // Update instalment paid and possibly status
    db.run('UPDATE instalments SET paid = paid + ?, status = CASE WHEN paid + ? >= amount THEN "paid" ELSE status END WHERE loanId = ? AND idx = ?', [amount, amount, loanId, instalmentIdx], function (err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      // Recalculate remaining balance for loan
      db.get('SELECT SUM(amount - paid) AS remain FROM instalments WHERE loanId = ?', [loanId], (err3, row) => {
        if (err3) return res.status(500).json({ error: err3.message });
        const remaining = row.remain || 0;
        const newStatus = remaining === 0 ? 'paid' : 'active';
        db.run('UPDATE loans SET remainingBalance = ?, status = ? WHERE id = ?', [remaining, newStatus, loanId]);
        res.json({ paymentId });
      });
    });
  });
  stmt.finalize();
});

// Descargar Base de Datos
app.get('/api/backup/download', (req, res) => {
  const username = req.user?.username;
  if (!username) return res.status(401).json({ error: 'No autorizado' });
  
  const dbPath = path.join(__dirname, '..', 'data', 'prestamos.db');
  res.download(dbPath, `respaldo_prestamos_${new Date().toISOString().split('T')[0]}.db`);
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
