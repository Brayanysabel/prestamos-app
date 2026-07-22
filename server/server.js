// server/server.js
const express = require('express');
const cors = require('cors');

const path = require('path');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');

const app = express();

// LiveReload para entorno de desarrollo local
if (process.env.NODE_ENV !== 'production') {
  try {
    const livereload = require('livereload');
    const connectLiveReload = require('connect-livereload');
    const liveReloadServer = livereload.createServer();
    liveReloadServer.watch(path.resolve(__dirname, 'www'));
    
    // Middleware para inyectar el script de livereload en el HTML
    app.use(connectLiveReload());
    
    liveReloadServer.server.once("connection", () => {
      setTimeout(() => {
        liveReloadServer.refresh("/");
      }, 100);
    });
  } catch (e) {
    console.log("LiveReload no disponible (modo producción o dependencias omitidas).");
  }
}
dotenv.config({ path: path.resolve(__dirname, '../.env') });  // OK if file missing
const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

// Security Middlewares
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://unpkg.com", "http://localhost:*"],
      connectSrc: ["'self'", "https://unpkg.com", "ws://localhost:*", "http://localhost:*"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "https:", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'", "https:", "data:"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
    }
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false
})); // Cabeceras de seguridad con CSP personalizado
app.use(cookieParser());
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
// Serve static files from the www directory with caching for performance
app.use(express.static(path.resolve(__dirname, './www'), {
  maxAge: 0,
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Ruta especial para limpiar la caché del navegador del usuario
app.get('/reset', (req, res) => {
  res.send(`
    <html>
      <head><title>Limpiando Caché...</title></head>
      <body style="font-family: sans-serif; text-align: center; margin-top: 50px; background: #09090e; color: white;">
        <h2>Borrando caché antigua...</h2>
        <script>
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(registrations) {
              for(let registration of registrations) {
                registration.unregister();
              }
            });
            caches.keys().then((keyList) => {
              return Promise.all(keyList.map((key) => {
                return caches.delete(key);
              }));
            });
          }
          setTimeout(() => {
            window.location.href = "/";
          }, 1500);
        </script>
      </body>
    </html>
  `);
});

const JWT_SECRET = process.env.JWT_SECRET || 'prestamos_super_secret_key_123!';

// Token auth middleware
const authenticateToken = (req, res, next) => {
  const publicRoutes = ['/login', '/signup', '/forgot-password', '/reset-password', '/logout', '/health', '/saas/public-plans'];
  // Permitir activación de plan sin JWT (ruta empieza con /activate)
  if (req.path.startsWith('/activate/')) return next();
  if (publicRoutes.includes(req.path) || req.method === 'OPTIONS') {
    return next();
  }

  const token = req.headers['x-auth-token'] || req.cookies?.auth_token;
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
};

app.use('/api', authenticateToken);

// Middleware: solo usuarios con role='admin' dentro de su empresa
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No autorizado' });
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado. Solo el administrador puede realizar esta acción.' });
  }
  next();
}

// Middleware: valida límites de préstamos y usuarios según el plan
async function requirePlanLimits(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No autorizado' });
  // El superadmin (comp_default) no tiene límites
  if (req.user.isSuperAdmin) return next();

  const planId = req.user.plan || 'basico';
  
  try {
    // Para SQLite via dbWrapper, usamos una promesa (o envolvemos get en promesa)
    const getPromise = (sql, params) => new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });
    
    const plan = await getPromise('SELECT * FROM saas_plans WHERE id = ?', [planId]);
    if (!plan) return next(); // Si el plan no existe, permitir o usar fallback
    
    req.planLimits = plan;
    next();
  } catch (err) {
    console.error('Error en requirePlanLimits:', err);
    res.status(500).json({ error: 'Error verificando límites del plan' });
  }
}


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

CREATE TABLE IF NOT EXISTS invitations (
  token TEXT PRIMARY KEY,
  companyId TEXT NOT NULL,
  email TEXT NOT NULL,
  createdAt DATETIME NOT NULL,
  expiresAt DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  companyId TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  kycStatus TEXT DEFAULT 'pending',
  idDocumentUrl TEXT,
  selfieUrl TEXT,
  createdAt TEXT
);

