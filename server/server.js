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

// Serve static files from the www directory
app.use(express.static(path.resolve(__dirname, '../www')));

const JWT_SECRET = process.env.JWT_SECRET || 'prestamos_super_secret_key_123!';

// Token auth middleware
app.use('/api', (req, res, next) => {
  const publicRoutes = ['/login', '/signup', '/forgot-password', '/reset-password'];
  if (publicRoutes.includes(req.path) || req.method === 'OPTIONS') {
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
  validUntil TEXT,
  max_loans INTEGER NOT NULL DEFAULT 500,
  max_users INTEGER NOT NULL DEFAULT 2,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saas_payments (
  id TEXT PRIMARY KEY,
  companyId TEXT NOT NULL,
  amount REAL NOT NULL,
  months INTEGER NOT NULL,
  date TEXT NOT NULL,
  notes TEXT,
  FOREIGN KEY (companyId) REFERENCES companies(id)
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

CREATE TABLE IF NOT EXISTS saas_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  max_users INTEGER NOT NULL,
  max_loans INTEGER NOT NULL
);
`;

db.exec(initSql, async err => {
  if (err) console.error('Error initializing DB schema', err);
  else {
    // Inicializar planes por defecto si no existen
    db.get("SELECT COUNT(*) as count FROM saas_plans", (err, row) => {
      if (!err && row.count === 0) {
        const stmt = db.prepare("INSERT INTO saas_plans (id, name, price, max_users, max_loans) VALUES (?, ?, ?, ?, ?)");
        stmt.run('principiante', 'Principiante', 900, 1, 20);
        stmt.run('basico', 'Básico', 1500, 2, 50);
        stmt.run('intermedio', 'Intermedio', 2000, 5, 200);
        stmt.run('premium', 'Premium', 2500, 10, 999999);
        stmt.finalize();
      }
    });

    // Seed admin user if none exists, or update weak passwords
    const defaultHash = await bcrypt.hash('admin', 10);
    
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
      if (!err && row.count === 0) {
        const defaultCompanyId = 'comp_default';
        db.run("INSERT OR IGNORE INTO companies (id, name, plan, status, validUntil, max_loans, max_users, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [defaultCompanyId, 'Administración Central', 'premium', 'active', '2099-12-31', 9999, 9999, new Date().toISOString()], (err) => {
            if (!err) {
              const stmt = db.prepare("INSERT INTO users (username, password, companyId) VALUES (?, ?, ?)");
              stmt.run("admin", defaultHash, defaultCompanyId);
              stmt.finalize();
              console.log("Seeded default admin user and company.");
            }
          }
        );
      } else {
        // Migration: Ensure legacy users have a companyId
        const defaultCompanyId = 'comp_default';
        db.run("INSERT OR IGNORE INTO companies (id, name, plan, status, validUntil, max_loans, max_users, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [defaultCompanyId, 'Administración Central', 'premium', 'active', '2099-12-31', 9999, 9999, new Date().toISOString()], (err) => {
            // ALTER TABLE users ADD COLUMN companyId (if it doesn't exist)
            const tablesToMigrate = ['users', 'clients', 'loans', 'instalments', 'payments', 'settings'];
            tablesToMigrate.forEach(table => {
              db.run(`ALTER TABLE ${table} ADD COLUMN companyId TEXT`, () => {
                db.run(`UPDATE ${table} SET companyId = ? WHERE companyId IS NULL`, [defaultCompanyId], function(err) {
                  if (!err && this.changes > 0) {
                    console.log(`Migrated ${this.changes} legacy records in ${table} to default company.`);
                  }
                });
              });
            });
            
            // Añadir resetToken
            db.run("ALTER TABLE users ADD COLUMN resetToken TEXT", () => {});
            db.run("ALTER TABLE users ADD COLUMN resetTokenExpires TEXT", () => {});
            
            // Añadir validUntil a companies
            db.run("ALTER TABLE companies ADD COLUMN validUntil TEXT", () => {
              // Update existing companies to have 30 days valid from today
              const defaultValid = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
              db.run("UPDATE companies SET validUntil = ? WHERE validUntil IS NULL", [defaultValid]);
            });
          }
        );

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

// Signup (Crear nueva empresa)
app.post('/api/signup', async (req, res) => {
  let { companyName, username, password, plan } = req.body;
  if (!companyName || !username || !password) return res.status(400).json({ error: 'Faltan datos requeridos' });
  
  username = username.trim();
  const companyId = 'comp_' + Math.random().toString(36).substring(2, 10);
  const hash = await bcrypt.hash(password, 10);
  
  // Set limits based on plan
  let max_loans = 100, max_users = 1;
  if (plan === 'principiante') { max_loans = 100; max_users = 1; }
  else if (plan === 'basico') { max_loans = 500; max_users = 2; }
  else if (plan === 'intermedio') { max_loans = 1000; max_users = 4; }
  else if (plan === 'premium') { max_loans = 100000; max_users = 100; } // Plan Premium
  else { plan = 'basico'; max_loans = 500; max_users = 2; }
  
  db.get('SELECT username FROM users WHERE username = ?', [username], (err, row) => {
    if (row) return res.status(400).json({ error: 'El usuario ya existe' });
    
    const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const stmtC = db.prepare('INSERT INTO companies (id, name, plan, status, validUntil, max_loans, max_users, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    stmtC.run(companyId, companyName, plan, 'active', validUntil, max_loans, max_users, new Date().toISOString(), (err) => {
      if (err) return res.status(500).json({ error: err.message });
      
      const stmtU = db.prepare('INSERT INTO users (username, password, companyId) VALUES (?, ?, ?)');
      stmtU.run(username, hash, companyId, (err) => {
         if (err) return res.status(500).json({ error: err.message });
         res.json({ message: 'Empresa registrada correctamente', companyId });
      });
      stmtU.finalize();
    });
    stmtC.finalize();
  });
});


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
  
  db.get("SELECT u.*, c.plan, c.status, c.validUntil FROM users u JOIN companies c ON u.companyId = c.id WHERE u.username = ?", [username], async (err, row) => {
    if (err) {
      console.log(`[LOGIN FAILED] DB Error:`, err.message);
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      console.log(`[LOGIN FAILED] User not found`);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    // Check if company is active
    const isSuperAdmin = row.username === 'admin' && row.companyId === 'comp_default';
    if (!isSuperAdmin) {
      if (row.status === 'suspended') {
        return res.status(403).json({ error: 'La cuenta de su empresa se encuentra suspendida.' });
      }
      
      // Check if subscription expired
      if (row.validUntil) {
        const today = new Date().toISOString().split('T')[0];
        if (today > row.validUntil) {
          return res.status(403).json({ error: 'Suscripción vencida. Por favor registre su pago para continuar.' });
        }
      }
    }
    
    const isMatch = await bcrypt.compare(password, row.password);
    if (!isMatch) {
      console.log(`[LOGIN FAILED] Password mismatch`);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    console.log(`[LOGIN SUCCESS] User: ${username}`);
    // Generate JWT token
    const token = jwt.sign({ username: row.username, companyId: row.companyId, plan: row.plan, isSuperAdmin }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, username, isSuperAdmin });
  });
});


// Recuperación de Contraseña (Forgot Password)
app.post('/api/forgot-password', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'El usuario o correo es requerido' });

  db.get("SELECT username FROM users WHERE username = ?", [username], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) {
      return res.json({ message: 'Si el usuario existe, se ha enviado un correo con las instrucciones.' });
    }

    const resetToken = require('crypto').randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000).toISOString(); // 1 hora

    db.run("UPDATE users SET resetToken = ?, resetTokenExpires = ? WHERE username = ?", [resetToken, expires, username], (err) => {
      if (err) return res.status(500).json({ error: 'Error al generar token' });

      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER || 'tucorreo@gmail.com',
          pass: process.env.EMAIL_PASS || 'tucontraseña'
        }
      });

      const mailOptions = {
        from: process.env.EMAIL_USER || 'no-reply@prestamosapp.com',
        to: username,
        subject: 'Recuperación de Contraseña - PrestamosApp',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #2563eb; color: white; padding: 20px; text-align: center;">
              <h2 style="margin: 0;">Recuperación de Contraseña</h2>
            </div>
            <div style="padding: 20px;">
              <p>Hola <b>${username}</b>,</p>
              <p>Has solicitado restablecer tu contraseña. Utiliza el siguiente código de recuperación en la aplicación:</p>
              <div style="text-align: center; margin: 30px 0;">
                <h2 style="background: #f3f4f6; padding: 15px 20px; display: inline-block; letter-spacing: 2px; border-radius: 4px; border: 1px dashed #2563eb;">${resetToken.substring(0, 8).toUpperCase()}</h2>
              </div>
              <p>O simplemente cópialo. Este código expirará en 1 hora.</p>
              <p>Si no solicitaste esto, puedes ignorar este mensaje.</p>
            </div>
          </div>
        `
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error("Error enviando correo de recuperación:", error);
        }
        res.json({ message: 'Si el usuario existe, se ha enviado un correo con las instrucciones.', token: resetToken.substring(0, 8).toUpperCase() });
      });
    });
  });
});

