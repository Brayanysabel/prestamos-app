const fs = require('fs');
let c = fs.readFileSync('app.js', 'utf8');
// Replace sessionStorage for auth tokens (but NOT for prestamos_theme or other non-auth items)
c = c.replace(/sessionStorage\.getItem\('prestamos_is_superadmin'\)/g, "authStorage.getItem('prestamos_is_superadmin')");
c = c.replace(/sessionStorage\.setItem\('prestamos_auth_token'/g, "authStorage.setItem('prestamos_auth_token'");
c = c.replace(/sessionStorage\.setItem\('prestamos_is_superadmin'/g, "authStorage.setItem('prestamos_is_superadmin'");
c = c.replace(/sessionStorage\.removeItem\('prestamos_auth_token'\)/g, "authStorage.removeItem('prestamos_auth_token')");
c = c.replace(/sessionStorage\.removeItem\('prestamos_is_superadmin'\)/g, "authStorage.removeItem('prestamos_is_superadmin')");
fs.writeFileSync('app.js', c, 'utf8');
const count = (c.match(/authStorage\./g) || []).length;
console.log('Done. authStorage usages:', count);