CREATE TABLE IF NOT EXISTS loans (
  id TEXT PRIMARY KEY,
  companyId TEXT NOT NULL,
  clientId TEXT NOT NULL,
  clientName TEXT NOT NULL,
  amount REAL NOT NULL,
  rate REAL NOT NULL,
  rateType TEXT NOT NULL DEFAULT 'annual',
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
  max_loans INTEGER NOT NULL,
  allow_documents BOOLEAN DEFAULT false,
  allow_guarantees BOOLEAN DEFAULT false,
  allow_debugger BOOLEAN DEFAULT false,
  allow_whatsapp BOOLEAN DEFAULT false,
  allow_finances BOOLEAN DEFAULT false,
  allow_denominations BOOLEAN DEFAULT false,
  allow_expenses BOOLEAN DEFAULT false,
  allow_banks BOOLEAN DEFAULT false,
  allow_cash BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS guarantees (
  id TEXT PRIMARY KEY,
  companyId TEXT NOT NULL,
  loanId TEXT NOT NULL,
  guarantorName TEXT NOT NULL,
  guarantorPhone TEXT,
  guarantorId TEXT,
  guarantorAddress TEXT,
  notes TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  companyId TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  date TEXT NOT NULL,
  notes TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id TEXT PRIMARY KEY,
  companyId TEXT NOT NULL,
  bankName TEXT NOT NULL,
  accountNumber TEXT,
  accountType TEXT DEFAULT 'corriente',
  balance REAL NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id TEXT PRIMARY KEY,
  companyId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT,
  date TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (accountId) REFERENCES bank_accounts(id)
);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id TEXT PRIMARY KEY,
  companyId TEXT NOT NULL,
  openedAt TEXT NOT NULL,
  closedAt TEXT,
  openingBalance REAL NOT NULL DEFAULT 0,
  closingBalance REAL,
  expectedBalance REAL,
  difference REAL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS denominations (
  id TEXT PRIMARY KEY,
  companyId TEXT NOT NULL,
  sessionDate TEXT NOT NULL,
  d2000 INTEGER DEFAULT 0,
  d1000 INTEGER DEFAULT 0,
  d500 INTEGER DEFAULT 0,
  d200 INTEGER DEFAULT 0,
  d100 INTEGER DEFAULT 0,
  d50 INTEGER DEFAULT 0,
  d25 INTEGER DEFAULT 0,
  d10 INTEGER DEFAULT 0,
  d5 INTEGER DEFAULT 0,
  d1 INTEGER DEFAULT 0,
  totalCash REAL NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);
`;


db.exec(initSql, async err => {
  console.log("Initializing DB schema...");
  if (err) console.error('Error initializing DB schema', err);
  else {
    console.log("DB schema initialized successfully.");
    // Inicializar planes por defecto si no existen
    db.get("SELECT COUNT(*) as count FROM saas_plans", (err, row) => {
      console.log("Checking saas_plans...");
      if (!err && row.count === 0) {
        const stmt = db.prepare("INSERT INTO saas_plans (id, name, price, max_users, max_loans, allow_documents, allow_guarantees, allow_debugger, allow_whatsapp, allow_finances, allow_denominations, allow_expenses, allow_banks, allow_cash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        stmt.run('principiante', 'Principiante', 900, 1, 100, false, false, false, false, false, false, false, false, false);
        stmt.run('basico', 'Básico', 1500, 2, 500, true, true, true, true, false, false, false, false, false);
        stmt.run('intermedio', 'Intermedio', 2000, 4, 1000, true, true, true, true, true, true, true, true, true);
        stmt.run('premium', 'Premium', 2500, 100, 999999, true, true, true, true, true, true, true, true, true);
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
              const stmt = db.prepare("INSERT INTO users (username, password, companyId, role) VALUES (?, ?, ?, ?)");
              stmt.run("admin", defaultHash, defaultCompanyId, 'admin');
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
            
            // Force admin user creation and password reset
            db.run("INSERT OR IGNORE INTO users (username, password, companyId, role) VALUES ('admin', ?, ?, 'admin')", [defaultHash, defaultCompanyId], () => {
              db.run("UPDATE users SET password = ?, role = 'admin', companyId = ? WHERE username = 'admin'", [defaultHash, defaultCompanyId]);
            });
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
            
            // Añadir columna role (admin / employee)
            db.run("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'admin'", () => {
              // El primer usuario (admin) ya tiene role=admin por DEFAULT
            });
            
            // Añadir columnas KYC
            db.run("ALTER TABLE clients ADD COLUMN kycStatus TEXT DEFAULT 'pending'", () => {});
            db.run("ALTER TABLE clients ADD COLUMN idDocumentUrl TEXT", () => {});
            db.run("ALTER TABLE clients ADD COLUMN selfieUrl TEXT", () => {});
            
            // Añadir rateType a loans
            db.run("ALTER TABLE loans ADD COLUMN rateType TEXT DEFAULT 'annual'", () => {});
            
            // Añadir validUntil a companies
            db.run("ALTER TABLE companies ADD COLUMN validUntil TEXT", () => {
              // Update existing companies to have 30 days valid from today
              const defaultValid = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
              db.run("UPDATE companies SET validUntil = ? WHERE validUntil IS NULL", [defaultValid]);
            });

            // Añadir columnas de activación de plan a companies
            db.run("ALTER TABLE companies ADD COLUMN activation_token TEXT", () => {});
            db.run("ALTER TABLE companies ADD COLUMN activation_expires TEXT", () => {});
            db.run("ALTER TABLE companies ADD COLUMN pending_plan TEXT", () => {});

            // Añadir columnas de características a saas_plans
            const planFeatures = [
              'allow_documents', 'allow_guarantees', 'allow_debugger', 'allow_whatsapp',
              'allow_finances', 'allow_denominations', 'allow_expenses', 'allow_banks', 'allow_cash'
            ];
            planFeatures.forEach(col => {
              db.run(`ALTER TABLE saas_plans ADD COLUMN ${col} BOOLEAN DEFAULT false`, () => {});
            });
            // Asegurar que los planes coincidan con la configuración actual (para bases de datos existentes)
            db.run("UPDATE saas_plans SET price=900, max_users=1, max_loans=100, allow_documents=false, allow_guarantees=false, allow_debugger=false, allow_whatsapp=false, allow_finances=false, allow_denominations=false, allow_expenses=false, allow_banks=false, allow_cash=false WHERE id='principiante'");
            db.run("UPDATE saas_plans SET price=1500, max_users=2, max_loans=500, allow_documents=true, allow_guarantees=true, allow_debugger=true, allow_whatsapp=true, allow_finances=false, allow_denominations=false, allow_expenses=false, allow_banks=false, allow_cash=false WHERE id='basico'");
            db.run("UPDATE saas_plans SET price=2000, max_users=4, max_loans=1000, allow_documents=true, allow_guarantees=true, allow_debugger=true, allow_whatsapp=true, allow_finances=true, allow_denominations=true, allow_expenses=true, allow_banks=true, allow_cash=true WHERE id='intermedio'");
            db.run("INSERT INTO saas_plans (id, name, price, max_users, max_loans, allow_documents, allow_guarantees, allow_debugger, allow_whatsapp, allow_finances, allow_denominations, allow_expenses, allow_banks, allow_cash) VALUES ('premium', 'Premium', 2500, 100, 999999, true, true, true, true, true, true, true, true, true) ON CONFLICT(id) DO UPDATE SET price=2500, max_users=100, max_loans=999999, allow_documents=true, allow_guarantees=true, allow_debugger=true, allow_whatsapp=true, allow_finances=true, allow_denominations=true, allow_expenses=true, allow_banks=true, allow_cash=true");

          }
        );

        // Migration: If any password does NOT start with '$2' (bcrypt signature), update it to 'admin' hashed
        db.run("UPDATE users SET password = ? WHERE password NOT LIKE ?", [defaultHash, '$2%'], function(err) {
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

// Health check endpoint (public, bypasses JWT verification thanks to publicRoutes array)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Activación de Planes por Link del Administrador ---
const crypto = require('crypto');

// Super Admin genera un link de activación para una empresa con un plan específico
app.post('/api/saas/companies/:id/generate-activation', requireSuperAdmin, (req, res) => {
  const targetCompanyId = req.params.id;
  const { planId } = req.body;
  if (!planId) return res.status(400).json({ error: 'Se requiere un planId' });

  db.get('SELECT * FROM saas_plans WHERE id = ?', [planId], (err, planRow) => {
    if (err || !planRow) return res.status(400).json({ error: 'Plan no encontrado' });

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    db.run(
      'UPDATE companies SET activation_token = ?, activation_expires = ?, pending_plan = ? WHERE id = ?',
      [token, expires, planId, targetCompanyId],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        const link = `${req.protocol}://${req.get('host')}/activate.html?token=${token}`;
        res.json({ 
          message: 'Link de activación generado exitosamente',
          link,
          plan: planRow.name,
          expiresIn: '48 horas'
        });
      }
    );
  });
});

