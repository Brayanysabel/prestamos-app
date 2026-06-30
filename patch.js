const fs = require('fs');
let c = fs.readFileSync('server/server.js', 'utf8');

c = c.replace(
`CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  companyId TEXT NOT NULL
);`,
`CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  companyId TEXT NOT NULL,
  resetToken TEXT,
  resetTokenExpires TEXT
);`
);

const recoveryEndpoints = `
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
        html: \`
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #2563eb; color: white; padding: 20px; text-align: center;">
              <h2 style="margin: 0;">Recuperación de Contraseña</h2>
            </div>
            <div style="padding: 20px;">
              <p>Hola <b>\${username}</b>,</p>
              <p>Has solicitado restablecer tu contraseña. Utiliza el siguiente código de recuperación en la aplicación:</p>
              <div style="text-align: center; margin: 30px 0;">
                <h2 style="background: #f3f4f6; padding: 15px 20px; display: inline-block; letter-spacing: 2px; border-radius: 4px; border: 1px dashed #2563eb;">\${resetToken.substring(0, 8).toUpperCase()}</h2>
              </div>
              <p>O simplemente cópialo. Este código expirará en 1 hora.</p>
              <p>Si no solicitaste esto, puedes ignorar este mensaje.</p>
            </div>
          </div>
        \`
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

// Cambiar usuario y contraseña`;

c = c.replace('// Cambiar usuario y contraseña', recoveryEndpoints);

fs.writeFileSync('server/server.js', c);
console.log('Patch applied successfully!');
