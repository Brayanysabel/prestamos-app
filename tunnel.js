const localtunnel = require('localtunnel');

(async () => {
  try {
    const tunnel = await localtunnel({ port: 8080, subdomain: 'prestamos-api-pro' });
    console.log('------------------------------------------------');
    console.log('✅ API EN LÍNEA PARA CUALQUIER RED!');
    console.log(`🌍 URL Pública: ${tunnel.url}/api`);
    console.log('------------------------------------------------');
    console.log('Mantén esta ventana abierta para que el celular pueda conectarse.');

    tunnel.on('close', () => {
      console.log('Túnel cerrado.');
    });
  } catch (err) {
    console.error('Error al iniciar el túnel:', err);
  }
})();