// Endpoint público: Activar plan mediante token
app.get('/api/activate/:token', (req, res) => {
  const token = req.params.token;
  const now = new Date().toISOString();

  db.get(
    'SELECT id, pending_plan, name FROM companies WHERE activation_token = ? AND activation_expires > ?',
    [token, now],
    (err, company) => {
      if (err || !company) {
        return res.status(400).json({ error: 'Token de activación inválido o expirado' });
      }

      db.get('SELECT * FROM saas_plans WHERE id = ?', [company.pending_plan], (err, plan) => {
        if (err || !plan) {
          return res.status(400).json({ error: 'Plan pendiente no encontrado' });
        }

        const today = new Date();
        let base = new Date(today);
        db.get('SELECT validUntil FROM companies WHERE id = ?', [company.id], (err2, row) => {
          if (row && row.validUntil && new Date(row.validUntil) > base) {
            base = new Date(row.validUntil);
          }
          base.setMonth(base.getMonth() + 1);
          const newValidUntil = base.toISOString().split('T')[0];

          db.run(
            `UPDATE companies SET 
              plan = ?, max_loans = ?, max_users = ?, 
              status = 'active', validUntil = ?,
              activation_token = NULL, activation_expires = NULL, pending_plan = NULL 
            WHERE id = ?`,
            [plan.id, plan.max_loans, plan.max_users, newValidUntil, company.id],
            function(err3) {
              if (err3) return res.status(500).json({ error: err3.message });
              res.json({ 
                success: true,
                message: `Plan "${plan.name}" activado exitosamente`,
                plan: plan.name,
                validUntil: newValidUntil,
                companyName: company.name
              });
            }
          );
        });
      });
    }
  );
});

// Signup (Crear nueva empresa)
app.post('/api/signup', async (req, res) => {
  let { companyName, username, password, plan } = req.body;
  if (!companyName || !username || !password) return res.status(400).json({ error: 'Faltan datos requeridos' });
  
  username = username.trim();
  const companyId = 'comp_' + Math.random().toString(36).substring(2, 10);
  const hash = await bcrypt.hash(password, 10);

  // Obtener límites desde la tabla saas_plans (no hardcodeados)
  db.get('SELECT * FROM saas_plans WHERE id = ?', [plan || 'basico'], (err, planRow) => {
    if (err || !planRow) {
      // Fallback a valores por defecto si el plan no existe
      planRow = { id: 'basico', max_loans: 500, max_users: 2 };
    }
    const max_loans = planRow.max_loans;
    const max_users = planRow.max_users;
    const planId    = planRow.id;

    db.get('SELECT username FROM users WHERE username = ?', [username], (err, row) => {
      if (row) return res.status(400).json({ error: 'El usuario ya existe' });
      
      const validUntil = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const stmtC = db.prepare('INSERT INTO companies (id, name, plan, status, validUntil, max_loans, max_users, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      stmtC.run(companyId, companyName, planId, 'active', validUntil, max_loans, max_users, new Date().toISOString(), (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const stmtU = db.prepare('INSERT INTO users (username, password, companyId, role) VALUES (?, ?, ?, ?)');
        stmtU.run(username, hash, companyId, 'admin', (err) => {
           if (err) return res.status(500).json({ error: err.message });
           res.json({ message: 'Empresa registrada correctamente', companyId, plan: planId });
        });
        stmtU.finalize();
      });
      stmtC.finalize();
    });
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

app.put('/api/settings', requireAdmin, (req, res) => {
  // Verificar contraseña de eliminación definida en la variable de entorno
  const DELETE_CLIENT_PASSWORD = process.env.DELETE_CLIENT_PASSWORD || 'admin-delete-pass';
  if (req.body.password !== DELETE_CLIENT_PASSWORD) {
    return res.status(403).json({ error: 'Contraseña de eliminación incorrecta' });
  }
  // Continuar con el borrado en cascada
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
    const isSuperAdmin = row.companyId === 'comp_default';
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
    
    // Si la contraseña almacenada es un hash (empieza con $2)
    let match = false;
    if (row.password.startsWith('$2')) {
      match = await bcrypt.compare(password, row.password);
    } else {
      // Legacy check para contraseñas antiguas que aún no han sido migradas
      match = (password === row.password);
    }
    if (!match) {
      console.log(`[LOGIN FAILED] Password mismatch`);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    console.log(`[LOGIN SUCCESS] User: ${username}`);
    // Determinar rol en el JWT:
    // - superAdmin (comp_default) → siempre 'admin'
    // - Usuario con role explícito en DB → usar ese role
    // - Usuario con role null (migración) → 'employee' (por seguridad)
    let userRole;
    if (isSuperAdmin) {
      userRole = 'admin';
    } else if (row.role) {
      userRole = row.role;
    } else {
      // Usuarios legacy sin role: asignar 'admin' solo si es el primer/único usuario de la empresa
      // Para todos los demás, employee (más seguro)
      userRole = 'employee';
      // Actualizar en la DB para que el próximo login sea consistente
      db.run("UPDATE users SET role = 'employee' WHERE username = ? AND role IS NULL", [row.username]);
    }
    // Generate JWT token
    const token = jwt.sign({ username: row.username, companyId: row.companyId, plan: row.plan, isSuperAdmin, role: userRole }, JWT_SECRET, { expiresIn: '24h' });
    // Set HttpOnly cookie for authentication
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict'
    });
    
    // Buscar los detalles del plan para devolver los accesos (features)
    const planId = row.plan || 'basico';
    db.get("SELECT * FROM saas_plans WHERE id = ?", [planId], (err, planData) => {
      let planFeatures = {};
      if (!err && planData) {
        planFeatures = {
          allow_documents: !!planData.allow_documents,
          allow_guarantees: !!planData.allow_guarantees,
          allow_debugger: !!planData.allow_debugger,
          allow_whatsapp: !!planData.allow_whatsapp,
          allow_finances: !!planData.allow_finances,
          allow_denominations: !!planData.allow_denominations,
          allow_expenses: !!planData.allow_expenses,
          allow_banks: !!planData.allow_banks,
          allow_cash: !!planData.allow_cash,
          max_loans: planData.max_loans,
          max_users: planData.max_users
        };
      }
      res.json({ username, isSuperAdmin, role: userRole, token, planFeatures });
    });
  });
});

// Logout - Clear auth cookie
app.post('/api/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ message: 'Sesión cerrada correctamente' });
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
app.post('/api/backup/email', requireAdmin, (req, res) => {
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

// Enviar notificación general por correo
app.post('/api/notify', authenticateToken, async (req, res) => {
  const { toEmail, subject, text, html, smtpUser, smtpPass } = req.body;
  if (!smtpUser || !smtpPass) return res.status(400).json({ error: 'Faltan credenciales SMTP.' });
  if (!toEmail) return res.status(400).json({ error: 'Falta correo destino.' });
  
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: smtpUser, pass: smtpPass }
    });
    
    await transporter.sendMail({
      from: smtpUser,
      to: toEmail,
      subject: subject,
      text: text,
      html: html
    });
    
    res.json({ success: true, message: 'Correo enviado correctamente' });
  } catch (err) {
    console.error('Error enviando correo:', err);
    res.status(500).json({ error: 'Error enviando correo: ' + err.message });
  }
});