// Reset Password (Restablecer con el token)
app.post('/api/reset-password', async (req, res) => {
  const { username, token, newPassword } = req.body;
  if (!username || !token || !newPassword) return res.status(400).json({ error: 'Faltan datos requeridos' });

  db.get("SELECT resetToken, resetTokenExpires FROM users WHERE username = ?", [username], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    
    if (!row || !row.resetToken || row.resetToken.substring(0, 8).toUpperCase() !== token.toUpperCase()) {
      return res.status(400).json({ error: 'El código de recuperación es inválido o incorrecto' });
    }
    if (new Date(row.resetTokenExpires) < new Date()) {
      return res.status(400).json({ error: 'El código de recuperación ha expirado' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    db.run("UPDATE users SET password = ?, resetToken = NULL, resetTokenExpires = NULL WHERE username = ?", [hash, username], (err) => {
      if (err) return res.status(500).json({ error: 'Error al cambiar la contraseña' });
      res.json({ message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.' });
    });
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
  db.all('SELECT * FROM clients WHERE companyId = ?', [req.user.companyId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/clients', (req, res) => {
  const { name, phone, email, notes } = req.body;
  const id = generateId('cli');
  const createdAt = new Date().toISOString();
  const stmt = db.prepare('INSERT INTO clients (id, companyId, name, phone, email, notes, createdAt) VALUES (?,?,?,?,?,?,?)');
  stmt.run(id, req.user.companyId, name, phone, email, notes, createdAt, function (err) {
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
  const companyId = req.user.companyId;

  db.get('SELECT max_loans FROM companies WHERE id = ?', [companyId], (err, compRow) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!compRow) return res.status(404).json({ error: 'Empresa no encontrada' });

    const maxLoans = compRow.max_loans;
    
    db.get('SELECT COUNT(*) as count FROM loans WHERE companyId = ?', [companyId], (err, countRow) => {
      if (err) return res.status(500).json({ error: err.message });
      
      if (countRow.count >= maxLoans) {
        return res.status(403).json({ error: 'Has alcanzado el límite de préstamos (' + maxLoans + ') de tu plan actual. Por favor, mejora tu plan.' });
      }

      const stmt = db.prepare(`INSERT INTO loans (id, companyId, clientId, clientName, amount, rate, term, frequency, type, startDate, totalPayable, interestAmount, status, remainingBalance) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      stmt.run(
        loan.id,
        companyId,
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
            insStmt.run(companyId, loan.id, inst.index, inst.dueDate, inst.amount, inst.capital, inst.interest, inst.paid, inst.status);
          });
          insStmt.finalize();
          res.json({ message: 'Loan saved' });
        }
      );
      stmt.finalize();
    });
  });
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
  const companyId = req.user.companyId;
  const stmt = db.prepare('INSERT INTO payments (id, companyId, loanId, instalmentIdx, amount, date) VALUES (?,?,?,?,?,?)');
  stmt.run(paymentId, companyId, loanId, instalmentIdx, amount, date, function (err) {
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
// --- SaaS Super Admin Endpoints ---
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.username !== 'admin' || req.user.companyId !== 'comp_default') {
    return res.status(403).json({ error: 'Acceso denegado. Solo Super Admin.' });
  }
  next();
}

app.get('/api/saas/companies', requireSuperAdmin, (req, res) => {
  db.all(`
    SELECT c.*, 
      (SELECT COUNT(*) FROM users WHERE companyId = c.id) as userCount,
      (SELECT COUNT(*) FROM clients WHERE companyId = c.id) as clientCount,
      (SELECT COUNT(*) FROM loans WHERE companyId = c.id) as loanCount
    FROM companies c
    ORDER BY c.createdAt DESC
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/saas/payments', requireSuperAdmin, (req, res) => {
  const { targetCompanyId, amount, months, notes } = req.body;
  if (!targetCompanyId || !amount || !months) return res.status(400).json({ error: 'Faltan datos requeridos' });

  const paymentId = generateId('spay');
  const date = new Date().toISOString();

  // 1. Insert payment record
  const stmt = db.prepare('INSERT INTO saas_payments (id, companyId, amount, months, date, notes) VALUES (?,?,?,?,?,?)');
  stmt.run(paymentId, targetCompanyId, amount, months, date, notes, function(err) {
    if (err) return res.status(500).json({ error: err.message });

    // 2. Extend validUntil and activate if suspended
    db.get('SELECT validUntil FROM companies WHERE id = ?', [targetCompanyId], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      
      let currentValidUntil = new Date();
      if (row && row.validUntil && new Date(row.validUntil) > currentValidUntil) {
        currentValidUntil = new Date(row.validUntil);
      }
      
      // Add 'months' months
      currentValidUntil.setMonth(currentValidUntil.getMonth() + parseInt(months, 10));
      const newValidUntil = currentValidUntil.toISOString().split('T')[0];

      db.run('UPDATE companies SET validUntil = ?, status = "active" WHERE id = ?', [newValidUntil, targetCompanyId], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ message: 'Pago registrado exitosamente', newValidUntil });
      });
    });
  });
  stmt.finalize();
});

app.put('/api/saas/companies/:id/status', requireSuperAdmin, (req, res) => {
  const targetCompanyId = req.params.id;
  const { status } = req.body; // 'active' or 'suspended'
  
  if (status !== 'active' && status !== 'suspended') {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  db.run('UPDATE companies SET status = ? WHERE id = ?', [status, targetCompanyId], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Estado actualizado correctamente' });
  });
});

app.put('/api/saas/companies/:id/plan', requireSuperAdmin, (req, res) => {
  const targetCompanyId = req.params.id;
  const { plan } = req.body;
  if (!plan) return res.status(400).json({ error: 'Falta el plan' });

  // Update company plan
  db.run('UPDATE companies SET plan = ? WHERE id = ?', [plan, targetCompanyId], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Plan actualizado correctamente' });
  });
});

app.delete('/api/saas/companies/:id', requireSuperAdmin, (req, res) => {
  const targetCompanyId = req.params.id;
  if (targetCompanyId === 'comp_default') {
    return res.status(400).json({ error: 'No se puede eliminar la empresa principal' });
  }

  // Delete everything related to this company
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    db.run('DELETE FROM settings WHERE companyId = ?', [targetCompanyId]);
    db.run('DELETE FROM payments WHERE companyId = ?', [targetCompanyId]);
    db.run('DELETE FROM instalments WHERE companyId = ?', [targetCompanyId]);
    db.run('DELETE FROM loans WHERE companyId = ?', [targetCompanyId]);
    db.run('DELETE FROM clients WHERE companyId = ?', [targetCompanyId]);
    db.run('DELETE FROM users WHERE companyId = ?', [targetCompanyId]);
    db.run('DELETE FROM saas_payments WHERE companyId = ?', [targetCompanyId]);
    db.run('DELETE FROM companies WHERE id = ?', [targetCompanyId], function(err) {
      if (err) {
        db.run('ROLLBACK');
        return res.status(500).json({ error: err.message });
      }
      db.run('COMMIT');
      res.json({ message: 'Empresa eliminada por completo' });
    });
  });
});

// SaaS Plans CRUD
app.get('/api/saas/plans', requireSuperAdmin, (req, res) => {
  db.all('SELECT * FROM saas_plans ORDER BY price ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/saas/plans', requireSuperAdmin, (req, res) => {
  const { id, name, price, max_users, max_loans } = req.body;
  db.run('INSERT INTO saas_plans (id, name, price, max_users, max_loans) VALUES (?, ?, ?, ?, ?)', 
    [id, name, price, max_users, max_loans], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Plan creado', id });
  });
});

app.put('/api/saas/plans/:id', requireSuperAdmin, (req, res) => {
  const { name, price, max_users, max_loans } = req.body;
  db.run('UPDATE saas_plans SET name = ?, price = ?, max_users = ?, max_loans = ? WHERE id = ?', 
    [name, price, max_users, max_loans, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Plan actualizado' });
  });
});

app.delete('/api/saas/plans/:id', requireSuperAdmin, (req, res) => {
  db.run('DELETE FROM saas_plans WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Plan eliminado' });
  });
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
