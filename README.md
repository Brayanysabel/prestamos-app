# Prestamos App - Cloud Deployment Guide

Este documento describe cómo desplegar el servidor backend de **Prestamos App** en la nube y cómo configurar la aplicación móvil para conectarse a él.

## 1. Despliegue del Servidor (Docker)

El backend de la aplicación utiliza una base de datos SQLite y Node.js. Hemos creado un `Dockerfile` en el directorio `server` para empaquetar el servidor.

### Construir y probar localmente con Docker:
1. Asegúrate de tener Docker instalado.
2. Abre una terminal en el directorio del proyecto y ejecuta:
   ```bash
   cd server
   docker build -t prestamos-backend .
   docker run -p 5050:5050 -e JWT_SECRET="tu_clave_secreta" prestamos-backend
   ```
3. El servidor estará disponible en `http://localhost:5050`.

### Despliegue en la nube:
Puedes desplegar la imagen en proveedores de contenedores como:
- **Render** (Servicio web con Docker)
- **Railway** (Despliegue automático de Dockerfile)
- **Fly.io** (`fly launch` en la carpeta `server`)
- **Google Cloud Run** (Recomendado para Google Cloud)

> [!IMPORTANT]
> Configura el puerto (`PORT=5050`) y la variable de entorno `JWT_SECRET` en tu panel de control de la nube.

---

## 2. Configurar la URL en la Aplicación

Una vez que tu servidor esté desplegado en la nube (por ejemplo, `https://mi-servidor-prestamos.up.railway.app`):
1. Inicia la aplicación en tu celular Android o en el navegador.
2. Ve a la pestaña **Configuración**.
3. En la sección **Conexión del Servidor**, introduce la URL completa de tu API.
4. Presiona **Probar Conexión** para verificar que responda correctamente.
5. Haz clic en **Guardar Servidor**. La aplicación se recargará automáticamente y se conectará al nuevo servidor en la nube.