// Users Management
app.get('/api/users', (req, res) => {
  db.all('SELECT username, companyId, role FROM users WHERE companyId = ?', [req.user.companyId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/users', requireAdmin, requirePlanLimits, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username y password requeridos' });
  
  if (req.planLimits) {
    try {
      const getPromise = (sql, params) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
      });
      const result = await getPromise('SELECT COUNT(*) as count FROM users WHERE companyId = ?', [req.user.companyId]);
      if (result.count >= req.planLimits.max_users) {
        return res.status(400).json({ error: `Límite de usuarios (${req.planLimits.max_users}) alcanzado. Por favor, mejore su plan.` });
      }
    } catch (e) {
      console.error('Error checking users limit', e);
      return res.status(500).json({ error: 'Error verificando límites' });
    }
  }

  
  try {
    const hash = await bcrypt.hash(password, 10);
    // Los usuarios creados por el admin tienen rol 'employee'
    db.run('INSERT INTO users (username, password, companyId, role) VALUES (?, ?, ?, ?)',
      [username, hash, req.user.companyId, 'employee'],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed') || err.code === '23505') {
            return res.status(400).json({ error: 'El usuario ya existe' });
          }
          return res.status(500).json({ error: err.message });
        }
        res.json({ message: 'Usuario creado exitosamente', username });
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar usuario (solo admin, no puede eliminarse a sí mismo)
app.delete('/api/users/:username', requireAdmin, (req, res) => {
  const targetUsername = req.params.username;
  const currentUsername = req.user.username;

  if (targetUsername === currentUsername) {
    return res.status(400).json({ error: 'No puedes eliminarte a ti mismo.' });
  }

  db.run(
    'DELETE FROM users WHERE username = ? AND companyId = ?',
    [targetUsername, req.user.companyId],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Usuario no encontrado en tu empresa.' });
      res.json({ message: `Usuario "${targetUsername}" eliminado correctamente.` });
    }
  );
});

// ==========================================
// INVITACIONES DE USUARIOS POR EMAIL
// ==========================================

// 1. Crear invitación y enviar email
app.post('/api/users/invite', requireAdmin, requirePlanLimits, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Se requiere un email válido' });

  if (req.planLimits) {
    try {
      const getPromise = (sql, params) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
      });
      const result = await getPromise('SELECT COUNT(*) as count FROM users WHERE companyId = ?', [req.user.companyId]);
      if (result.count >= req.planLimits.max_users) {
        return res.status(400).json({ error: `Límite de usuarios (${req.planLimits.max_users}) alcanzado. Mejore su plan.` });
      }
    } catch (e) {
      return res.status(500).json({ error: 'Error verificando límites' });
    }
  }

  // Comprobar si el email ya existe como usuario
  db.get('SELECT username FROM users WHERE username = ?', [email], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (row) return res.status(400).json({ error: 'Ya existe un usuario con ese email' });

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48 horas
    
    db.run(
      'INSERT INTO invitations (token, companyId, email, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)',
      [token, req.user.companyId, email, new Date().toISOString(), expires],
      (err) => {
        if (err) return res.status(500).json({ error: 'Error al generar la invitación' });

        const inviteLink = `${req.protocol}://${req.get('host')}/invite.html?token=${token}`;
        
        // Simular o Enviar email real
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.EMAIL_USER || 'no-reply@prestamosapp.com',
            pass: process.env.EMAIL_PASS || 'tucontraseña'
          }
        });

        const mailOptions = {
          from: process.env.EMAIL_USER || 'no-reply@prestamosapp.com',
          to: email,
          subject: 'Invitación para unirte a PrestamosApp',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
              <div style="background-color: #2563eb; color: white; padding: 20px; text-align: center;">
                <h2>¡Has sido invitado a PrestamosApp!</h2>
              </div>
              <div style="padding: 20px;">
                <p>Hola,</p>
                <p>El administrador de la empresa te ha invitado a formar parte del sistema de gestión de préstamos.</p>
                <p>Por favor, haz clic en el siguiente botón para aceptar la invitación y crear tu contraseña:</p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${inviteLink}" style="background-color: #2563eb; color: white; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold; display: inline-block;">Aceptar Invitación</a>
                </div>
                <p style="font-size: 12px; color: #666; margin-top: 30px; text-align: center;">Este enlace expira en 48 horas.</p>
              </div>
            </div>
          `
        };

        if (process.env.EMAIL_USER) {
          transporter.sendMail(mailOptions, (error, info) => {
            if (error) console.error("Error enviando email: ", error);
            res.json({ message: 'Invitación enviada al correo.', link: inviteLink }); // Se devuelve el link para tests locales
          });
        } else {
          // Entorno local sin credenciales
          res.json({ message: 'Invitación generada (Modo desarrollo). Copia este link para probar.', link: inviteLink });
        }
      }
    );
  });
});

// 2. Aceptar Invitación (Establecer contraseña y crear usuario real)
app.post('/api/users/accept-invite', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token y contraseña son requeridos' });

  db.get('SELECT * FROM invitations WHERE token = ?', [token], async (err, invite) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!invite) return res.status(400).json({ error: 'Invitación inválida o no encontrada' });
    if (new Date() > new Date(invite.expiresAt)) return res.status(400).json({ error: 'La invitación ha expirado' });

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        // Crear usuario usando el email como username
        db.run('INSERT INTO users (username, password, companyId) VALUES (?, ?, ?)', [invite.email, hashedPassword, invite.companyId]);
        
        // Eliminar la invitación
        db.run('DELETE FROM invitations WHERE token = ?', [token]);
        
        db.run('COMMIT', (err) => {
          if (err) return res.status(500).json({ error: 'Error finalizando el registro' });
          res.json({ message: 'Cuenta creada exitosamente. Ya puedes iniciar sesión.', username: invite.email });
        });
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

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
  const stmt = db.prepare('INSERT INTO clients (id, companyId, name, phone, email, notes, createdAt, kycStatus) VALUES (?,?,?,?,?,?,?,?)');
  stmt.run(id, req.user.companyId, name, phone, email, notes, createdAt, 'pending', function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id, name, phone, email, notes, createdAt, kycStatus: 'pending' });
  });
  stmt.finalize();
});

// Importación Masiva de Clientes
app.post('/api/clients/bulk', (req, res) => {
  const clients = req.body.clients;
  if (!Array.isArray(clients)) return res.status(400).json({ error: 'Se esperaba un array de clientes' });

  const createdAt = new Date().toISOString();
  let count = 0;
  
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    const stmt = db.prepare('INSERT INTO clients (id, companyId, name, phone, email, notes, createdAt, kycStatus) VALUES (?,?,?,?,?,?,?,?)');
    
    clients.forEach(c => {
      const id = generateId('cli');
      const name = c.name || 'Sin Nombre';
      const phone = c.phone || '';
      const email = c.email || '';
      const notes = c.notes || 'Importado vía CSV';
      stmt.run(id, req.user.companyId, name, phone, email, notes, createdAt, 'pending');
      count++;
    });
    
    stmt.finalize();
    db.run("COMMIT", err => {
      if (err) return res.status(500).json({ error: 'Error importando clientes: ' + err.message });
      res.json({ message: `Se importaron ${count} clientes exitosamente.` });
    });
  });
});

// Actualizar KYC de un cliente (Simulación)
app.post('/api/clients/:id/kyc', (req, res) => {
  const { idDocumentUrl, selfieUrl } = req.body;
  const kycStatus = 'verified'; // Simulación de aprobación biométrica inmediata
  db.run('UPDATE clients SET idDocumentUrl = ?, selfieUrl = ?, kycStatus = ? WHERE id = ? AND companyId = ?', 
    [idDocumentUrl, selfieUrl, kycStatus, req.params.id, req.user.companyId], 
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Identidad verificada exitosamente (KYC Aprobado)', kycStatus });
  });
});

// Borrar Cliente Seguro
app.delete('/api/clients/:id', requireAdmin, (req, res) => {
  const password = req.body.password;
  const clientId = req.params.id;

  if (!password) return res.status(400).json({ error: 'Se requiere contraseña para borrar' });


  db.get("SELECT * FROM users WHERE username = ?", [req.user.username], async (err, row) => {
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
      instalments: (() => { try { return typeof r.instalments_json === 'string' ? JSON.parse(r.instalments_json) : (r.instalments_json || []); } catch (e) { return []; } })()
    }));
    res.json(loans);
  });
});

app.post('/api/loans', requirePlanLimits, (req, res) => {
  const loan = req.body; // expect full loan object
  const companyId = req.user.companyId;

  const maxLoans = req.planLimits ? req.planLimits.max_loans : 500; // fallback if no plan limits

  db.get('SELECT COUNT(*) as count FROM loans WHERE companyId = ?', [companyId], (err, countRow) => {
    if (err) return res.status(500).json({ error: err.message });
    
    if (countRow.count >= maxLoans) {
      return res.status(403).json({ error: 'Has alcanzado el límite de préstamos (' + maxLoans + ') de tu plan actual. Por favor, mejora tu plan.' });
    }

      const stmt = db.prepare(`INSERT INTO loans (id, companyId, clientId, clientName, amount, rate, rateType, term, frequency, type, startDate, totalPayable, interestAmount, status, remainingBalance) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      stmt.run(
        loan.id,
        companyId,
        loan.clientId,
        loan.clientName,
        loan.amount,
        loan.rate,
        loan.rateType || 'annual',
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

// Borrar Préstamo Seguro
app.delete('/api/loans/:id', requireAdmin, (req, res) => {
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
    db.run('UPDATE instalments SET paid = paid + ?, status = CASE WHEN (paid + ?) >= CAST(amount AS REAL) THEN \'paid\' ELSE status END WHERE loanId = ? AND idx = ?', [amount, amount, loanId, instalmentIdx], function (err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      // Recalculate remaining balance for loan
      db.get('SELECT SUM(amount - paid) AS remain FROM instalments WHERE loanId = ?', [loanId], (err3, row) => {
        if (err3) return res.status(500).json({ error: err3.message });
        const remaining = row.remain || 0;
        const newStatus = remaining === 0 ? 'paid' : 'active';
        db.run('UPDATE loans SET remainingBalance = ?, status = ? WHERE id = ?', [remaining, newStatus, loanId]);
        res.json({ message: 'Pago registrado exitosamente' });
      });
    });
  });
});

