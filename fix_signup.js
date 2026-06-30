const fs = require('fs');
let c = fs.readFileSync('server/server.js', 'utf8');

const signupCode = `
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
    
    const stmtC = db.prepare('INSERT INTO companies (id, name, plan, status, max_loans, max_users, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
    stmtC.run(companyId, companyName, plan, 'active', max_loans, max_users, new Date().toISOString(), (err) => {
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
`;

if (!c.includes('/api/signup')) {
  c = c.replace(/\/\/ ----- API Endpoints ----- \/\//, '// ----- API Endpoints ----- //\n' + signupCode);
}
fs.writeFileSync('server/server.js', c);
console.log("Signup added!");
