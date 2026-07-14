# VentasApp - Sistema de Gestión de Ventas

Aplicación web moderna para gestionar ventas, productos, clientes, pagos y gastos en la nube.

## Características

- Dashboard con métricas en tiempo real
- Gestión de productos (stock, precios, categorías)
- Registro de ventas con detalle de productos
- Gestión de clientes
- Control de gastos
- Reportes: productos más vendidos, resumen mensual
- Sistema multi-tenant (SaaS)
- Autenticación JWT
- Despliegue en Railway

## Estructura del Proyecto

```
app de ventas/
├── server/
│   ├── server.js          # API Express
│   ├── dbWrapper.js       # Conexión PostgreSQL
│   ├── server_test.js     # Servidor de prueba
│   ├── Dockerfile
│   └── .dockerignore
├── www/
│   ├── index.html         # Frontend SPA
│   ├── app.js             # Lógica frontend
│   ├── style.css          # Estilos
│   ├── sw.js              # Service Worker
│   └── manifest.json      # PWA manifest
├── package.json
├── .env                   # Variables de entorno
└── railway.toml           # Config Railway
```

## Instalación Local

```bash
npm install
npm start
```

Abrir http://localhost:8080

## Credenciales por Defecto

- Usuario: `admin`
- Contraseña: `admin`

## Base de Datos

Usa PostgreSQL (Railway). Configurar `DATABASE_URL` en `.env`.

## API Endpoints

- `POST /api/signup` - Crear empresa
- `POST /api/login` - Iniciar sesión
- `POST /api/logout` - Cerrar sesión
- `POST /api/forgot-password` - Recuperar contraseña
- `POST /api/reset-password` - Restablecer contraseña

### Productos
- `GET /api/products` - Listar
- `POST /api/products` - Crear
- `PUT /api/products/:id` - Actualizar
- `DELETE /api/products/:id` - Eliminar

### Clientes
- `GET /api/clients` - Listar
- `POST /api/clients` - Crear
- `PUT /api/clients/:id` - Actualizar
- `DELETE /api/clients/:id` - Eliminar

### Ventas
- `GET /api/sales` - Listar
- `GET /api/sales/:id` - Detalle
- `POST /api/sales` - Crear
- `DELETE /api/sales/:id` - Eliminar

### Pagos
- `GET /api/payments` - Listar
- `POST /api/payments` - Crear

### Gastos
- `GET /api/expenses` - Listar
- `POST /api/expenses` - Crear
- `DELETE /api/expenses/:id` - Eliminar

### Reportes
- `GET /api/reports/summary` - Resumen mensual
- `GET /api/reports/top-products` - Top productos

## Despliegue en Railway

1. Conectar repositorio en Railway
2. Configurar `DATABASE_URL` en variables de entorno
3. Deploy automático

## Stack

- Backend: Node.js + Express
- Base de datos: PostgreSQL
- Frontend: Vanilla JS + CSS
- Hosting: Railway