// Checkout Pasarela Digital Simulada
app.post('/api/payments/checkout', (req, res) => {
  const { loanId, instalmentIdx, amount, cardData } = req.body;
  const cardNumber = (req.body.cardNumber) || (cardData && cardData.number) || '';
  const cvv = (req.body.cvv) || (cardData && cardData.cvv) || '';
  if (!cardNumber || !cvv || String(cardNumber).replace(/\s/g,'').length < 15) {
    return res.status(400).json({ error: 'Tarjeta declinada o inválida' });
  }

  const paymentId = generateId('pay_card');
  const companyId = req.user.companyId;
  const date = new Date().toISOString().split('T')[0]; // Current local date simple

  const stmt = db.prepare('INSERT INTO payments (id, companyId, loanId, instalmentIdx, amount, date) VALUES (?,?,?,?,?,?)');
  stmt.run(paymentId, companyId, loanId, instalmentIdx, amount, date, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    // Update instalment paid
    db.run('UPDATE instalments SET paid = paid + ?, status = CASE WHEN (paid + ?) >= CAST(amount AS REAL) THEN \'paid\' ELSE status END WHERE loanId = ? AND idx = ?', [amount, amount, loanId, instalmentIdx], function (err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      // Recalculate remaining
      db.get('SELECT SUM(amount - paid) AS remain FROM instalments WHERE loanId = ?', [loanId], (err3, row) => {
        if (err3) return res.status(500).json({ error: err3.message });
        const remaining = row.remain || 0;
        const newStatus = remaining === 0 ? 'paid' : 'active';
        db.run('UPDATE loans SET remainingBalance = ?, status = ? WHERE id = ?', [remaining, newStatus, loanId]);
        res.json({ message: 'Pago electrónico (Tarjeta) exitoso', paymentId });
      });
    });
  });
});
// --- SaaS Super Admin Endpoints ---
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.companyId !== 'comp_default') {
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
  const { status, months } = req.body;

  if (status !== 'active' && status !== 'suspended') {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  if (status === 'suspended') {
    db.run('UPDATE companies SET status = ? WHERE id = ?', ['suspended', targetCompanyId], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Empresa suspendida correctamente' });
    });
    return;
  }

  // Activar: calcular validUntil extendiendo desde hoy o desde validUntil vigente
  const numMonths = parseInt(months) || 1;
  db.get('SELECT validUntil FROM companies WHERE id = ?', [targetCompanyId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });

    const today = new Date();
    let base = new Date(today);
    if (row && row.validUntil) {
      const currentValid = new Date(row.validUntil);
      if (currentValid > today) base = currentValid; // extender desde la fecha vigente
    }
    base.setMonth(base.getMonth() + numMonths);
    const newValidUntil = base.toISOString().split('T')[0];

    db.run('UPDATE companies SET status = ?, validUntil = ? WHERE id = ?',
      ['active', newValidUntil, targetCompanyId],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Empresa activada correctamente', newValidUntil });
      }
    );
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

// Endpoints Públicos para Suscripciones
app.get('/api/saas/public-plans', (req, res) => {
  db.all('SELECT * FROM saas_plans ORDER BY price ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/my-company', (req, res) => {
  if (!req.user || !req.user.companyId) return res.status(401).json({ error: 'No autorizado' });
  
  // Obtener info de la compañía
  db.get('SELECT * FROM companies WHERE id = ?', [req.user.companyId], (err, comp) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!comp) return res.status(404).json({ error: 'Compañía no encontrada' });
    
    // Contar préstamos activos
    db.get('SELECT COUNT(*) as count FROM loans WHERE clientId IN (SELECT id FROM clients WHERE companyId = ?)', [req.user.companyId], (err, loanCountRow) => {
      if (err) return res.status(500).json({ error: err.message });
      
      // Contar clientes y otros si se desea
      comp.current_loans = loanCountRow.count;
      res.json(comp);
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
  const { 
    id, name, price, max_users, max_loans, 
    allow_documents, allow_guarantees, allow_debugger, allow_whatsapp, 
    allow_finances, allow_denominations, allow_expenses, allow_banks, allow_cash 
  } = req.body;
  
  db.run(`INSERT INTO saas_plans 
    (id, name, price, max_users, max_loans, allow_documents, allow_guarantees, allow_debugger, allow_whatsapp, allow_finances, allow_denominations, allow_expenses, allow_banks, allow_cash) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
    [
      id, name, price, max_users, max_loans,
      allow_documents||0, allow_guarantees||0, allow_debugger||0, allow_whatsapp||0,
      allow_finances||0, allow_denominations||0, allow_expenses||0, allow_banks||0, allow_cash||0
    ], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Plan creado', id });
  });
});

app.put('/api/saas/plans/:id', requireSuperAdmin, (req, res) => {
  const { 
    name, price, max_users, max_loans,
    allow_documents, allow_guarantees, allow_debugger, allow_whatsapp, 
    allow_finances, allow_denominations, allow_expenses, allow_banks, allow_cash
  } = req.body;

  db.run(`UPDATE saas_plans SET 
    name = ?, price = ?, max_users = ?, max_loans = ?,
    allow_documents = ?, allow_guarantees = ?, allow_debugger = ?, allow_whatsapp = ?,
    allow_finances = ?, allow_denominations = ?, allow_expenses = ?, allow_banks = ?, allow_cash = ?
    WHERE id = ?`, 
    [
      name, price, max_users, max_loans,
      allow_documents||0, allow_guarantees||0, allow_debugger||0, allow_whatsapp||0,
      allow_finances||0, allow_denominations||0, allow_expenses||0, allow_banks||0, allow_cash||0,
      req.params.id
    ], function(err) {
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

// Descargar Base de Datos (solo disponible en entorno de desarrollo)
app.get('/api/backup/download', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'No disponible en producción' });
  }
  const username = req.user?.username;
  if (!username) return res.status(401).json({ error: 'No autorizado' });
  const dataDir = path.join(__dirname, '..', 'data');
  const dbPath = path.join(dataDir, 'prestamos.db');
  res.download(dbPath, `respaldo_prestamos_${new Date().toISOString().split('T')[0]}.db`);
});

// ============================================================
// GARANTÍAS
// ============================================================
app.get('/api/guarantees', (req, res) => {
  const { loanId } = req.query;
  const sql = loanId
    ? 'SELECT * FROM guarantees WHERE companyId = ? AND loanId = ? ORDER BY createdAt DESC'
    : 'SELECT * FROM guarantees WHERE companyId = ? ORDER BY createdAt DESC';
  const params = loanId ? [req.user.companyId, loanId] : [req.user.companyId];
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/guarantees', (req, res) => {
  const { loanId, guarantorName, guarantorPhone, guarantorId, guarantorAddress, notes } = req.body;
  if (!loanId || !guarantorName) return res.status(400).json({ error: 'loanId y guarantorName son requeridos' });
  const id = 'guar_' + Date.now() + Math.random().toString(36).slice(2, 6);
  db.run(
    'INSERT INTO guarantees (id, companyId, loanId, guarantorName, guarantorPhone, guarantorId, guarantorAddress, notes, createdAt) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, req.user.companyId, loanId, guarantorName, guarantorPhone||'', guarantorId||'', guarantorAddress||'', notes||'', new Date().toISOString()],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Garantía registrada', id });
    }
  );
});

app.delete('/api/guarantees/:id', requireAdmin, (req, res) => {
  db.run('DELETE FROM guarantees WHERE id = ? AND companyId = ?', [req.params.id, req.user.companyId], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Garantía eliminada' });
  });
});

// ============================================================
// GASTOS
// ============================================================
app.get('/api/expenses', (req, res) => {
  db.all('SELECT * FROM expenses WHERE companyId = ? ORDER BY date DESC', [req.user.companyId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/expenses', requireAdmin, (req, res) => {
  const { description, amount, category, date, notes } = req.body;
  if (!description || !amount || !date) return res.status(400).json({ error: 'description, amount y date son requeridos' });
  const id = 'exp_' + Date.now() + Math.random().toString(36).slice(2, 6);
  db.run(
    'INSERT INTO expenses (id, companyId, description, amount, category, date, notes, createdAt) VALUES (?,?,?,?,?,?,?,?)',
    [id, req.user.companyId, description, parseFloat(amount), category||'general', date, notes||'', new Date().toISOString()],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Gasto registrado', id });
    }
  );
});

app.delete('/api/expenses/:id', requireAdmin, (req, res) => {
  db.run('DELETE FROM expenses WHERE id = ? AND companyId = ?', [req.params.id, req.user.companyId], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Gasto eliminado' });
  });
});

// ============================================================
// BANCOS
// ============================================================
app.get('/api/banks', (req, res) => {
  db.all('SELECT * FROM bank_accounts WHERE companyId = ? ORDER BY bankName', [req.user.companyId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/banks', requireAdmin, (req, res) => {
  const { bankName, accountNumber, accountType, balance } = req.body;
  if (!bankName) return res.status(400).json({ error: 'bankName es requerido' });
  const id = 'bank_' + Date.now() + Math.random().toString(36).slice(2, 6);
  db.run(
    'INSERT INTO bank_accounts (id, companyId, bankName, accountNumber, accountType, balance, createdAt) VALUES (?,?,?,?,?,?,?)',
    [id, req.user.companyId, bankName, accountNumber||'', accountType||'corriente', parseFloat(balance||0), new Date().toISOString()],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Cuenta bancaria creada', id });
    }
  );
});

app.put('/api/banks/:id', requireAdmin, (req, res) => {
  const { bankName, accountNumber, accountType, balance } = req.body;
  db.run(
    'UPDATE bank_accounts SET bankName=?, accountNumber=?, accountType=?, balance=? WHERE id=? AND companyId=?',
    [bankName, accountNumber, accountType, parseFloat(balance||0), req.params.id, req.user.companyId],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Cuenta actualizada' });
    }
  );
});

app.delete('/api/banks/:id', requireAdmin, (req, res) => {
  db.run('DELETE FROM bank_accounts WHERE id=? AND companyId=?', [req.params.id, req.user.companyId], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Cuenta eliminada' });
  });
});

app.get('/api/bank-transactions', (req, res) => {
  const { accountId } = req.query;
  const sql = accountId
    ? 'SELECT * FROM bank_transactions WHERE companyId=? AND accountId=? ORDER BY date DESC LIMIT 100'
    : 'SELECT * FROM bank_transactions WHERE companyId=? ORDER BY date DESC LIMIT 100';
  const params = accountId ? [req.user.companyId, accountId] : [req.user.companyId];
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/bank-transactions', requireAdmin, (req, res) => {
  const { accountId, type, amount, description, date } = req.body;
  if (!accountId || !type || !amount) return res.status(400).json({ error: 'accountId, type y amount son requeridos' });
  const id = 'btx_' + Date.now() + Math.random().toString(36).slice(2, 6);
  const amt = parseFloat(amount);
  const balanceDelta = (type === 'deposito' || type === 'ingreso') ? amt : -amt;
  db.run(
    'INSERT INTO bank_transactions (id, companyId, accountId, type, amount, description, date, createdAt) VALUES (?,?,?,?,?,?,?,?)',
    [id, req.user.companyId, accountId, type, amt, description||'', date||new Date().toISOString().split('T')[0], new Date().toISOString()],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      db.run('UPDATE bank_accounts SET balance = balance + ? WHERE id=? AND companyId=?', [balanceDelta, accountId, req.user.companyId]);
      res.json({ message: 'Movimiento registrado', id });
    }
  );
});

// ============================================================
// CAJA
// ============================================================
app.get('/api/cash/current', (req, res) => {
  db.get("SELECT * FROM cash_sessions WHERE companyId=? AND status='open' ORDER BY openedAt DESC LIMIT 1", [req.user.companyId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || null);
  });
});

app.post('/api/cash/open', requireAdmin, (req, res) => {
  const { openingBalance } = req.body;
  db.get("SELECT id FROM cash_sessions WHERE companyId=? AND status='open'", [req.user.companyId], (err, existing) => {
    if (existing) return res.status(400).json({ error: 'Ya existe una caja abierta. Ciérrela antes de abrir una nueva.' });
    const id = 'cash_' + Date.now();
    db.run(
      'INSERT INTO cash_sessions (id, companyId, openedAt, openingBalance, status) VALUES (?,?,?,?,?)',
      [id, req.user.companyId, new Date().toISOString(), parseFloat(openingBalance||0), 'open'],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Caja abierta', id });
      }
    );
  });
});

app.put('/api/cash/close', requireAdmin, (req, res) => {
  const { closingBalance, notes } = req.body;
  db.get("SELECT * FROM cash_sessions WHERE companyId=? AND status='open' ORDER BY openedAt DESC LIMIT 1", [req.user.companyId], (err, session) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!session) return res.status(404).json({ error: 'No hay caja abierta' });
    db.get(
      "SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE companyId=? AND date >= ?",
      [req.user.companyId, session.openedAt.split('T')[0]],
      (err, payRow) => {
        const expected = parseFloat(session.openingBalance) + (payRow?.total || 0);
        const closing = parseFloat(closingBalance || 0);
        const difference = closing - expected;
        db.run(
          "UPDATE cash_sessions SET status='closed', closedAt=?, closingBalance=?, expectedBalance=?, difference=?, notes=? WHERE id=?",
          [new Date().toISOString(), closing, expected, difference, notes||'', session.id],
          function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Caja cerrada', expected, difference });
          }
        );
      }
    );
  });
});

app.get('/api/cash/history', (req, res) => {
  db.all('SELECT * FROM cash_sessions WHERE companyId=? ORDER BY openedAt DESC LIMIT 30', [req.user.companyId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// ============================================================
// DENOMINACIONES
// ============================================================
app.post('/api/denominations', requireAdmin, (req, res) => {
  const { d2000,d1000,d500,d200,d100,d50,d25,d10,d5,d1, sessionDate } = req.body;
  const id = 'den_' + Date.now();
  const total =
    (d2000||0)*2000+(d1000||0)*1000+(d500||0)*500+(d200||0)*200+
    (d100||0)*100+(d50||0)*50+(d25||0)*25+(d10||0)*10+(d5||0)*5+(d1||0)*1;
  db.run(
    'INSERT INTO denominations (id,companyId,sessionDate,d2000,d1000,d500,d200,d100,d50,d25,d10,d5,d1,totalCash,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id,req.user.companyId,sessionDate||new Date().toISOString().split('T')[0],
     d2000||0,d1000||0,d500||0,d200||0,d100||0,d50||0,d25||0,d10||0,d5||0,d1||0,total,new Date().toISOString()],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Cuadre guardado', id, total });
    }
  );
});

app.get('/api/denominations', (req, res) => {
  db.all('SELECT * FROM denominations WHERE companyId=? ORDER BY createdAt DESC LIMIT 20', [req.user.companyId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// ============================================================
// FINANZAS — Resumen
// ============================================================
app.get('/api/finances/summary', (req, res) => {
  const cId = req.user.companyId;
  const getP = (sql, params) => new Promise((resolve, reject) => db.get(sql, params, (e,r) => e ? reject(e) : resolve(r)));
  const allP = (sql, params) => new Promise((resolve, reject) => db.all(sql, params, (e,r) => e ? reject(e) : resolve(r)));
  Promise.all([
    getP('SELECT COALESCE(SUM(amount),0) as total FROM loans WHERE companyId=?', [cId]),
    getP('SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE companyId=?', [cId]),
    getP('SELECT COALESCE(SUM(interestAmount),0) as total FROM loans WHERE companyId=?', [cId]),
    getP('SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE companyId=?', [cId]),
    allP('SELECT category, COALESCE(SUM(amount),0) as total FROM expenses WHERE companyId=? GROUP BY category', [cId]),
    getP("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE companyId=? AND date >= date('now','start of month')", [cId]),
    getP("SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE companyId=? AND date >= date('now','start of month')", [cId]),
    allP("SELECT strftime('%Y-%m', date) as month, SUM(amount) as income FROM payments WHERE companyId=? AND date >= date('now', '-5 months', 'start of month') GROUP BY strftime('%Y-%m', date) ORDER BY month ASC", [cId]),
    allP("SELECT strftime('%Y-%m', date) as month, SUM(amount) as expense FROM expenses WHERE companyId=? AND date >= date('now', '-5 months', 'start of month') GROUP BY strftime('%Y-%m', date) ORDER BY month ASC", [cId])
  ]).then(([loansTotal, paymentsTotal, interestTotal, expensesTotal, expByCategory, monthPayments, monthExpenses, histIncome, histExpenses]) => {
    
    // Unificar histórico por mes
    const cashflowMap = {};
    const d = new Date();
    d.setDate(1); // Set to 1st to avoid overflow
    // Generar últimos 6 meses (incluyendo actual) para asegurar que haya datos
    for (let i = 5; i >= 0; i--) {
      const tempD = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const mStr = `${tempD.getFullYear()}-${String(tempD.getMonth() + 1).padStart(2, '0')}`;
      cashflowMap[mStr] = { month: mStr, income: 0, expense: 0 };
    }
    
    if (histIncome) histIncome.forEach(r => { if(cashflowMap[r.month]) cashflowMap[r.month].income = r.income; });
    if (histExpenses) histExpenses.forEach(r => { if(cashflowMap[r.month]) cashflowMap[r.month].expense = r.expense; });
    
    const cashflow = Object.values(cashflowMap);

    res.json({
      capitalLent: loansTotal.total,
      collected: paymentsTotal.total,
      totalInterest: interestTotal.total,
      totalExpenses: expensesTotal.total,
      netProfit: paymentsTotal.total - expensesTotal.total,
      monthlyProfit: monthPayments.total - monthExpenses.total,
      expensesByCategory: expByCategory || [],
      cashflow: cashflow
    });
  }).catch(err => res.status(500).json({ error: err.message }));
});

// ============================================================
// DEPURADOR DE BASE DE DATOS
// ============================================================
const ALLOWED_DEBUG_TABLES = [
  'clients', 'loans', 'instalments', 'payments',
  'expenses', 'guarantees', 'bank_accounts', 'bank_transactions',
  'cash_sessions', 'denominations'
];

app.get('/api/debugger/table/:table', requireAuth, (req, res) => {
  const table = req.params.table;
  if (!ALLOWED_DEBUG_TABLES.includes(table)) {
    return res.status(403).json({ error: 'Tabla no permitida.' });
  }
  const companyId = req.user.companyId;
  db.all(
    `SELECT * FROM ${table} WHERE companyId = ? ORDER BY rowid DESC LIMIT 500`,
    [companyId],
    (err, rows) => {
      if (err) {
        // Si la tabla no tiene companyId, devolver sin filtro (tablas de sesiones/denominaciones)
        db.all(`SELECT * FROM ${table} WHERE companyId = ? ORDER BY rowid DESC LIMIT 500`,
          [companyId], (e2, r2) => {
          if (e2) return res.status(500).json({ error: e2.message });
          res.json(r2 || []);
        });
        return;
      }
      res.json(rows || []);
    }
  );
});

app.post('/api/debugger/query', requireAuth, (req, res) => {
  const { sql } = req.body;
  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: 'Consulta SQL requerida.' });
  }
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT')) {
    return res.status(403).json({ error: 'Solo se permiten consultas SELECT por seguridad.' });
  }
  // Bloquear palabras peligrosas
  const blocked = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'TRUNCATE', 'CREATE', 'REPLACE', 'ATTACH'];
  for (const word of blocked) {
    if (trimmed.includes(word)) {
      return res.status(403).json({ error: `Operación '${word}' no permitida en el depurador.` });
    }
  }
  const companyId = req.user.companyId;
  // Añadir restricción de companyId si no está en la query
  let safeSql = sql;
  if (!trimmed.includes('WHERE') && !trimmed.includes('COMPANYID')) {
    // Intentar añadir filtro automático — solo si es una tabla conocida
    const match = sql.match(/FROM\s+(\w+)/i);
    if (match && ALLOWED_DEBUG_TABLES.includes(match[1].toLowerCase())) {
      safeSql = sql + ` WHERE companyId = '${companyId}'`;
    }
  }
  db.all(safeSql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// ============================================================
// FASE 4: CRON JOB - NOTIFICACIONES DE MORA
// ============================================================
const cron = require('node-cron');

function runOverdueCron() {
  console.log('Ejecutando revisión de mora...', new Date().toISOString());
  
  const query = `
    SELECT i.id as instalmentId, i.amount, i.dueDate, l.id as loanId, c.name, c.email
    FROM instalments i
    JOIN loans l ON i.loanId = l.id
    JOIN clients c ON l.clientId = c.id
    WHERE i.status != 'paid' AND date(i.dueDate) < date('now')
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) return console.error('Error en cron de mora:', err.message);
    if (!rows || rows.length === 0) return;
    
    // Configurar transporte genérico para todos
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER || 'no-reply@prestamosapp.com',
        pass: process.env.EMAIL_PASS || 'tucontraseña'
      }
    });

    rows.forEach(row => {
      if (!row.email) return; // Si el cliente no tiene email, no se envía
      
      const mailOptions = {
        from: process.env.EMAIL_USER || 'no-reply@prestamosapp.com',
        to: row.email,
        subject: 'Aviso de Cuota Vencida - PrestamosApp',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="color: #e3342f;">Aviso de Cuota Vencida</h2>
            <p>Hola <strong>${row.name}</strong>,</p>
            <p>Le recordamos que tiene una cuota vencida de su préstamo (ID: ${row.loanId}) por un monto de <strong>$${row.amount}</strong>.</p>
            <p>La fecha de vencimiento era el <strong>${row.dueDate}</strong>.</p>
            <p>Por favor, póngase al día con sus pagos para evitar recargos adicionales.</p>
            <br>
            <p>Atentamente,<br>El equipo de PrestamosApp</p>
          </div>
        `
      };

      if (process.env.EMAIL_USER) {
        transporter.sendMail(mailOptions, (error, info) => {
          if (error) console.error("Error enviando recordatorio a", row.email, error);
          else console.log("Recordatorio enviado a", row.email);
        });
      } else {
        console.log(`[Modo Dev] Se enviaría correo de mora a: ${row.email} por cuota de ${row.amount}`);
      }
    });
  });
}

// Programar para ejecutarse todos los días a las 08:00 AM
cron.schedule('0 8 * * *', () => {
  runOverdueCron();
});

// Endpoint manual para pruebas de la Fase 4
app.post('/api/cron/overdue', requireAdmin, (req, res) => {
  runOverdueCron();
  res.json({ message: 'Proceso de revisión de mora iniciado manualmente. Revisa los logs del servidor.' });
});
// ============================================================
// FASE 5: WHATSAPP API REAL
// ============================================================
let waClient = null;
let waQrCodeDataUrl = null;
let isWaReady = false;

try {
  const { Client, LocalAuth } = require('whatsapp-web.js');
  const qrcode = require('qrcode');

  waClient = new Client({
    authStrategy: new LocalAuth({ clientId: "prestamos-app-global" }),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  waClient.on('qr', async (qr) => {
    console.log('WhatsApp QR Code recibido. Escanear en la web.');
    waQrCodeDataUrl = await qrcode.toDataURL(qr);
  });

  waClient.on('ready', () => {
    console.log('Cliente de WhatsApp está listo!');
    isWaReady = true;
    waQrCodeDataUrl = null;
  });

  waClient.on('authenticated', () => {
    console.log('WhatsApp autenticado.');
  });

  waClient.on('disconnected', (reason) => {
    console.log('WhatsApp desconectado:', reason);
    isWaReady = false;
    waClient.initialize();
  });

  waClient.initialize();
} catch (e) {
  console.log('whatsapp-web.js no está instalado o falló al iniciar:', e.message);
}

// Endpoints de WhatsApp
app.get('/api/whatsapp/status', requireAuth, (req, res) => {
  res.json({
    ready: isWaReady,
    qrUrl: waQrCodeDataUrl
  });
});

app.post('/api/whatsapp/send', requireAuth, async (req, res) => {
  if (!isWaReady || !waClient) {
    return res.status(400).json({ error: 'WhatsApp no está conectado todavía.' });
  }
  
  const { phone, message } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: 'Teléfono y mensaje requeridos.' });
  }

  try {
    // Formatear el número (eliminar +, espacios, -, e incluir el sufijo de WA)
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const chatId = cleanPhone + '@c.us';
    
    await waClient.sendMessage(chatId, message);
    res.json({ message: 'Mensaje enviado exitosamente por WhatsApp.' });
  } catch (err) {
    res.status(500).json({ error: 'Error al enviar WhatsApp: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor iniciado en http://${HOST}:${PORT}`);
});

process.on('uncaughtException', err => { console.error('Uncaught Exception', err); });
process.on('unhandledRejection', err => { console.error('Unhandled Rejection', err); });
