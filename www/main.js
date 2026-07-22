// PrestamosApp - Lógica de Negocio e Interfaz de Usuario

// --- 1. ESTADO DE LA APLICACIÓN ---
let state = {
  clients: [],
  loans: [],
  theme: 'light'
};

// Frecuencias de pago
const FREQUENCIES = {
  monthly: { name: 'Mensual', periodsPerYear: 12, label: 'meses' },
  biweekly: { name: 'Quincenal', periodsPerYear: 24, label: 'quincenas' },
  weekly: { name: 'Semanal', periodsPerYear: 52, label: 'semanas' },
  daily: { name: 'Diario', periodsPerYear: 365, label: 'días' }
};

// Variable para almacenar el préstamo calculado temporalmente antes de otorgarlo
let calculatedLoanTemp = null;
let currentClientId = null; // ID del cliente actualmente visualizado en el modal

// Instancias de Chart.js globales para poder destruirlas y recrearlas
let collectionsChartInstance = null;
let statusChartInstance = null;

// --- 2. API URL CONFIGURATION ---
// En dispositivos móviles (APK) apuntamos al servidor público en Render.
// En el navegador de escritorio usamos la URL del servidor local.
const IS_CAPACITOR = !window.location.port && (window.location.protocol === 'capacitor:' || window.location.origin === 'http://localhost');
const API_URL = window.PRESTAMOS_API_URL || (IS_CAPACITOR ? 'https://prestamos-app-final.onrender.com/api' : window.location.origin + '/api');

// --- LIMPIEZA FORZADA DE CACHÉ Y SERVICE WORKER ---
(function cleanCacheAndSW() {
  try {
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name));
      }).catch(() => {});
    }
  } catch (e) {}

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(registration => registration.unregister());
    }).catch(() => {});
  }

  localStorage.removeItem('prestamos_theme');
  localStorage.removeItem('prestamos_cache_cleared_v6');
  localStorage.removeItem('prestamos_cache_cleared_v7');
  localStorage.removeItem('prestamos_cache_cleared_v8');
  localStorage.removeItem('prestamos_cache_cleared_v9');
  console.log('Caché y service worker limpiados.');
})();

function getAuthToken() {
  return localStorage.getItem('prestamos_auth_token');
}
async function apiRequest(endpoint, options = {}) {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'x-auth-token': token } : {}),
    ...(options.headers || {})
  };
  
  const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
  if (response.status === 401) {
    localStorage.removeItem('prestamos_auth_token');
    showLogin();
    throw new Error('No autorizado');
  }
  
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Error en la solicitud');
  }
  return data;
}

// Utility para verificar características del plan
function hasFeature(featureName) {
  const isSuperAdmin = localStorage.getItem('prestamos_is_superadmin') === 'true';
  if (isSuperAdmin) return true; // Superadmin tiene todo
  
  try {
    const featuresStr = localStorage.getItem('prestamos_plan_features');
    if (!featuresStr) return false;
    const features = JSON.parse(featuresStr);
    return !!features[featureName];
  } catch (e) {
    return false;
  }
}

function getPlanLimit(limitName, fallback = Infinity) {
  const isSuperAdmin = localStorage.getItem('prestamos_is_superadmin') === 'true';
  if (isSuperAdmin) return Infinity;
  
  try {
    const featuresStr = localStorage.getItem('prestamos_plan_features');
    if (!featuresStr) return fallback;
    const features = JSON.parse(featuresStr);
    return features[limitName] !== undefined ? features[limitName] : fallback;
  } catch (e) {
    return fallback;
  }
}

async function loadData() {
  const token = getAuthToken();
  if (!token) {
    showLogin();
    return;
  }
  
  // Mostrar u ocultar menú super admin
  const isSuperAdmin = localStorage.getItem('prestamos_is_superadmin') === 'true';
  const adminNav = document.getElementById('nav-superadmin');
  if (adminNav) {
    adminNav.style.display = isSuperAdmin ? 'flex' : 'none';
  }
  // Mi Plan solo visible para usuarios/inquilinos, NO para el Super Admin
  const plansNav = document.getElementById('nav-plans');
  if (plansNav) {
    // El cliente solicitó ocultar los planes para usuarios nuevos/normales
    plansNav.style.display = 'none';
  }
  
  // Ocultar Gestión de Usuarios a empleados normales
  const usersCard = document.getElementById('settings-users-card');
  if (usersCard) {
    usersCard.style.display = isSuperAdmin ? 'block' : 'none';
  }

  // Ocultar Gestión de Datos a empleados normales
  const dataMgmtCard = document.getElementById('settings-data-mgmt-card');
  if (dataMgmtCard) {
    dataMgmtCard.style.display = isSuperAdmin ? 'block' : 'none';
  }

  showApp();
  try {
    const [clients, loans] = await Promise.all([
      apiRequest('/clients'),
      apiRequest('/loans')
    ]);
    state.clients = clients || [];
    state.loans = loans || [];
    // Ensure nested fields
    state.loans.forEach(l => {
      if (!l.instalments) l.instalments = [];
      l.instalments.forEach(i => {
        if (!i.payments) i.payments = [];
      });
    });
    
    refreshAll();
  } catch (e) {
    console.error('Error cargando datos', e);
  }
}

function showApp() {
  const loginScreen = document.getElementById('login-screen');
  if (loginScreen) loginScreen.classList.remove('active');
  
  let appWrapper = document.getElementById('app-wrapper');
  if (!appWrapper) appWrapper = document.getElementById('main-app');
  if (appWrapper) appWrapper.classList.remove('d-none');
  
  if (hasFeature('allow_guarantees')) { const el = document.getElementById('nav-guarantees'); if(el) el.style.display = 'block'; }
  if (hasFeature('allow_finances')) { const el = document.getElementById('nav-finances'); if(el) el.style.display = 'block'; }
  if (hasFeature('allow_expenses')) { const el = document.getElementById('nav-expenses'); if(el) el.style.display = 'block'; }
  if (hasFeature('allow_banks')) { const el = document.getElementById('nav-banks'); if(el) el.style.display = 'block'; }
  if (hasFeature('allow_cash')) { const el = document.getElementById('nav-cash'); if(el) el.style.display = 'block'; }
  if (hasFeature('allow_debugger')) { const el = document.getElementById('nav-debugger'); if(el) el.style.display = 'block'; }
  
  // Controlar acceso a PDF según plan
  const canUseDocs = hasFeature('allow_documents');
  const pdfBtns = ['export-clients-pdf-btn', 'export-loans-pdf-btn'];
  pdfBtns.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = canUseDocs ? '' : 'none';
  });
}

function showLogin() {
  const loginScreen = document.getElementById('login-screen');
  if (loginScreen) loginScreen.classList.add('active');
  
  let appWrapper = document.getElementById('app-wrapper');
  if (!appWrapper) appWrapper = document.getElementById('main-app');
  if (appWrapper) appWrapper.classList.add('d-none');
  
  // Limpiar campos de login al cerrar sesión
  const userEl = document.getElementById('login-username');
  const passEl = document.getElementById('login-password');
  const errorEl = document.getElementById('login-error');
  if (userEl) userEl.value = '';
  if (passEl) passEl.value = '';
  if (errorEl) {
    errorEl.classList.add('d-none');
    errorEl.textContent = '';
  }
}

// Lógica del formulario de login
const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('login-username').value;
    const pass = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    
    try {
      const res = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error de autenticación');
      
      localStorage.setItem('prestamos_auth_token', data.token);
      if (data.role) localStorage.setItem('prestamos_user_role', data.role);
      
      if (data.isSuperAdmin) {
        localStorage.setItem('prestamos_is_superadmin', 'true');
      } else {
        localStorage.removeItem('prestamos_is_superadmin');
      }
      
      if (data.planFeatures) {
        localStorage.setItem('prestamos_plan_features', JSON.stringify(data.planFeatures));
      } else {
        localStorage.removeItem('prestamos_plan_features');
      }
      
      errorEl.classList.add('d-none');
      showApp();
      loadData();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('d-none');
    }
  });
}

// Guardar preferencias locales (ej. tema)
function savePreferences() {
  localStorage.setItem('prestamos_theme', state.theme);
}

// Cargar Datos de Prueba (Seed)
function seedMockData() {
  const now = new Date();
  
  // Clientes Semilla
  const mockClients = [
    {
      id: "cli_1",
      name: "Juan Carlos Pérez",
      phone: "+1 809-555-0101",
      email: "juan.perez@email.com",
      notes: "Cliente recurrente, excelente historial de pago. Propietario de colmado.",
      createdAt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString() // Hace 90 días
    },
    {
      id: "cli_2",
      name: "María Altagracia Gómez",
      phone: "+1 809-555-0202",
      email: "maria.gomez@email.com",
      notes: "Puntual en cuotas quincenales. Salón de belleza.",
      createdAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString() // Hace 60 días
    },
    {
      id: "cli_3",
      name: "Pedro Ignacio Sánchez",
      phone: "+1 829-555-0303",
      email: "pedro.sanchez@email.com",
      notes: "Taxista independiente. Solicita cobros semanales.",
      createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString() // Hace 30 días
    },
    {
      id: "cli_4",
      name: "Sofía Elena Mendoza",
      phone: "+1 849-555-0404",
      email: "sofia.mendoza@email.com",
      notes: "Nueva cliente, recomendada por Juan Pérez.",
      createdAt: now.toISOString()
    }
  ];

  // Préstamos Semilla
  // 1. Préstamo de Juan Pérez: Pagado. Monto: $1000, 10% interes, 3 cuotas mensuales, Francés. Creado hace 90 días.
  const loan1Date = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const loan1 = generateLoanObject("cli_1", "Juan Carlos Pérez", 1000, 12, 3, "monthly", "french", loan1Date);
  // Marcar todas las cuotas como pagadas
  loan1.instalments.forEach((inst, index) => {
    inst.status = 'paid';
    inst.paid = inst.amount;
    const payDate = new Date(loan1Date.getTime() + (index + 1) * 30 * 24 * 60 * 60 * 1000);
    inst.payments = [{
      id: `pay_l1_${index}`,
      amount: inst.amount,
      date: payDate.toISOString().split('T')[0]
    }];
  });
  loan1.remainingBalance = 0;
  loan1.status = 'paid';

  // 2. Préstamo de María Gómez: Activo con abonos. Monto: $2000, 15% interés, 6 cuotas quincenales, Francés. Creado hace 45 días.
  const loan2Date = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);
  const loan2 = generateLoanObject("cli_2", "María Altagracia Gómez", 2000, 15, 6, "biweekly", "french", loan2Date);
  // Pagar las primeras 3 cuotas
  let totalPaidL2 = 0;
  for (let i = 0; i < 3; i++) {
    loan2.instalments[i].status = 'paid';
    loan2.instalments[i].paid = loan2.instalments[i].amount;
    totalPaidL2 += loan2.instalments[i].amount;
    const payDate = new Date(loan2Date.getTime() + (i + 1) * 14 * 24 * 60 * 60 * 1000);
    loan2.instalments[i].payments = [{
      id: `pay_l2_${i}`,
      amount: loan2.instalments[i].amount,
      date: payDate.toISOString().split('T')[0]
    }];
  }
  loan2.remainingBalance = parseFloat((loan2.totalPayable - totalPaidL2).toFixed(2));
  loan2.status = 'active';

  // 3. Préstamo de Pedro Sánchez: Vencido (Atrasado). Monto: $1500, 18% interés, 4 cuotas semanales, Francés. Creado hace 25 días.
  // Como es semanal, ya pasaron las 4 semanas. Supongamos que solo pagó la cuota 1 y 2. La 3 y 4 están vencidas.
  const loan3Date = new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000);
  const loan3 = generateLoanObject("cli_3", "Pedro Ignacio Sánchez", 1500, 18, 4, "weekly", "french", loan3Date);
  
  // Pagar cuota 1 y 2
  let totalPaidL3 = 0;
  for (let i = 0; i < 2; i++) {
    loan3.instalments[i].status = 'paid';
    loan3.instalments[i].paid = loan3.instalments[i].amount;
    totalPaidL3 += loan3.instalments[i].amount;
    const payDate = new Date(loan3Date.getTime() + (i + 1) * 7 * 24 * 60 * 60 * 1000);
    loan3.instalments[i].payments = [{
      id: `pay_l3_${i}`,
      amount: loan3.instalments[i].amount,
      date: payDate.toISOString().split('T')[0]
    }];
  }
  
  // Vencer cuotas 3 y 4 (sus fechas de vencimiento ya pasaron)
  loan3.instalments[2].status = 'overdue';
  loan3.instalments[3].status = 'overdue';
  
  loan3.remainingBalance = parseFloat((loan3.totalPayable - totalPaidL3).toFixed(2));
  loan3.status = 'overdue';

  state.clients = mockClients;
  state.loans = [loan1, loan2, loan3];
  saveState();
  
  // Recargar UI
  refreshAll();
}

// --- 3. MOTOR MATEMÁTICO DE PRÉSTAMOS ---

// Función para calcular amortización
function calculateAmortization(amount, annualRate, term, frequency, type, startDate) {
  const freqData = FREQUENCIES[frequency];
  const periodsPerYear = freqData.periodsPerYear;
  
  // Tasa de interés por período
  const ratePerPeriod = (annualRate / 100) / periodsPerYear;
  
  let instalments = [];
  let totalPayable = 0;
  let interestAmount = 0;
  
  let start = new Date(startDate);
  
  if (type === 'french') {
    // Sistema Francés: Cuota Fija
    // P = A * (r * (1 + r)^n) / ((1 + r)^n - 1)
    let fixedPayment = 0;
    if (ratePerPeriod === 0) {
      fixedPayment = amount / term;
    } else {
      fixedPayment = amount * (ratePerPeriod * Math.pow(1 + ratePerPeriod, term)) / (Math.pow(1 + ratePerPeriod, term) - 1);
    }
    
    fixedPayment = parseFloat(fixedPayment.toFixed(2));
    let remainingBalance = amount;
    
    for (let i = 1; i <= term; i++) {
      let interest = parseFloat((remainingBalance * ratePerPeriod).toFixed(2));
      let capital = parseFloat((fixedPayment - interest).toFixed(2));
      
      // Ajuste en la última cuota para cuadrar redondeos
      if (i === term) {
        capital = remainingBalance;
        fixedPayment = parseFloat((capital + interest).toFixed(2));
      }
      
      remainingBalance = parseFloat((remainingBalance - capital).toFixed(2));
      if (remainingBalance < 0) remainingBalance = 0;
      
      // Fecha de vencimiento
      let dueDate = new Date(start);
      if (frequency === 'monthly') {
        dueDate.setMonth(dueDate.getMonth() + i);
      } else if (frequency === 'biweekly') {
        dueDate.setDate(dueDate.getDate() + i * 14);
      } else if (frequency === 'weekly') {
        dueDate.setDate(dueDate.getDate() + i * 7);
      } else if (frequency === 'daily') {
        dueDate.setDate(dueDate.getDate() + i * 1);
      }
      
      instalments.push({
        index: i,
        dueDate: dueDate.toISOString().split('T')[0],
        amount: fixedPayment,
        capital: capital,
        interest: interest,
        paid: 0,
        status: 'pending',
        payments: []
      });
      
      totalPayable += fixedPayment;
      interestAmount += interest;
    }
  } else if (type === 'german') {
    // Sistema Alemán: Amortización de capital constante, intereses decrecientes
    let capitalPerPeriod = parseFloat((amount / term).toFixed(2));
    let remainingBalance = amount;
    
    for (let i = 1; i <= term; i++) {
      let interest = parseFloat((remainingBalance * ratePerPeriod).toFixed(2));
      let capital = capitalPerPeriod;
      
      if (i === term) {
        capital = remainingBalance;
      }
      
      let payment = parseFloat((capital + interest).toFixed(2));
      
      remainingBalance = parseFloat((remainingBalance - capital).toFixed(2));
      if (remainingBalance < 0) remainingBalance = 0;
      
      let dueDate = new Date(start);
      if (frequency === 'monthly') dueDate.setMonth(dueDate.getMonth() + i);
      else if (frequency === 'biweekly') dueDate.setDate(dueDate.getDate() + i * 14);
      else if (frequency === 'weekly') dueDate.setDate(dueDate.getDate() + i * 7);
      else if (frequency === 'daily') dueDate.setDate(dueDate.getDate() + i * 1);
      
      instalments.push({
        index: i,
        dueDate: dueDate.toISOString().split('T')[0],
        amount: payment,
        capital: capital,
        interest: interest,
        paid: 0,
        status: 'pending',
        payments: []
      });
      
      totalPayable += payment;
      interestAmount += interest;
    }
  } else {
    // Interés Simple
    // Total Interés = Principal * Tasa Periodo * Term
    const totalInterest = parseFloat((amount * ratePerPeriod * term).toFixed(2));
    const totalSum = amount + totalInterest;
    const fixedPayment = parseFloat((totalSum / term).toFixed(2));
    const capitalPerPeriod = parseFloat((amount / term).toFixed(2));
    const interestPerPeriod = parseFloat((totalInterest / term).toFixed(2));
    
    let remainingBalance = amount;
    
    for (let i = 1; i <= term; i++) {
      let interest = interestPerPeriod;
      let capital = capitalPerPeriod;
      let payment = fixedPayment;
      
      // Ajustes finales por decimales
      if (i === term) {
        capital = remainingBalance;
        payment = parseFloat((capital + interest).toFixed(2));
      }
      
      remainingBalance = parseFloat((remainingBalance - capital).toFixed(2));
      if (remainingBalance < 0) remainingBalance = 0;
      
      // Fecha de vencimiento
      let dueDate = new Date(start);
      if (frequency === 'monthly') {
        dueDate.setMonth(dueDate.getMonth() + i);
      } else if (frequency === 'biweekly') {
        dueDate.setDate(dueDate.getDate() + i * 14);
      } else if (frequency === 'weekly') {
        dueDate.setDate(dueDate.getDate() + i * 7);
      } else if (frequency === 'daily') {
        dueDate.setDate(dueDate.getDate() + i * 1);
      }
      
      instalments.push({
        index: i,
        dueDate: dueDate.toISOString().split('T')[0],
        amount: payment,
        capital: capital,
        interest: interest,
        paid: 0,
        status: 'pending',
        payments: []
      });
      
      totalPayable += payment;
      interestAmount += interest;
    }
  }
  
  totalPayable = parseFloat(totalPayable.toFixed(2));
  interestAmount = parseFloat(interestAmount.toFixed(2));
  
  return {
    amount: parseFloat(amount),
    rate: parseFloat(annualRate),
    term: parseInt(term),
    frequency: frequency,
    type: type,
    startDate: startDate,
    totalPayable: totalPayable,
    interestAmount: interestAmount,
    remainingBalance: totalPayable,
    status: 'active',
    instalments: instalments
  };
}

// Genera un objeto completo de préstamo asignando ID y Cliente
function generateLoanObject(clientId, clientName, amount, annualRate, term, frequency, type, startDate) {
  const loanDetails = calculateAmortization(amount, annualRate, term, frequency, type, startDate);
  const loanId = "loan_" + Math.random().toString(36).substring(2, 9);
  
  return {
    id: loanId,
    clientId: clientId,
    clientName: clientName,
    ...loanDetails
  };
}

// --- 4. CONTROLADORES Y RUTEADOR ---

// Navegar entre secciones (SPA)
const navLinks = document.querySelectorAll('.nav-link');
const sections = document.querySelectorAll('.app-section');
const sectionTitle = document.getElementById('section-title');
const sectionSubtitle = document.getElementById('section-subtitle');

const sectionMeta = {
    'dashboard': { title: 'Dashboard', subtitle: 'Resumen general de préstamos' },
    'clients': { title: 'Gestión de Clientes', subtitle: 'Administra tus clientes y su información' },
    'loans': { title: 'Gestión de Préstamos', subtitle: 'Administra los préstamos activos e históricos' },
    'calculator': { title: 'Calculadora de Préstamos', subtitle: 'Simula y genera nuevos préstamos' },
    'settings': { title: 'Configuración', subtitle: 'Ajustes del sistema y usuarios' },
    'plans': { title: 'Mi Plan', subtitle: 'Gestiona tu suscripción y límites' },
    'superadmin': { title: 'Administración Global', subtitle: 'Gestión SaaS de inquilinos y planes' },
    'guarantees': { title: 'Garantías', subtitle: 'Administra las garantías de los préstamos' },
    'finances': { title: 'Finanzas', subtitle: 'Análisis global del negocio' },
    'expenses': { title: 'Gastos Operativos', subtitle: 'Registra y controla los gastos' },
    'banks': { title: 'Cuentas Bancarias', subtitle: 'Gestión de bancos y saldo' },
    'cash': { title: 'Control de Caja', subtitle: 'Apertura y cierre de caja diario' },
    'debugger': { title: 'Debugger', subtitle: 'Herramientas de depuración' }
};

function switchSection(targetSectionId) {
  // Ocultar todas las secciones y quitar clases activas
  sections.forEach(sec => sec.classList.remove('active'));
  navLinks.forEach(link => link.classList.remove('active'));
  
  // Activar la sección correspondiente
  const targetSection = document.getElementById(`sec-${targetSectionId}`);
  if (targetSection) {
    targetSection.classList.add('active');
  }
  
  const targetLink = document.querySelector(`.nav-link[data-target="${targetSectionId}"]`);
  if (targetLink) {
    targetLink.classList.add('active');
  }
  
  // Cambiar textos de cabecera
  const meta = sectionMeta[targetSectionId];
  if (meta) {
    sectionTitle.textContent = meta.title;
    sectionSubtitle.textContent = meta.subtitle;
  }
  
  if (targetSectionId === 'settings') {
    loadUsers();
  }
  
  // Actualizar datos de la sección específica
  if (targetSectionId === 'dashboard') {
    renderDashboard();
  } else if (targetSectionId === 'clients') {
    renderClientsTable();
  } else if (targetSectionId === 'loans') {
    renderLoansTable();
  } else if (targetSectionId === 'calculator') {
    populateClientSelect();
  } else if (targetSectionId === 'plans') {
    renderPlansSection();
  } else if (targetSectionId === 'superadmin') {
    renderSuperAdminSection();
  } else if (targetSectionId === 'guarantees') {
    loadGuarantees();
  } else if (targetSectionId === 'expenses') {
    loadExpenses();
  } else if (targetSectionId === 'banks') {
    loadBanks();
    loadBankTransactions();
  } else if (targetSectionId === 'cash') {
    loadCashStatus();
    loadCashHistory();
    loadDenominations();
  } else if (targetSectionId === 'finances') {
    loadFinancesSummary();
  } else if (targetSectionId === 'debugger') {
    loadDebuggerSection();
  }
  
  // Ocultar botón 'Nuevo Préstamo' en el panel de administrador global
  const quickLoanBtn = document.getElementById('quick-loan-btn');
  if (quickLoanBtn) {
    quickLoanBtn.style.display = targetSectionId === 'superadmin' ? 'none' : 'inline-flex';
  }
}

navLinks.forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const target = link.getAttribute('data-target');
    switchSection(target);
    closeSidebarDrawer();
  });
});

// --- MENU CORREDERA (MOVIL) ---
function openSidebarDrawer() {
  const sb = document.querySelector('.sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (sb) sb.classList.add('open');
  if (ov) ov.classList.add('open');
}

function closeSidebarDrawer() {
  const sb = document.querySelector('.sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (sb) sb.classList.remove('open');
  if (ov) ov.classList.remove('open');
}

const menuToggle = document.getElementById('menu-toggle');
if (menuToggle) {
  menuToggle.addEventListener('click', () => {
    const sb = document.querySelector('.sidebar');
    if (sb && sb.classList.contains('open')) closeSidebarDrawer();
    else openSidebarDrawer();
  });
}

const sidebarOverlay = document.getElementById('sidebar-overlay');
if (sidebarOverlay) {
  sidebarOverlay.addEventListener('click', closeSidebarDrawer);
}

// Registrar eventos de botones rápidos (con verificación de existencia)
  const quickLoanBtn = document.getElementById('quick-loan-btn');
  if (quickLoanBtn) {
    quickLoanBtn.addEventListener('click', () => {
      const maxLoans = getPlanLimit('max_loans');
      if (state.loans && state.loans.length >= maxLoans) {
        alert('Ha alcanzado el límite de préstamos activos de su plan. Comuníquese con ventas para mejorar su plan.');
        return;
      }
      switchSection('calculator');
    });
  }
  const newLoanShortcutBtn = document.getElementById('new-loan-shortcut-btn');
  if (newLoanShortcutBtn) {
    newLoanShortcutBtn.addEventListener('click', () => {
      const maxLoans = getPlanLimit('max_loans');
      if (state.loans && state.loans.length >= maxLoans) {
        alert('Ha alcanzado el límite de préstamos activos de su plan. Comuníquese con ventas para mejorar su plan.');
        return;
      }
      switchSection('calculator');
    });
  }

// --- 5. LÓGICA DE NEGOCIO EN EL FRONTEND ---

// Variable global para ajustes
window.appSettings = {};

// Formatear Moneda
function formatCurrency(value) {
  const symbol = window.appSettings.currencySymbol || '$';
  return symbol + ' ' + Number(value).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Formatear Fecha legible
function formatDateReadable(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr + 'T00:00:00'); // Evitar desfase de zona horaria
  return date.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Actualizar lista de clientes en la calculadora
function populateClientSelect() {
  const select = document.getElementById('calc-client');
  select.innerHTML = '<option value="">-- Seleccionar Cliente --</option>';
  
  state.clients.forEach(client => {
    const option = document.createElement('option');
    option.value = client.id;
    option.textContent = client.name;
    select.appendChild(option);
  });
}

// 5.1 RENDERIZAR DASHBOARD
function renderDashboard() {
  // Comprobar estado de los préstamos por fecha de vencimiento (marcar Overdue si aplica)
  checkOverdueLoans();

  let totalCapital = 0;
  let totalInterests = 0;
  let totalCollected = 0;
  let totalMora = 0;
  
  let activeCount = 0;
  let paidCount = 0;
  let overdueCount = 0;

  // Mapa de cobros por mes para el gráfico
  // Estructura: { '2026-06': { capital: X, interest: Y } }
  const collectionsByMonth = {};

  state.loans.forEach(loan => {
    totalCapital += loan.amount;
    totalInterests += loan.interestAmount;
    
    if (loan.status === 'paid') paidCount++;
    else if (loan.status === 'overdue') overdueCount++;
    else activeCount++;

    loan.instalments.forEach(inst => {
      if (inst.status === 'overdue') {
        totalMora += (inst.amount - inst.paid);
      }
      inst.payments.forEach(pay => {
        totalCollected += pay.amount;
        
        // Agrupar pagos por mes para la gráfica
        const monthKey = pay.date.substring(0, 7); // 'YYYY-MM'
        if (!collectionsByMonth[monthKey]) {
          collectionsByMonth[monthKey] = { capital: 0, interest: 0 };
        }
        
        // Dividir proporcionalmente el abono entre capital e interés en la cuota
        const ratio = inst.capital / (inst.capital + inst.interest || 1);
        const capContribution = pay.amount * ratio;
        const intContribution = pay.amount * (1 - ratio);
        
        collectionsByMonth[monthKey].capital += capContribution;
        collectionsByMonth[monthKey].interest += intContribution;
      });
    });
  });

  const totalPayable = totalCapital + totalInterests;

  // Actualizar KPIs
  document.getElementById('kpi-capital').textContent = formatCurrency(totalCapital);
  document.getElementById('kpi-interests').textContent = formatCurrency(totalInterests);
  document.getElementById('kpi-collected').textContent = formatCurrency(totalCollected);
  document.getElementById('kpi-mora').textContent = formatCurrency(totalMora);

  const moraPercentage = totalCapital > 0 ? (totalMora / totalCapital) * 100 : 0;
  const moraLabel = document.getElementById('mora-label-text');
  const moraText = document.getElementById('mora-percentage-text');
  const moraBar = document.getElementById('mora-progress-bar');
  
  if (moraLabel && moraText && moraBar) {
    moraText.textContent = moraPercentage.toFixed(2) + '%';
    moraBar.style.width = Math.min(moraPercentage, 100) + '%';
    if (moraPercentage === 0) {
      moraLabel.textContent = 'Sin Morosidad';
      moraLabel.style.color = 'var(--success-color)';
      moraBar.style.backgroundColor = 'var(--success-color)';
    } else if (moraPercentage <= 5) {
      moraLabel.textContent = 'Morosidad Baja (Saludable)';
      moraLabel.style.color = 'var(--success-color)';
      moraBar.style.backgroundColor = 'var(--success-color)';
    } else if (moraPercentage <= 15) {
      moraLabel.textContent = 'Morosidad Media (Atención)';
      moraLabel.style.color = 'var(--warning-color)';
      moraBar.style.backgroundColor = 'var(--warning-color)';
    } else {
      moraLabel.textContent = 'Morosidad Alta (Crítico)';
      moraLabel.style.color = 'var(--danger-color)';
      moraBar.style.backgroundColor = 'var(--danger-color)';
    }
  }

  // Renderizar gráficos
  renderStatusChart(totalCollected, Math.max(0, totalPayable - totalCollected));
  renderCollectionsChart(collectionsByMonth);
  renderRecentPayments();
}

// Revisar fechas de cuotas y marcar atrasos
function checkOverdueLoans() {
  const todayStr = new Date().toISOString().split('T')[0];
  let stateChanged = false;

  state.loans.forEach(loan => {
    if (loan.status === 'paid') return;

    let loanOverdue = false;
    loan.instalments.forEach(inst => {
      if (inst.status !== 'paid') {
        if (inst.dueDate < todayStr) {
          inst.status = 'overdue';
          loanOverdue = true;
          stateChanged = true;
        } else {
          inst.status = 'pending';
        }
      }
    });

    if (loanOverdue) {
      if (loan.status !== 'overdue') {
        loan.status = 'overdue';
        stateChanged = true;
      }
    } else {
      if (loan.status !== 'active') {
        loan.status = 'active';
        stateChanged = true;
      }
    }
  });

  if (stateChanged) {
    saveState();
  }
}

// Historial de pagos recientes en Dashboard
function renderRecentPayments() {
  const tbody = document.getElementById('dashboard-recent-payments');
  tbody.innerHTML = '';
  
  // Extraer todos los pagos con metadatos
  let allPayments = [];
  state.loans.forEach(loan => {
    loan.instalments.forEach(inst => {
      inst.payments.forEach(pay => {
        allPayments.push({
          date: pay.date,
          clientName: loan.clientName,
          loanId: loan.id,
          instalmentNum: inst.index,
          amount: pay.amount
        });
      });
    });
  });

  // Ordenar por fecha descendente
  allPayments.sort((a, b) => b.date.localeCompare(a.date));
  
  // Tomar los 5 más recientes
  const recent = allPayments.slice(0, 5);

  if (recent.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No hay cobros registrados.</td></tr>';
    return;
  }

  recent.forEach(pay => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDateReadable(pay.date)}</td>
      <td style="font-weight: 500;">${pay.clientName}</td>
      <td><span class="badge badge-primary" style="font-family: var(--font-mono); font-size: 0.75rem;">${pay.loanId}</span></td>
      <td>Cuota ${pay.instalmentNum}</td>
      <td class="number-cell text-right" style="font-weight: 600; color: var(--success);">${formatCurrency(pay.amount)}</td>
      <td><span class="badge badge-success">Recibido</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// Gráfico: Estado de Préstamos
function renderStatusChart(collected, pending) {
  const ctx = document.getElementById('statusChart').getContext('2d');
  
  if (statusChartInstance) {
    statusChartInstance.destroy();
  }

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const labelColor = isDark ? '#fafafa' : '#09090b';

  if (collected === 0 && pending === 0) {
    pending = 1;
  }

  statusChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Dinero Recuperado', 'Por Recuperar'],
      datasets: [{
        data: [collected, pending],
        backgroundColor: [
          '#10b981', // Verde
          '#f59e0b'  // Naranja/Amarillo
        ],
        borderWidth: isDark ? 2 : 1,
        borderColor: isDark ? '#0d0d11' : '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: labelColor,
            font: { family: 'DM Sans', size: 11 }
          }
        }
      },
      cutout: '65%'
    }
  });
}

// Gráfico: Recaudaciones por Mes
function renderCollectionsChart(collectionsByMonth) {
  const ctx = document.getElementById('collectionsChart').getContext('2d');
  
  if (collectionsChartInstance) {
    collectionsChartInstance.destroy();
  }

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const labelColor = isDark ? '#a1a1aa' : '#71717a';
  const gridColor = isDark ? '#27272a' : '#e4e4e7';
  const titleColor = isDark ? '#fafafa' : '#09090b';

  // Ordenar meses cronológicamente
  const sortedMonths = Object.keys(collectionsByMonth).sort();
  
  // Si no hay cobros, rellenar con meses de prueba neutros
  const labels = sortedMonths.length > 0 ? sortedMonths.map(m => {
    const [year, month] = m.split('-');
    const date = new Date(year, month - 1, 1);
    return date.toLocaleString('es-ES', { month: 'short' }) + ' ' + year.substring(2);
  }) : ['Sin Datos'];
  
  const capitalData = sortedMonths.length > 0 ? sortedMonths.map(m => parseFloat(collectionsByMonth[m].capital.toFixed(2))) : [0];
  const interestData = sortedMonths.length > 0 ? sortedMonths.map(m => parseFloat(collectionsByMonth[m].interest.toFixed(2))) : [0];

  collectionsChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Capital Recuperado',
          data: capitalData,
          backgroundColor: '#3b82f6', // Azul claro
          borderRadius: 4
        },
        {
          label: 'Intereses Cobrados',
          data: interestData,
          backgroundColor: '#10b981', // Verde
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { color: labelColor, font: { family: 'DM Sans' } }
        },
        y: {
          stacked: true,
          grid: { color: gridColor },
          ticks: { color: labelColor, font: { family: 'JetBrains Mono' } }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: titleColor,
            font: { family: 'DM Sans', size: 12 }
          }
        }
      }
    }
  });
}

// 5.2 LÓGICA DE LA CALCULADORA
const calculatorForm = document.getElementById('calculator-form');
const calcResultCard = document.getElementById('calc-result-card');
const calcAmortizationTable = document.getElementById('calc-amortization-table');
const calcSummaryText = document.getElementById('calc-summary-text');
const calcTotalPayableBadge = document.getElementById('calc-total-payable');
const calcGrantBtn = document.getElementById('calc-grant-btn');

// Establecer fecha por defecto de hoy
document.getElementById('calc-date').value = new Date().toISOString().split('T')[0];

calculatorForm.addEventListener('submit', (e) => {
  e.preventDefault();
  
  const clientId = document.getElementById('calc-client').value;
  const amount = parseFloat(document.getElementById('calc-amount').value);
  const rate = parseFloat(document.getElementById('calc-rate').value);
  const term = parseInt(document.getElementById('calc-term').value);
  const frequency = document.getElementById('calc-frequency').value;
  const type = document.getElementById('calc-type').value;
  const startDate = document.getElementById('calc-date').value;

  let clientName = "Cliente Simulado";
  if (clientId) {
    const client = state.clients.find(c => c.id === clientId);
    if (client) clientName = client.name;
  }

  // Generar objeto préstamo temporal
  calculatedLoanTemp = generateLoanObject(clientId, clientName, amount, rate, term, frequency, type, startDate);

  // Renderizar la tabla de amortización calculada
  renderAmortizationTable(calculatedLoanTemp.instalments);
  
  // Resumen
  const freqName = FREQUENCIES[frequency].name;
  const typeName = type === 'french' ? 'Francés (Cuota Fija)' : (type === 'german' ? 'Alemán (Capital Fijo)' : 'Simple (Cuota Lineal)');
  calcSummaryText.innerHTML = `Préstamo de <strong>${formatCurrency(amount)}</strong> a <strong>${term} cuotas ${freqName.toLowerCase()}s</strong> (${typeName}) al <strong>${rate}% anual</strong>.`;
  calcTotalPayableBadge.textContent = `Total a Pagar: ${formatCurrency(calculatedLoanTemp.totalPayable)}`;

  calcResultCard.classList.remove('d-none');
  
  // Habilitar botón para otorgar
  if (clientId) {
    calcGrantBtn.removeAttribute('disabled');
    calcGrantBtn.classList.remove('btn-secondary');
    calcGrantBtn.classList.add('btn-primary');
  } else {
    calcGrantBtn.setAttribute('disabled', 'true');
    calcGrantBtn.classList.add('btn-secondary');
    calcGrantBtn.classList.remove('btn-primary');
    calcSummaryText.innerHTML += " <br><span style='color: var(--danger); font-size: 0.8rem;'>* Seleccione un cliente para habilitar el otorgamiento oficial del préstamo.</span>";
  }
  
  // Re-inicializar iconos de la tabla
  lucide.createIcons();
});

// Renderizar filas de la tabla de amortización generada
function renderAmortizationTable(instalments) {
  calcAmortizationTable.innerHTML = '';
  
  instalments.forEach(inst => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 600;">${inst.index}</td>
      <td>${formatDateReadable(inst.dueDate)}</td>
      <td class="number-cell text-right" style="font-weight: 600;">${formatCurrency(inst.amount)}</td>
      <td class="number-cell text-right" style="color: var(--text-muted);">${formatCurrency(inst.capital)}</td>
      <td class="number-cell text-right" style="color: var(--text-muted);">${formatCurrency(inst.interest)}</td>
      <td class="number-cell text-right">${formatCurrency(inst.dueDate ? inst.dueDate : 0)}</td>
    `;
    // En la última celda de saldo restante, calculamos el acumulado decreciente
    // Para simplificar la vista, pasamos el saldo ya calculado en el objeto inst
    // Espera, no guardamos el saldo restante exacto por cuota en el objeto inst dentro de calculateAmortization.
    // Vamos a corregir la celda de "Saldo Restante" calculándola al vuelo en la UI.
  });
  
  // Corrección de la renderización del saldo restante decreciente
  calcAmortizationTable.innerHTML = '';
  let currentBalance = calculatedLoanTemp.totalPayable;
  
  instalments.forEach(inst => {
    currentBalance = parseFloat((currentBalance - inst.amount).toFixed(2));
    if (currentBalance < 0.05) currentBalance = 0; // Evitar residuos negativos
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 600;">${inst.index}</td>
      <td>${formatDateReadable(inst.dueDate)}</td>
      <td class="number-cell text-right" style="font-weight: 600;">${formatCurrency(inst.amount)}</td>
      <td class="number-cell text-right" style="color: var(--text-muted);">${formatCurrency(inst.capital)}</td>
      <td class="number-cell text-right" style="color: var(--text-muted);">${formatCurrency(inst.interest)}</td>
      <td class="number-cell text-right" style="font-family: var(--font-mono);">${formatCurrency(currentBalance)}</td>
    `;
    calcAmortizationTable.appendChild(tr);
  });
}

// Otorgar Préstamo Oficialmente
calcGrantBtn.addEventListener('click', async () => {
  if (!calculatedLoanTemp || !calculatedLoanTemp.clientId) return;
  
  if (confirm(`¿Está seguro de otorgar este préstamo de ${formatCurrency(calculatedLoanTemp.amount)} a ${calculatedLoanTemp.clientName}?`)) {
    try {
      await apiRequest('/loans', {
        method: 'POST',
        body: JSON.stringify(calculatedLoanTemp)
      });
      
      // Resetear calculadora
      calculatorForm.reset();
      document.getElementById('calc-date').value = new Date().toISOString().split('T')[0];
      calcResultCard.classList.add('d-none');
      calcGrantBtn.setAttribute('disabled', 'true');
      calculatedLoanTemp = null;
      
      // Recargar datos e ir a pestaña de Préstamos
      await loadData();
      switchSection('loans');
    } catch (error) {
      alert("Error al otorgar préstamo: " + error.message);
    }
  }
});

// 5.3 GESTIÓN DE CLIENTES
const clientSearch = document.getElementById('client-search');
const clientsTableBody = document.getElementById('clients-table-body');
const clientForm = document.getElementById('client-form');
const addClientBtn = document.getElementById('add-client-btn');

addClientBtn.addEventListener('click', () => {
  document.getElementById('client-modal-title').textContent = "Registrar Nuevo Cliente";
  clientForm.reset();
  clientForm.removeAttribute('data-edit-id');
  openModal('modal-client');
});

// Registrar o editar cliente
clientForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const id = clientForm.getAttribute('data-edit-id');
  const name = document.getElementById('client-name').value.trim();
  const phone = document.getElementById('client-phone').value.trim();
  const email = document.getElementById('client-email').value.trim();
  const notes = document.getElementById('client-notes').value.trim();
  
  if (id) {
    // Editar existente (no soportado en esta demo del backend, pero se mantendría la lógica)
    alert("Edición en el backend próximamente.");
  } else {
    // Nuevo cliente
    try {
      await apiRequest('/clients', {
        method: 'POST',
        body: JSON.stringify({ name, phone, email, notes })
      });
      closeModal('modal-client');
      await loadData();
    } catch (error) {
      alert("Error al guardar cliente: " + error.message);
    }
  }
});

// Filtrar clientes en tiempo real
clientSearch.addEventListener('input', () => {
  renderClientsTable();
});

// Calcular deuda activa de un cliente
function getClientActiveDebt(clientId) {
  let debt = 0;
  state.loans.forEach(loan => {
    if (loan.clientId === clientId && loan.status !== 'paid') {
      debt += loan.remainingBalance;
    }
  });
  return parseFloat(debt.toFixed(2));
}

// Cantidad de préstamos de un cliente
function getClientLoansCount(clientId) {
  return state.loans.filter(l => l.clientId === clientId).length;
}

// Renderizar tabla de clientes
function renderClientsTable() {
  const query = clientSearch.value.toLowerCase().trim();
  clientsTableBody.innerHTML = '';
  
  const filtered = state.clients.filter(client => 
    client.name.toLowerCase().includes(query) || 
    client.phone.includes(query) ||
    client.email.toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    clientsTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No se encontraron clientes registrados.</td></tr>';
    return;
  }

  filtered.forEach(client => {
    const debt = getClientActiveDebt(client.id);
    const count = getClientLoansCount(client.id);
    
    // Calcular historial (activos vs pasados)
    const activeLoans = state.loans.filter(l => l.clientId === client.id && l.status !== 'paid').length;
    const historicalLoans = state.loans.filter(l => l.clientId === client.id && l.status === 'paid').length;
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 600;">
        ${client.name}<br>
        <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal;">
          ${activeLoans} activos, ${historicalLoans} finalizados
        </span>
      </td>
      <td>
        <a href="https://wa.me/${client.phone.replace(/\D/g, '')}?text=Hola%20${encodeURIComponent(client.name.split(' ')[0])}" target="_blank" style="color: #25D366; text-decoration: none; font-weight: 500;">
          <i data-lucide="message-circle" style="width: 14px; height: 14px; vertical-align: middle;"></i> ${client.phone}
        </a>
      </td>
      <td>${client.email}</td>
      <td style="font-family: var(--font-mono); text-align: center;">${count}</td>
      <td class="number-cell text-right" style="font-weight: 600; color: ${debt > 0 ? 'var(--danger)' : 'var(--success)'};">${formatCurrency(debt)}</td>
      <td class="text-right">
        <div style="display: flex; gap: 0.25rem; justify-content: flex-end;">
          <button class="btn btn-secondary btn-sm" onclick="viewClientDetail('${client.id}')" title="Ver Perfil">
            <i data-lucide="eye" style="width: 14px; height: 14px;"></i>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="editClient('${client.id}')" title="Editar">
            <i data-lucide="pencil" style="width: 14px; height: 14px;"></i>
          </button>
          <button class="btn btn-danger btn-sm" onclick="promptDeleteAuth('${client.id}', 'client')" style="padding: 0.25rem 0.5rem;" title="Eliminar Cliente">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
          </button>
        </div>
      </td>
    `;
    clientsTableBody.appendChild(tr);
  });
  
  lucide.createIcons();
}

// Editar cliente modal
function editClient(id) {
  const client = state.clients.find(c => c.id === id);
  if (!client) return;
  
  document.getElementById('client-modal-title').textContent = "Editar Cliente";
  document.getElementById('client-name').value = client.name;
  document.getElementById('client-phone').value = client.phone;
  document.getElementById('client-email').value = client.email;
  document.getElementById('client-notes').value = client.notes || '';
  
  clientForm.setAttribute('data-edit-id', id);
  openModal('modal-client');
}

// Ver perfil y ficha de cliente
function viewClientDetail(id) {
  const client = state.clients.find(c => c.id === id);
  if (!client) return;
  
  currentClientId = id;
  
  document.getElementById('client-detail-name').textContent = client.name;
  document.getElementById('client-detail-phone').innerHTML = `<a href="https://wa.me/${client.phone.replace(/\D/g, '')}?text=Hola%20${encodeURIComponent(client.name.split(' ')[0])}" target="_blank" style="color: #25D366; text-decoration: none; font-weight: 500;"><i data-lucide="message-circle" style="width: 14px; height: 14px; vertical-align: middle;"></i> ${client.phone}</a>`;
  document.getElementById('client-detail-email').textContent = client.email;
  
  const debt = getClientActiveDebt(id);
  document.getElementById('client-detail-debt').textContent = formatCurrency(debt);
  document.getElementById('client-detail-debt').style.color = debt > 0 ? 'var(--danger)' : 'var(--success)';
  document.getElementById('client-detail-notes').textContent = client.notes || 'Ninguna nota cargada.';
  
  const kycBadge = document.getElementById('client-detail-kyc');
  if (kycBadge) {
    if (client.kycStatus === 'verified') {
      kycBadge.innerHTML = '<span class="badge badge-success"><i data-lucide="check-circle" style="width:12px;height:12px;vertical-align:middle;"></i> Verificado</span>';
    } else {
      kycBadge.innerHTML = '<span class="badge badge-warning">Pendiente</span>';
    }
  }
  
  const startKycBtn = document.getElementById('start-kyc-btn');
  if (startKycBtn) {
    startKycBtn.onclick = () => openKycModal(client.id);
  }
  
  // Renderizar historial de préstamos del cliente
  const clientLoans = state.loans.filter(l => l.clientId === id);

  // Calcular Perfil de Riesgo
  let riskLevel = 'Sin Historial';
  let riskColor = 'var(--text-muted)';
  if (clientLoans.length > 0) {
    const hasOverdue = clientLoans.some(l => l.status === 'overdue' || l.instalments.some(inst => inst.status === 'overdue'));
    const hasPaid = clientLoans.some(l => l.status === 'paid');
    
    if (hasOverdue) {
      riskLevel = 'Alto (Moroso)';
      riskColor = 'var(--danger)';
    } else if (hasPaid) {
      riskLevel = 'Bajo (Excelente)';
      riskColor = 'var(--success)';
    } else {
      riskLevel = 'Medio (Activo)';
      riskColor = 'var(--warning)';
    }
  }
  const riskEl = document.getElementById('client-detail-risk');
  if (riskEl) {
    riskEl.textContent = riskLevel;
    riskEl.style.color = riskColor;
  }

  const listContainer = document.getElementById('client-detail-loans-list');
  listContainer.innerHTML = '';
  
  if (clientLoans.length === 0) {
    listContainer.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">El cliente no registra préstamos.</td></tr>';
  } else {
    clientLoans.forEach(loan => {
      let statusBadge = '';
      if (loan.status === 'paid') statusBadge = '<span class="badge badge-success">Pagado</span>';
      else if (loan.status === 'overdue') statusBadge = '<span class="badge badge-danger">Vencido</span>';
      else statusBadge = '<span class="badge badge-primary">Activo</span>';
      
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family: var(--font-mono); font-size: 0.8rem;">${loan.id}</td>
        <td class="number-cell">${formatCurrency(loan.amount)}</td>
        <td class="number-cell">${formatCurrency(loan.interestAmount)}</td>
        <td class="number-cell" style="font-weight: 600;">${formatCurrency(loan.remainingBalance)}</td>
        <td>${statusBadge}</td>
        <td class="text-right">
          <button class="btn btn-secondary btn-sm" onclick="closeModal('modal-client-detail'); viewLoanDetail('${loan.id}')">
            <i data-lucide="eye" style="width: 12px; height: 12px;"></i> Ver Ficha
          </button>
        </td>
      `;
      listContainer.appendChild(tr);
    });
  }
  
  openModal('modal-client-detail');
  
  // KYC Documents viewer
  const kycPanel = document.getElementById('client-kyc-docs-panel');
  const selfieImg = document.getElementById('client-kyc-selfie');
  const docImg = document.getElementById('client-kyc-document');
  
  if (client.kycStatus === 'verified' && (client.selfieUrl || client.idDocumentUrl)) {
    if (kycPanel) kycPanel.style.display = 'block';
    if (selfieImg && client.selfieUrl) {
      selfieImg.src = client.selfieUrl;
      selfieImg.style.display = 'block';
    } else if (selfieImg) {
      selfieImg.style.display = 'none';
    }
    if (docImg && client.idDocumentUrl) {
      docImg.src = client.idDocumentUrl;
      docImg.style.display = 'block';
    } else if (docImg) {
      docImg.style.display = 'none';
    }
  } else {
    if (kycPanel) kycPanel.style.display = 'none';
  }
  
  lucide.createIcons();
}

// 5.4 GESTIÓN DE PRÉSTAMOS
const loanSearch = document.getElementById('loan-search');
const loanStatusFilter = document.getElementById('loan-status-filter');
const loansTableBody = document.getElementById('loans-table-body');

loanSearch.addEventListener('input', () => renderLoansTable());
loanStatusFilter.addEventListener('change', () => renderLoansTable());

// Renderizar tabla de préstamos generales
function renderLoansTable() {
  const query = loanSearch.value.toLowerCase().trim();
  const statusFilter = loanStatusFilter.value;
  
  loansTableBody.innerHTML = '';
  
  // Filtrar
  let filtered = state.loans.filter(loan => {
    const matchesSearch = loan.clientName.toLowerCase().includes(query) || loan.id.toLowerCase().includes(query);
    const matchesStatus = statusFilter === 'all' || loan.status === statusFilter;
    return matchesSearch && matchesStatus;
  });
  
  // Ordenar por ID o fecha (por defecto descendente para ver los más nuevos primero)
  filtered.reverse();

  if (filtered.length === 0) {
    loansTableBody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No se encontraron préstamos.</td></tr>';
    return;
  }

  filtered.forEach(loan => {
    let statusBadge = '';
    if (loan.status === 'paid') statusBadge = '<span class="badge badge-success">Pagado</span>';
    else if (loan.status === 'overdue') statusBadge = '<span class="badge badge-danger">Vencido</span>';
    else statusBadge = '<span class="badge badge-primary">Activo</span>';

    // Próxima cuota pendiente
    const nextInst = loan.instalments.find(inst => inst.status !== 'paid');
    const nextPayText = nextInst ? `${formatDateReadable(nextInst.dueDate)} (Cuota ${nextInst.index})` : 'Ninguna';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 500;">${loan.id}</td>
      <td style="font-weight: 600;">${loan.clientName}</td>
      <td class="number-cell">${formatCurrency(loan.amount)}</td>
      <td class="number-cell" style="color: var(--text-muted);">${formatCurrency(loan.interestAmount)}</td>
      <td class="number-cell" style="font-weight: 700; color: ${loan.remainingBalance > 0 ? 'var(--text)' : 'var(--success)'}">${formatCurrency(loan.remainingBalance)}</td>
      <td style="font-size: 0.85rem;">${nextPayText}</td>
      <td>${statusBadge}</td>
      <td class="text-right">
        <button class="btn btn-secondary btn-sm" onclick="viewLoanDetail('${loan.id}')">
          <i data-lucide="eye" style="width: 14px; height: 14px;"></i> Detalle / Cobro
        </button>
      </td>
    `;
    loansTableBody.appendChild(tr);
  });
  
  lucide.createIcons();
}

// Ver ficha detallada de un Préstamo
function viewLoanDetail(loanId) {
  const loan = state.loans.find(l => l.id === loanId);
  if (!loan) return;
  
  document.getElementById('loan-detail-id').textContent = loan.id;
  document.getElementById('loan-detail-client').textContent = loan.clientName;
  document.getElementById('loan-detail-date').textContent = formatDateReadable(loan.startDate);
  
  const client = state.clients.find(c => c.id === loan.clientId);
  const photoContainer = document.getElementById('loan-detail-client-photo-container');
  if (client && client.kycStatus === 'verified' && client.kycPhoto) {
    document.getElementById('loan-detail-client-photo').src = client.kycPhoto;
    document.getElementById('loan-detail-client-name-photo').textContent = client.name;
    photoContainer.style.display = 'flex';
  } else {
    photoContainer.style.display = 'none';
  }
  
  const typeName = loan.type === 'french' ? 'Sistema Francés' : (loan.type === 'german' ? 'Sistema Alemán' : 'Interés Simple');
  document.getElementById('loan-detail-type').textContent = typeName;
  
  const freqName = FREQUENCIES[loan.frequency].name;
  document.getElementById('loan-detail-frequency').textContent = `${freqName} (${loan.term} cuotas)`;
  
  // Calcular APR (Tasa Anual Equivalente)
  let termInYears = loan.term / 12; // default monthly
  if (loan.frequency === 'weekly') termInYears = loan.term / 52;
  else if (loan.frequency === 'biweekly') termInYears = loan.term / 24;
  else if (loan.frequency === 'daily') termInYears = loan.term / 365;
  
  const apr = ((loan.interestAmount / loan.amount) / termInYears) * 100;
  const aprEls = document.querySelectorAll('#loan-detail-apr');
  aprEls.forEach(el => el.textContent = `${apr.toFixed(2)}%`);
  
  document.getElementById('loan-detail-amount').textContent = formatCurrency(loan.amount);
  document.getElementById('loan-detail-interest-amount').textContent = formatCurrency(loan.interestAmount);
  
  // Calcular total pagado (sumando pagos)
  let totalPaid = 0;
  loan.instalments.forEach(inst => totalPaid += inst.paid);
  
  document.getElementById('loan-detail-paid-amount').textContent = formatCurrency(totalPaid);
  document.getElementById('loan-detail-remaining-amount').textContent = formatCurrency(loan.remainingBalance);
  
  // Badge de Estado del Préstamo
  const badge = document.getElementById('loan-detail-status-badge');
  badge.className = 'badge';
  if (loan.status === 'paid') {
    badge.classList.add('badge-success');
    badge.textContent = 'Pagado';
  } else if (loan.status === 'overdue') {
    badge.classList.add('badge-danger');
    badge.textContent = 'Vencido';
  } else {
    badge.classList.add('badge-primary');
    badge.textContent = 'Activo';
  }

  // Renderizar tabla de cuotas
  const tbody = document.getElementById('loan-detail-payments-table');
  tbody.innerHTML = '';
  
  loan.instalments.forEach(inst => {
    let instStatusBadge = '';
    if (inst.status === 'paid') instStatusBadge = '<span class="badge badge-success">Pagado</span>';
    else if (inst.status === 'overdue') instStatusBadge = '<span class="badge badge-danger">Vencido</span>';
    else instStatusBadge = '<span class="badge badge-warning">Pendiente</span>';

    // Botón de acción para cobrar cuota
    let actionBtn = '';
    if (inst.status !== 'paid') {
      actionBtn = `<button class="btn btn-primary btn-sm" onclick="openPayCuotaModal('${loan.id}', ${inst.index})">
        <i data-lucide="hand-coins" style="width: 12px; height: 12px;"></i> Cobrar
      </button>`;
    } else {
      actionBtn = `<div style="display:flex;gap:4px;justify-content:flex-end;">
        <button class="btn btn-secondary btn-sm" disabled>
          <i data-lucide="check" style="width: 12px; height: 12px;"></i> Pagado
        </button>
        <button class="btn btn-primary btn-sm" onclick="printReceipt('${loan.id}', ${inst.index})" title="Imprimir Recibo">
          <i data-lucide="printer" style="width: 12px; height: 12px;"></i>
        </button>
        ${hasFeature('allow_whatsapp') ? `<button class="btn btn-success btn-sm" onclick="sendWhatsAppReceipt('${loan.id}', ${inst.index})" title="Enviar por WhatsApp" style="background-color: #25D366; border-color: #25D366;">
          <i data-lucide="message-circle" style="width: 12px; height: 12px;"></i>
        </button>` : ''}
      </div>`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 600;">${inst.index}</td>
      <td>${formatDateReadable(inst.dueDate)}</td>
      <td class="number-cell text-right" style="font-weight: 600;">${formatCurrency(inst.amount)}</td>
      <td class="number-cell text-right" style="color: var(--text-muted);">${formatCurrency(inst.capital)}</td>
      <td class="number-cell text-right" style="color: var(--text-muted);">${formatCurrency(inst.interest)}</td>
      <td class="number-cell text-right" style="color: var(--success); font-weight: 500;">${formatCurrency(inst.paid)}</td>
      <td>${instStatusBadge}</td>
      <td class="text-right">${actionBtn}</td>
    `;
    tbody.appendChild(tr);
  });
  
  // Mostrar u ocultar botón de contrato según el plan
  const canUseDocs = hasFeature('allow_documents');
  ['btn-contract-pdf', 'btn-contract-pdf-2'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = canUseDocs ? '' : 'none';
  });
  
  openModal('modal-loan-detail');
  lucide.createIcons();
}

// 5.5 REGISTRO DE PAGOS / COBROS
const payCuotaForm = document.getElementById('pay-cuota-form');

function openPayCuotaModal(loanId, cuotaIndex) {
  const loan = state.loans.find(l => l.id === loanId);
  if (!loan) return;
  
  const inst = loan.instalments.find(i => i.index === cuotaIndex);
  if (!inst) return;
  
  document.getElementById('pay-loan-id').value = loanId;
  document.getElementById('pay-cuota-index').value = cuotaIndex;
  
  document.getElementById('pay-client-name').textContent = loan.clientName;
  document.getElementById('pay-cuota-num').textContent = `Cuota Nº ${inst.index} de ${loan.term}`;
  document.getElementById('pay-suggested-amount').textContent = formatCurrency(inst.amount);
  document.getElementById('pay-previous-paid').textContent = formatCurrency(inst.paid);
  
  const remainingInCuota = parseFloat((inst.amount - inst.paid).toFixed(2));
  document.getElementById('pay-remaining-amount').textContent = formatCurrency(remainingInCuota);
  
  // Sugerir saldo pendiente en el input
  document.getElementById('pay-amount-input').value = remainingInCuota;
  document.getElementById('pay-amount-input').max = remainingInCuota; // Opcional, pero se permiten abonos directos
  document.getElementById('pay-date-input').value = new Date().toISOString().split('T')[0];
  
  const client = state.clients.find(c => c.id === loan.clientId);
  const emailGroup = document.getElementById('pay-email-group');
  const emailCheckbox = document.getElementById('pay-send-email-checkbox');
  if (client && client.email) {
    emailGroup.style.display = 'block';
    emailCheckbox.checked = true;
  } else {
    emailGroup.style.display = 'none';
    emailCheckbox.checked = false;
  }
  
  // Cerrar el modal detalle del préstamo momentáneamente para evitar apilamiento visual confuso, o dejar que se apile.
  // Es mejor cerrar el detalle y que al guardar el pago volvamos a abrirlo.
  closeModal('modal-loan-detail');
  openModal('modal-pay-cuota');
}

payCuotaForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const loanId = document.getElementById('pay-loan-id').value;
  const cuotaIndex = parseInt(document.getElementById('pay-cuota-index').value);
  
  const method = document.getElementById('pay-method-select') ? document.getElementById('pay-method-select').value : 'cash';
  const payAmount = parseFloat(document.getElementById('pay-amount-input').value);
  const payDate = document.getElementById('pay-date-input').value;
  const sendEmail = document.getElementById('pay-send-email-checkbox').checked;
  
  let paymentData = {
    loanId,
    instalmentIdx: cuotaIndex,
    amount: payAmount,
    date: payDate,
    method: method
  };

  if (method === 'card') {
    paymentData.card = {
      number: document.getElementById('pay-card-number').value,
      exp: document.getElementById('pay-card-exp').value,
      cvv: document.getElementById('pay-card-cvv').value
    };
  }

  try {
    await apiRequest('/payments', {
      method: 'POST',
      body: JSON.stringify(paymentData)
    });
    
    if (sendEmail) {
      const loan = state.loans.find(l => l.id === loanId);
      const client = state.clients.find(c => c.id === loan.clientId);
      const companyName = window.appSettings.companyName || 'PréstamosApp';
      const smtpUser = document.getElementById('smtp-user') ? document.getElementById('smtp-user').value : '';
      const smtpPass = document.getElementById('smtp-pass') ? document.getElementById('smtp-pass').value : '';
      
      if (client && client.email && smtpUser && smtpPass) {
        const textContent = `Hola ${client.name},\n\nAcabamos de registrar tu pago de ${formatCurrency(payAmount)} para la cuota ${cuotaIndex} de tu préstamo #${loan.id.substring(0,8)}.\n\nGracias,\n${companyName}`;
        try {
          await apiRequest('/notify', {
            method: 'POST',
            body: JSON.stringify({
              toEmail: client.email,
              subject: `Recibo de Pago - ${companyName}`,
              text: textContent,
              html: textContent.replace(/\n/g, '<br>'),
              smtpUser,
              smtpPass
            })
          });
        } catch (err) {
          console.warn('No se pudo enviar el correo: ', err);
        }
      } else if (sendEmail) {
        alert("Atención: Para enviar correos debes configurar tus credenciales SMTP en la pestaña de Configuración.");
      }
    }
    
    closeModal('modal-pay-cuota');
    await loadData();
    viewLoanDetail(loanId);
  } catch (error) {
    alert("Error al procesar pago: " + error.message);
  }
});

function printReceipt(loanId, instIndex) {
  const loan = state.loans.find(l => l.id === loanId);
  if (!loan) return;
  const inst = loan.instalments.find(i => i.index === instIndex);
  if (!inst) return;
  const client = state.clients.find(c => c.id === loan.clientId);
  
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert('La librería PDF no está cargada. Actualiza la página.');
    return;
  }
  
  const doc = new window.jspdf.jsPDF();
  const companyName = window.appSettings.companyName || 'PréstamosApp';
  
  doc.setFontSize(22);
  doc.text(companyName, 105, 20, { align: 'center' });
  doc.setFontSize(16);
  doc.text('Recibo de Pago', 105, 30, { align: 'center' });
  
  doc.setFontSize(12);
  doc.text(`Fecha de Impresión: ${formatDateReadable(new Date().toISOString())}`, 20, 50);
  doc.text(`Cliente: ${client ? client.name : loan.clientName}`, 20, 60);
  doc.text(`Préstamo ID: ${loan.id.substring(0, 8)}`, 20, 70);
  
  doc.text(`Detalle del Pago:`, 20, 90);
  doc.text(`Cuota Nº: ${inst.index} de ${loan.term}`, 30, 100);
  doc.text(`Monto Pagado: ${formatCurrency(inst.paid)}`, 30, 110);
  
  doc.text(`Saldo Restante del Préstamo: ${formatCurrency(loan.remainingBalance)}`, 20, 130);
  
  doc.setFontSize(10);
  doc.text('¡Gracias por su pago!', 105, 150, { align: 'center' });
  
  const filename = `recibo_${loan.id.substring(0,6)}_cuota_${inst.index}.pdf`;
  
  if (window.Capacitor && window.Capacitor.isNativePlatform) {
    if (typeof shareFileApp !== 'undefined') {
      const base64Data = doc.output('datauristring').split(',')[1];
      shareFileApp(base64Data, filename, 'Recibo de Pago');
    } else {
      alert('Funcionalidad de compartir no disponible.');
    }
  } else {
    doc.save(filename);
  }
}

function sendWhatsAppReceipt(loanId, instIndex) {
  const loan = state.loans.find(l => l.id === loanId);
  if (!loan) return;
  const inst = loan.instalments.find(i => i.index === instIndex);
  if (!inst) return;
  const client = state.clients.find(c => c.id === loan.clientId);
  if (!client) return;

  if (!client.phone) {
    alert('El cliente no tiene un número de teléfono registrado.');
    return;
  }

  const companyName = window.appSettings.companyName || 'PréstamosApp';
  let phone = client.phone.replace(/\D/g, '');
  
  const text = `Hola ${client.name},
  
Confirmamos la recepción de tu pago:
*Cuota:* ${instIndex} de ${loan.term}
*Monto pagado:* ${formatCurrency(inst.paid)}
*Fecha:* ${formatDateReadable(new Date().toISOString())}

*Saldo restante del préstamo:* ${formatCurrency(loan.remainingBalance)}

¡Gracias por tu pago!
_${companyName}_`;

  const encodedText = encodeURIComponent(text);
  const waUrl = `https://wa.me/${phone}?text=${encodedText}`;
  window.open(waUrl, '_blank');
}

// --- 6. FUNCIONALIDADES DE AJUSTES Y CONFIGURACIÓN ---

// Alternar Tema (Modo Claro / Oscuro)
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const settingsThemeBtn = document.getElementById('settings-theme-btn');
const themeIcon = document.getElementById('theme-icon');
const themeText = document.getElementById('theme-text');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.theme = theme;
  savePreferences();
  
  // Actualizar botones de la UI
  if (theme === 'dark') {
    themeIcon.setAttribute('data-lucide', 'sun');
    themeText.textContent = "Modo Claro";
    settingsThemeBtn.innerHTML = '<i data-lucide="sun"></i> Tema Claro';
  } else {
    themeIcon.setAttribute('data-lucide', 'moon');
    themeText.textContent = "Modo Oscuro";
    settingsThemeBtn.innerHTML = '<i data-lucide="moon"></i> Tema Oscuro';
  }
  lucide.createIcons();

  // Re-dibujar gráficos si están activos para adaptar colores de fuente
  const activeLink = document.querySelector('.nav-link.active');
  if (activeLink && activeLink.getAttribute('data-target') === 'dashboard') {
    renderDashboard();
  }
}

function toggleTheme() {
  const newTheme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
}

if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);
if (settingsThemeBtn) settingsThemeBtn.addEventListener('click', toggleTheme);

// Exportar base de datos a JSON
const settingsExportBtn = document.getElementById('settings-export-btn');
if (settingsExportBtn) {
  settingsExportBtn.addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `respaldo_prestamos_${dateStr}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });
}

// Importar base de datos
const fileInput = document.getElementById('import-file-input');
const settingsImportBtn = document.getElementById('settings-import-btn');
if (settingsImportBtn && fileInput) {
  settingsImportBtn.addEventListener('click', () => {
    fileInput.click();
  });
}

if (fileInput) {
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
      try {
        const importedState = JSON.parse(evt.target.result);
        // Validaciones simples
        if (Array.isArray(importedState.clients) && Array.isArray(importedState.loans)) {
          state = importedState;
          saveState();
          alert("¡Base de datos restaurada correctamente!");
          fileInput.value = '';
          refreshAll();
        } else {
          alert("El archivo de respaldo no tiene el formato correcto.");
        }
      } catch (e) {
        alert("El archivo no tiene un formato válido.");
      }
    };
    reader.readAsText(file);
  });
}
// --- LÓGICA DE TARJETA ---
const payMethodSelect = document.getElementById('pay-method-select');
const payCashFields = document.getElementById('pay-cash-fields');
const payCardFields = document.getElementById('pay-card-fields');

if (payMethodSelect) {
  payMethodSelect.addEventListener('change', (e) => {
    if(e.target.value === 'card') {
      if(payCashFields) payCashFields.style.display = 'none';
      if(payCardFields) payCardFields.style.display = 'block';
    } else {
      if(payCashFields) payCashFields.style.display = 'block';
      if(payCardFields) payCardFields.style.display = 'none';
    }
  });
}

// --- 7. LÓGICA KYC ---
const kycVideo = document.getElementById('kyc-video');
const kycCanvas = document.getElementById('kyc-canvas');
const kycSnapshot = document.getElementById('kyc-snapshot');
const kycCaptureBtn = document.getElementById('kyc-capture-btn');
const kycRetakeBtn = document.getElementById('kyc-retake-btn');
const kycSubmitBtn = document.getElementById('kyc-submit-btn');
let kycStream = null;

function openKycModal(clientId) {
  document.getElementById('kyc-client-id').value = clientId;
  if(kycSnapshot) kycSnapshot.style.display = 'none';
  if(kycVideo) kycVideo.style.display = 'block';
  if(kycCaptureBtn) kycCaptureBtn.style.display = 'inline-block';
  if(kycRetakeBtn) kycRetakeBtn.style.display = 'none';
  if(kycSubmitBtn) kycSubmitBtn.setAttribute('disabled', 'true');
  
  openModal('modal-kyc');
  startCamera();
}

async function startCamera() {
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      kycStream = await navigator.mediaDevices.getUserMedia({ video: true });
      if(kycVideo) kycVideo.srcObject = kycStream;
    } catch (err) {
      console.error("Error accediendo a cámara: ", err);
      alert("No se pudo acceder a la cámara.");
    }
  }
}

function stopCamera() {
  if (kycStream) {
    kycStream.getTracks().forEach(track => track.stop());
    kycStream = null;
  }
}

if (kycCaptureBtn) {
  kycCaptureBtn.addEventListener('click', () => {
    kycCanvas.width = kycVideo.videoWidth;
    kycCanvas.height = kycVideo.videoHeight;
    kycCanvas.getContext('2d').drawImage(kycVideo, 0, 0);
    const dataUrl = kycCanvas.toDataURL('image/jpeg');
    
    kycSnapshot.src = dataUrl;
    kycVideo.style.display = 'none';
    kycSnapshot.style.display = 'block';
    
    kycCaptureBtn.style.display = 'none';
    kycRetakeBtn.style.display = 'inline-block';
    kycSubmitBtn.removeAttribute('disabled');
  });
}

if (kycRetakeBtn) {
  kycRetakeBtn.addEventListener('click', () => {
    kycSnapshot.style.display = 'none';
    kycVideo.style.display = 'block';
    kycCaptureBtn.style.display = 'inline-block';
    kycRetakeBtn.style.display = 'none';
    kycSubmitBtn.setAttribute('disabled', 'true');
  });
}

let faceApiLoaded = false;
async function loadFaceApi() {
  if (faceApiLoaded) return true;
  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri('models');
    await faceapi.nets.faceLandmark68Net.loadFromUri('models');
    await faceapi.nets.faceRecognitionNet.loadFromUri('models');
    faceApiLoaded = true;
    return true;
  } catch (err) {
    console.error("Error loading faceapi models:", err);
    return false;
  }
}

if (kycSubmitBtn) {
  kycSubmitBtn.addEventListener('click', async () => {
    const clientId = document.getElementById('kyc-client-id').value;
    const client = state.clients.find(c => c.id === clientId);
    if (!client) return;

    const fileInput = document.getElementById('kyc-document-file');
    const docFile = fileInput.files[0];
    
    if (!docFile) {
      alert("Debes adjuntar un documento de identidad para realizar la validación biométrica.");
      return;
    }

    const originalText = kycSubmitBtn.innerHTML;
    kycSubmitBtn.innerHTML = 'Analizando rostro...';
    kycSubmitBtn.disabled = true;

    try {
      const loaded = await loadFaceApi();
      if (!loaded) throw new Error("No se pudo cargar el motor de IA. Revisa tu conexión o los archivos del modelo.");

      const docImg = await faceapi.bufferToImage(docFile);

      // Detect face in selfie
      const selfieDetection = await faceapi.detectSingleFace(kycSnapshot, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
      if (!selfieDetection) throw new Error("No se detectó ningún rostro en la foto tomada (selfie).");

      // Detect face in document
      const docDetection = await faceapi.detectSingleFace(docImg, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
      if (!docDetection) throw new Error("No se detectó ningún rostro en el documento de identidad.");

      const distance = faceapi.euclideanDistance(selfieDetection.descriptor, docDetection.descriptor);
      const threshold = 0.55; 
      if (distance > threshold) {
        throw new Error(`Validación fallida: Los rostros no coinciden (Diferencia: ${distance.toFixed(2)}). Intenta tomar una foto más clara.`);
      }

      // Extraer Base64 del documento para guardar
      const docCanvas = document.createElement('canvas');
      docCanvas.width = docImg.width;
      docCanvas.height = docImg.height;
      const ctx = docCanvas.getContext('2d');
      ctx.drawImage(docImg, 0, 0);
      const docBase64 = docCanvas.toDataURL('image/jpeg', 0.8);

      const res = await fetch(`${API_URL}/clients/${clientId}/kyc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': localStorage.getItem('prestamos_auth_token')
        },
        body: JSON.stringify({ selfieUrl: kycSnapshot.src, idDocumentUrl: docBase64 })
      });
      if (!res.ok) throw new Error('Error al validar la identidad en el servidor.');
      
      client.kycStatus = 'verified';
      client.kycPhoto = kycSnapshot.src;
      
      stopCamera();
      closeModal('modal-kyc');
      renderClientsTable();
      viewClientDetail(clientId);
      alert('¡Verificación KYC Biométrica exitosa!');
    } catch (e) {
      console.error(e);
      alert(e.message);
    } finally {
      kycSubmitBtn.innerHTML = originalText;
      kycSubmitBtn.disabled = false;
    }
  });
}

// Detener cámara si se cierra modal KYC de otra manera
document.querySelectorAll('.close-btn, .btn-secondary').forEach(btn => {
  btn.addEventListener('click', (e) => {
    if (document.getElementById('modal-kyc').classList.contains('active') === false) {
      stopCamera();
    }
  });
});

// Semilla de prueba
document.getElementById('settings-seed-btn').addEventListener('click', () => {
  if (confirm("¿Desea cargar los datos de prueba? Esto sobrescribirá sus datos actuales.")) {
    seedMockData();
  }
});

// Borrar todo
document.getElementById('settings-clear-btn').addEventListener('click', () => {
  if (confirm("¡ATENCIÓN! Esto borrará permanentemente todos sus préstamos y clientes. ¿Desea continuar?")) {
    initializeEmptyState();
    refreshAll();
    alert("Base de datos vaciada.");
  }
});

// --- 7. MODALES Y FUNCIONES HELPER GLOBALES ---

// Abrir Modal
function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

// Cerrar Modal
function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
  // Si cerramos el modal de pago de cuota, volvemos a abrir el detalle del préstamo
  if (modalId === 'modal-pay-cuota') {
    const loanId = document.getElementById('pay-loan-id').value;
    if (loanId) {
      viewLoanDetail(loanId);
    }
  }
}

// Cerrar modales al hacer clic fuera del contenedor
window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
    
    // Comportamiento de retorno para cuotas
    if (e.target.id === 'modal-pay-cuota') {
      const loanId = document.getElementById('pay-loan-id').value;
      if (loanId) viewLoanDetail(loanId);
    }
  }
});

// Refrescar todas las pantallas (en caso de importación/seed)
function refreshAll() {
  populateClientSelect();
  renderClientsTable();
  renderLoansTable();
  renderDashboard();
  applyTheme(state.theme);
}

// Cambiar credenciales
const changeCredentialsForm = document.getElementById('change-credentials-form');
if (changeCredentialsForm) {
  changeCredentialsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newUser = document.getElementById('new-username').value;
    const newPass = document.getElementById('new-password').value;
    const confPass = document.getElementById('confirm-password').value;
    const errorEl = document.getElementById('change-credentials-error');
    
    if (newPass !== confPass) {
      errorEl.textContent = 'Las contraseñas no coinciden';
      errorEl.classList.remove('d-none');
      return;
    }
    
    try {
      await apiRequest('/users/me', {
        method: 'PUT',
        body: JSON.stringify({ newUsername: newUser, newPassword: newPass })
      });
      
      alert('Credenciales actualizadas correctamente. Por favor inicie sesión nuevamente.');
      changeCredentialsForm.reset();
      errorEl.classList.add('d-none');
      
      // Forzar cierre de sesión
      localStorage.removeItem('prestamos_auth_token');
      showLogin();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('d-none');
    }
  });
}

// Enviar Respaldo por Correo
const emailBackupForm = document.getElementById('email-backup-form');
if (emailBackupForm) {
  emailBackupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = emailBackupForm.querySelector('button[type="submit"]');
    const msgEl = document.getElementById('email-backup-msg');
    
    const smtpUser = document.getElementById('smtp-user').value;
    const smtpPass = document.getElementById('smtp-pass').value;
    const toEmail = document.getElementById('backup-email').value;
    
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Enviando...';
    lucide.createIcons();
    msgEl.textContent = '';
    
    try {
      const res = await apiRequest('/backup/email', {
        method: 'POST',
        body: JSON.stringify({ toEmail, smtpUser, smtpPass })
      });
      
      msgEl.style.color = 'var(--success)';
      msgEl.textContent = res.message || 'Respaldo enviado exitosamente.';
      emailBackupForm.reset();
    } catch (err) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = err.message || 'Error al enviar respaldo.';
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="mail"></i> Enviar Respaldo';
      lucide.createIcons();
    }
  });
}

// --- GESTIÓN DE USUARIOS ---
const addUserForm = document.getElementById('add-user-form');
if (addUserForm) {
  addUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usernameInput = document.getElementById('new-user-username');
    const passwordInput = document.getElementById('new-user-password');
    const msgEl = document.getElementById('add-user-msg');
    
    msgEl.textContent = 'Añadiendo...';
    msgEl.style.color = 'var(--text-muted)';
    
    try {
      await apiRequest('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: usernameInput.value,
          password: passwordInput.value
        })
      });
      
      msgEl.textContent = 'Usuario añadido exitosamente.';
      msgEl.style.color = 'var(--success)';
      addUserForm.reset();
      loadUsers(); // Recargar la lista
    } catch (err) {
      msgEl.textContent = err.message || 'Error al añadir usuario.';
      msgEl.style.color = 'var(--danger)';
    }
  });
}

async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;
  
  try {
    const users = await apiRequest('/users');
    tbody.innerHTML = '';
    
    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-center" style="padding: 1rem; color: var(--text-muted);">No hay usuarios adicionales.</td></tr>';
      return;
    }
    
    const currentUser = getCurrentUsername();
    users.forEach(user => {
      const isSelf = user.username === currentUser;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${user.username}</strong></td>
        <td><span style="font-size: 0.8rem; color: var(--text-muted);">${user.companyId}</span></td>
        <td class="text-end">
          <button class="btn btn-sm btn-danger" onclick="deleteUser('${user.username}')" ${isSelf ? 'disabled title="No puedes eliminarte a ti mismo"' : ''}>
            <i data-lucide="trash-2"></i> Eliminar
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
    lucide.createIcons();
  } catch (err) {
    console.error('Error cargando usuarios:', err);
    tbody.innerHTML = '<tr><td colspan="3" class="text-center" style="color: var(--danger);">Error cargando usuarios.</td></tr>';
  }
}

function getCurrentUsername() {
  try {
    const token = getAuthToken();
    if (!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.username || null;
  } catch (e) {
    return null;
  }
}

window.deleteUser = async function(username) {
  if (!confirm(`¿Eliminar el usuario "${username}"? Esta acción no se puede deshacer.`)) return;
  try {
    await apiRequest(`/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    loadUsers();
  } catch (err) {
    alert('Error: ' + err.message);
  }
};

// --- INSTALACIÓN DE LA PWA ---
let deferredPrompt;
const installAppBtn = document.getElementById('install-app-btn');

window.addEventListener('beforeinstallprompt', (e) => {
  // Previene que Chrome 67 y anteriores muestren automáticamente el prompt
  e.preventDefault();
  // Guarda el evento para poder dispararlo después.
  deferredPrompt = e;
  // Muestra el botón de instalación
  if (installAppBtn) installAppBtn.style.display = 'flex';
});

if (installAppBtn) {
  installAppBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    // Oculta nuestro botón proporcionado por la interfaz de usuario
    installAppBtn.style.display = 'none';
    // Muestra el prompt de instalación
    deferredPrompt.prompt();
    // Espera a que el usuario responda al prompt
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    // No podemos volver a usar el prompt, lo descartamos
    deferredPrompt = null;
  });
}

// window.addEventListener('appinstalled', () => {
//   // Limpia el deferredPrompt para el garbage collection
//   deferredPrompt = null;
//   console.log('PWA was installed');
// });

window.promptDeleteAuth = function(targetId, targetType) {
  document.getElementById('delete-target-id').value = targetId;
  document.getElementById('delete-target-type').value = targetType;
  if (targetType === 'client') {
    document.getElementById('delete-auth-warning-text').textContent = 'Esta acción borrará permanentemente a este cliente, TODOS SUS PRÉSTAMOS y todos sus pagos asociados. Ingrese su contraseña de administrador para confirmar.';
  } else {
    document.getElementById('delete-auth-warning-text').textContent = 'Esta acción borrará permanentemente este préstamo y todos sus pagos asociados. Ingrese su contraseña de administrador para confirmar.';
  }
  openModal('modal-delete-auth');
};

const deleteAuthForm = document.getElementById('delete-auth-form');

if (deleteAuthForm) {
  deleteAuthForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('delete-auth-password').value;
    const targetId = document.getElementById('delete-target-id').value;
    const targetType = document.getElementById('delete-target-type').value;
    const errorEl = document.getElementById('delete-auth-error');
    const submitBtn = deleteAuthForm.querySelector('button[type="submit"]');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Verificando...';
    errorEl.classList.add('d-none');

    try {
      if (targetType === 'loan') {
        await apiRequest(`/loans/${targetId}`, { method: 'DELETE', body: JSON.stringify({ password }) });
        closeModal('modal-loan-detail');
        await loadData();
      } else if (targetType === 'client') {
        await apiRequest(`/clients/${targetId}`, { method: 'DELETE', body: JSON.stringify({ password }) });
        closeModal('modal-client-detail');
        await loadData(); // Reloads all clients and loans to update tables
      }

      closeModal('modal-delete-auth');
      deleteAuthForm.reset();
    } catch (err) {
      errorEl.textContent = err.message || 'Contraseña incorrecta o error al eliminar';
      errorEl.classList.remove('d-none');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Eliminar Definitivamente';
    }
  });
}

// --- PERSONALIZACIÓN Y AJUSTES (CONTROL TOTAL) ---
async function loadSettings() {
  try {
    const response = await fetch(API_URL + '/settings');
    const settings = await response.json();
    window.appSettings = settings;
    
    if (settings.companyName) {
      document.getElementById('login-brand-name').textContent = 'Bienvenido a ' + settings.companyName;
      document.getElementById('sidebar-brand-name').textContent = settings.companyName;
      document.title = settings.companyName;
    }
    
    if (settings.companyLogo) {
      const imgHtml = `<img src="${settings.companyLogo}" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px;">`;
      document.getElementById('login-brand-icon').innerHTML = imgHtml;
      document.getElementById('sidebar-brand-icon').innerHTML = imgHtml;
    }

    // Llenar campos de configuración si existen
    if (document.getElementById('company-name-input')) document.getElementById('company-name-input').value = settings.companyName || '';
    if (document.getElementById('company-phone-input')) document.getElementById('company-phone-input').value = settings.companyPhone || '';
    if (document.getElementById('company-address-input')) document.getElementById('company-address-input').value = settings.companyAddress || '';
    if (document.getElementById('currency-symbol-input')) document.getElementById('currency-symbol-input').value = settings.currencySymbol || '$';
    if (document.getElementById('default-interest-input')) document.getElementById('default-interest-input').value = settings.defaultInterest || '';
    
    // Auto-completar tasa de interés por defecto en la calculadora
    const calcRate = document.getElementById('calc-rate');
    if (calcRate && settings.defaultInterest && !calcRate.value) {
      calcRate.value = settings.defaultInterest;
    }
    
    // Al cargar ajustes de moneda, refrescar la interfaz para aplicar el formato
    if (state.loans.length > 0) refreshAll();
  } catch (err) {
    console.error('Error cargando ajustes:', err);
  }
}

const brandForm = document.getElementById('brand-customization-form');
if (brandForm) {
  brandForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('company-name-input').value;
    const phoneInput = document.getElementById('company-phone-input').value;
    const addressInput = document.getElementById('company-address-input').value;
    const fileInput = document.getElementById('company-logo-input').files[0];
    const msgEl = document.getElementById('brand-customization-msg');
    const btn = brandForm.querySelector('button');
    
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    msgEl.textContent = '';
    
    try {
      let base64Logo = undefined;
      if (fileInput) {
        base64Logo = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = error => reject(error);
          reader.readAsDataURL(fileInput);
        });
      }
      
      const payload = {};
      if (nameInput.trim() !== '') payload.companyName = nameInput.trim();
      if (phoneInput.trim() !== '') payload.companyPhone = phoneInput.trim();
      if (addressInput.trim() !== '') payload.companyAddress = addressInput.trim();
      if (base64Logo) payload.companyLogo = base64Logo;
      
      await apiRequest('/settings', { method: 'PUT', body: JSON.stringify(payload) });
      
      msgEl.style.color = 'var(--success)';
      msgEl.textContent = 'Marca actualizada correctamente.';
      
      await loadSettings();
    } catch (err) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = err.message || 'Error al guardar los ajustes';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar Marca';
    }
  });
}

const finForm = document.getElementById('financial-settings-form');
if (finForm) {
  finForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const symbol = document.getElementById('currency-symbol-input').value;
    const interest = document.getElementById('default-interest-input').value;
    const msgEl = document.getElementById('financial-settings-msg');
    const btn = finForm.querySelector('button');
    
    btn.disabled = true;
    msgEl.textContent = '';
    try {
      const payload = {};
      if (symbol.trim() !== '') payload.currencySymbol = symbol.trim();
      if (interest.trim() !== '') payload.defaultInterest = interest.trim();
      
      await apiRequest('/settings', { method: 'PUT', body: JSON.stringify(payload) });
      msgEl.style.color = 'var(--success)';
      msgEl.textContent = 'Ajustes guardados.';
      await loadSettings();
    } catch (err) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
// Descargar copia de base de datos local
if (document.getElementById('download-backup-btn')) document.getElementById('download-backup-btn').addEventListener('click', async () => {
  const btn = document.getElementById('download-backup-btn');
  const msgEl = document.getElementById('download-backup-msg');
  btn.disabled = true;
  msgEl.textContent = 'Generando copia...';
  msgEl.style.color = 'var(--text-muted)';
  
  try {
    const response = await fetch(API_URL + '/backup/download', {
      headers: { 'X-Auth-Token': getAuthToken() }
    });
    
    if (!response.ok) throw new Error('Error al descargar base de datos');
    
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    // Attempt to extract filename from Content-Disposition header
    const contentDisposition = response.headers.get('content-disposition');
    let fileName = 'respaldo.db';
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) fileName = match[1];
    }
    
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    msgEl.textContent = 'Descarga iniciada exitosamente.';
    msgEl.style.color = 'var(--success)';
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.style.color = 'var(--danger)';
  } finally {
    btn.disabled = false;
  }
});

// --- 8. INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
  // Cargar tema
  const savedTheme = localStorage.getItem('prestamos_theme');
  if (savedTheme) {
    applyTheme(savedTheme);
  } else {
    applyTheme('light');
  }

  // Cargar datos principales
  loadData();
  
  // Cargar personalización de marca
  loadSettings();
  
  // Inicializar Lucide Icons
  lucide.createIcons();

  // Bloqueo Biométrico
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeBiometric && localStorage.getItem('prestamos_auth_token')) {
    const lockScreen = document.createElement('div');
    lockScreen.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;background:var(--bg);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);z-index:9999;display:flex;align-items:center;justify-content:center;color:var(--text);font-size:1.5rem;transition:opacity 0.3s ease;";
    lockScreen.innerHTML = '<div style="text-align:center"><i data-lucide="fingerprint" style="width:56px;height:56px;margin-bottom:1rem;color:var(--primary)"></i><br><b style="font-size:1.2rem">App Protegida</b><p style="font-size:0.9rem;color:var(--text-muted);margin-top:0.5rem">Verifica tu identidad para acceder</p></div>';
    document.body.appendChild(lockScreen);
    if(typeof lucide !== 'undefined') lucide.createIcons();

    window.Capacitor.Plugins.NativeBiometric.isAvailable().then(result => {
      if (result.isAvailable) {
        const tryUnlock = () => {
          window.Capacitor.Plugins.NativeBiometric.verifyIdentity({
            reason: "Acceso a PrestamosApp",
            title: "Desbloquear App"
          }).then(() => {
            lockScreen.style.opacity = '0';
            setTimeout(() => lockScreen.remove(), 300);
          }).catch(() => {
            lockScreen.innerHTML = '<div style="text-align:center"><i data-lucide="shield-alert" style="width:56px;height:56px;margin-bottom:1rem;color:var(--danger)"></i><br><b style="font-size:1.2rem">Autenticación Fallida</b><div style="margin-top:1.5rem; display:flex; flex-direction:column; gap:0.75rem;"><button class="btn btn-primary" onclick="window.location.reload()">Reintentar Biometría</button><button class="btn btn-secondary" onclick="localStorage.removeItem(\'prestamos_auth_token\'); localStorage.removeItem(\'prestamos_is_superadmin\'); document.getElementById(\'biometric-lock\').remove(); showLogin();">Usar Contraseña</button></div></div>';
            if(typeof lucide !== 'undefined') lucide.createIcons();
          });
        };
        tryUnlock();
      } else {
        lockScreen.remove();
      }
    }).catch(() => lockScreen.remove());
  }
});

// Manejo de estado de red (Online / Offline)
function updateOnlineStatus() {
  const banner = document.getElementById('offline-banner');
  if (banner) {
    if (navigator.onLine) {
      banner.style.display = 'none';
      document.body.style.paddingTop = '0';
    } else {
      banner.style.display = 'block';
      document.body.style.paddingTop = '30px'; // Espacio para el banner
    }
  }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
// Chequear estado inicial
updateOnlineStatus();

// ============================================
// FUNCIONES ADICIONALES (RECIBOS, EXPORTAR)
// ============================================

function printReceipt(loanId, cuotaIndex) {
  const loan = state.loans.find(l => l.id === loanId);
  if (!loan) return;
  const inst = loan.instalments.find(i => i.index === cuotaIndex);
  if (!inst) return;
  const payment = (inst.payments && inst.payments[0]) ? inst.payments[0] : { date: new Date().toISOString(), amount: inst.amount };
  const companyName = window.appSettings.companyName || 'PréstamosApp';
  
  const receiptHTML = `
    <html>
      <head>
        <title>Recibo de Pago</title>
        <style>
          body { font-family: monospace; font-size: 14px; max-width: 300px; margin: 0 auto; padding: 20px; }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .line { border-top: 1px dashed #000; margin: 10px 0; }
          table { width: 100%; margin-top: 10px; }
          td { padding: 2px 0; }
          .right { text-align: right; }
          @media print {
            body { max-width: 100%; margin: 0; padding: 0; }
            @page { margin: 0; }
          }
        </style>
      </head>
      <body>
        <div class="center bold" style="font-size: 1.2em;">${companyName}</div>
        <div class="center">COMPROBANTE DE PAGO</div>
        <div class="line"></div>
        <table>
          <tr><td>Fecha:</td><td class="right">${formatDateReadable(payment.date)}</td></tr>
          <tr><td>Cliente:</td><td class="right">${loan.clientName}</td></tr>
          <tr><td>Préstamo:</td><td class="right">#${loan.id.substring(0,8)}</td></tr>
          <tr><td>Cuota No:</td><td class="right">${inst.index}</td></tr>
        </table>
        <div class="line"></div>
        <table>
          <tr><td>Capital:</td><td class="right">${formatCurrency(inst.capital)}</td></tr>
          <tr><td>Interés:</td><td class="right">${formatCurrency(inst.interest)}</td></tr>
          <tr class="bold"><td>TOTAL PAGADO:</td><td class="right">${formatCurrency(payment.amount)}</td></tr>
        </table>
        <div class="line"></div>
        <div class="center" style="font-size: 0.9em;">¡Gracias por su pago!</div>
        <div class="center" style="font-size: 0.8em; margin-top: 10px;">Balance Pendiente: ${formatCurrency(loan.remainingBalance)}</div>
        <script>
          setTimeout(() => { window.print(); window.close(); }, 500);
        </script>
      </body>
    </html>
  `;
  
  const printWindow = window.open('', '_blank', 'width=400,height=600');
  if (printWindow) {
    printWindow.document.write(receiptHTML);
    printWindow.document.close();
    printWindow.focus();
  } else {
    alert("Por favor, permite las ventanas emergentes (pop-ups) para imprimir el recibo.");
  }
}

function sendWhatsAppReceipt(loanId, cuotaIndex) {
  const loan = state.loans.find(l => l.id === loanId);
  if (!loan) return;
  const client = state.clients.find(c => c.id === loan.clientId);
  if (!client || !client.phone) {
    alert("El cliente no tiene un número de celular registrado.");
    return;
  }
  const inst = loan.instalments.find(i => i.index === cuotaIndex);
  if (!inst) return;
  const payment = (inst.payments && inst.payments[0]) ? inst.payments[0] : { date: new Date().toISOString(), amount: inst.amount };
  const companyName = window.appSettings.companyName || 'PréstamosApp';
  
  const textMessage = `*RECIBO DE PAGO - ${companyName}*\n` +
    `--------------------------------------\n` +
    `*Fecha:* ${formatDateReadable(payment.date)}\n` +
    `*Cliente:* ${loan.clientName}\n` +
    `*Préstamo:* #${loan.id.substring(0,8)}\n` +
    `*Cuota Nº:* ${inst.index}\n` +
    `--------------------------------------\n` +
    `*Capital:* ${formatCurrency(inst.capital)}\n` +
    `*Interés:* ${formatCurrency(inst.interest)}\n` +
    `*TOTAL PAGADO:* ${formatCurrency(payment.amount)}\n` +
    `--------------------------------------\n` +
    `*Balance Pendiente:* ${formatCurrency(loan.remainingBalance)}\n\n` +
    `¡Gracias por su pago!`;
    
  const cleanPhone = client.phone.replace(/\D/g, '');
  const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(textMessage)}`;
  window.open(waUrl, '_blank');
}

async function shareFileApp(base64Data, filename, title) {
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
    try {
      const { Filesystem, Share } = window.Capacitor.Plugins;
      const result = await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: 'DOCUMENTS',
        recursive: true
      });
      if (Share) {
        await Share.share({ title: title, url: result.uri, dialogTitle: 'Guardar o compartir archivo' });
      } else {
        alert('Archivo guardado en Documentos: ' + filename);
      }
    } catch (e) {
      alert('Error guardando archivo en el dispositivo: ' + e.message);
    }
    return true;
  }
  return false;
}

function downloadCSV(csvContent, filename) {
  if (window.Capacitor && window.Capacitor.isNativePlatform) {
    const base64Data = btoa(unescape(encodeURIComponent(csvContent)));
    shareFileApp(base64Data, filename, 'Exportación CSV');
  } else {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// =========================================================
// IMPORTAR CLIENTES DESDE CSV
// =========================================================
let parsedClientsToImport = [];

function openImportClientsModal() {
  document.getElementById('import-clients-file').value = '';
  document.getElementById('import-clients-preview').style.display = 'none';
  document.getElementById('btn-process-import-clients').disabled = true;
  parsedClientsToImport = [];
  openModal('modal-import-clients');
}

// Escuchar el cambio en el input de archivo para hacer el preview
document.getElementById('import-clients-file')?.addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) {
    document.getElementById('import-clients-preview').style.display = 'none';
    document.getElementById('btn-process-import-clients').disabled = true;
    return;
  }
  
  const reader = new FileReader();
  reader.onload = function(evt) {
    const text = evt.target.result;
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) {
      alert("El archivo no tiene filas suficientes (requiere al menos cabecera y un dato).");
      return;
    }
    
    // Parseo simple de CSV (asumiendo coma como separador y sin comas dentro de los campos por simplicidad)
    const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
    const nameIdx = headers.indexOf('name');
    const phoneIdx = headers.indexOf('phone');
    const emailIdx = headers.indexOf('email');
    const notesIdx = headers.indexOf('notes');
    
    if (nameIdx === -1) {
      alert("El archivo CSV debe contener una columna llamada 'name'.");
      return;
    }
    
    parsedClientsToImport = [];
    for (let i = 1; i < lines.length; i++) {
      // RegEx básico para manejar comas dentro de comillas si las hay
      const row = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || lines[i].split(',');
      const getVal = (idx) => (idx !== -1 && row[idx]) ? row[idx].replace(/^"|"$/g, '').trim() : '';
      
      const client = {
        name: getVal(nameIdx),
        phone: getVal(phoneIdx),
        email: getVal(emailIdx),
        notes: getVal(notesIdx)
      };
      
      if (client.name) {
        parsedClientsToImport.push(client);
      }
    }
    
    const preview = document.getElementById('import-clients-preview');
    if (parsedClientsToImport.length > 0) {
      preview.innerHTML = `<strong>¡Listo para importar!</strong><br>Se han detectado ${parsedClientsToImport.length} clientes válidos en el archivo.`;
      preview.style.display = 'block';
      preview.style.background = 'rgba(var(--success-rgb), 0.1)';
      preview.style.border = '1px solid var(--success)';
      preview.style.color = 'var(--text)';
      document.getElementById('btn-process-import-clients').disabled = false;
    } else {
      preview.innerHTML = `No se detectaron clientes válidos. Revisa el formato.`;
      preview.style.display = 'block';
      preview.style.background = 'rgba(var(--danger-rgb), 0.1)';
      preview.style.border = '1px solid var(--danger)';
      document.getElementById('btn-process-import-clients').disabled = true;
    }
  };
  reader.readAsText(file);
});

async function submitImportClients() {
  if (parsedClientsToImport.length === 0) return;
  
  const btn = document.getElementById('btn-process-import-clients');
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Importando...';
  btn.disabled = true;
  
  try {
    const res = await apiRequest('/clients/bulk', 'POST', { clients: parsedClientsToImport });
    alert(res.message);
    closeModal('modal-import-clients');
    loadClients(); // Recargar la tabla principal
  } catch (err) {
    alert('Error al importar: ' + err.message);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

function exportClientsCSV() {
  const headers = ['ID', 'Nombre', 'Teléfono', 'Correo', 'Notas', 'Fecha Registro'];
  const rows = state.clients.map(c => [
    c.id, c.name, c.phone || '', c.email || '', (c.notes || '').replace(/"/g, '""'), c.createdAt
  ]);
  
  let csvContent = headers.join(',') + '\n';
  rows.forEach(row => {
    csvContent += row.map(cell => `"${cell}"`).join(',') + '\n';
  });
  
  downloadCSV(csvContent, `clientes_${new Date().toISOString().split('T')[0]}.csv`);
}

function exportLoansCSV() {
  const headers = ['ID', 'Cliente', 'Monto Original', 'Tasa (%)', 'Frecuencia', 'Total a Pagar', 'Deuda Restante', 'Estado', 'Fecha Creación'];
  const rows = state.loans.map(l => [
    l.id, l.clientName, l.amount, l.rate, (FREQUENCIES[l.frequency] ? FREQUENCIES[l.frequency].name : null) || l.frequency, l.totalPayable, l.remainingBalance, l.status, l.startDate
  ]);
  
  let csvContent = headers.join(',') + '\n';
  rows.forEach(row => {
    csvContent += row.map(cell => `"${cell}"`).join(',') + '\n';
  });
  
  downloadCSV(csvContent, `prestamos_${new Date().toISOString().split('T')[0]}.csv`);
}

function exportClientsPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) return alert('La librería PDF no se cargó correctamente.');
  const doc = new window.jspdf.jsPDF();
  const headers = [['ID', 'Nombre', 'Teléfono', 'Correo', 'Notas', 'Fecha Registro']];
  const rows = state.clients.map(c => [
    c.id, c.name, c.phone || '', c.email || '', c.notes || '', c.createdAt
  ]);
  doc.text('Lista de Clientes', 14, 15);
  doc.autoTable({ startY: 20, head: headers, body: rows });
  
  const filename = `clientes_${new Date().toISOString().split('T')[0]}.pdf`;
  if (window.Capacitor && window.Capacitor.isNativePlatform) {
    const base64Data = doc.output('datauristring').split(',')[1];
    shareFileApp(base64Data, filename, 'Exportación PDF Clientes');
  } else {
    doc.save(filename);
  }
}

function exportLoansPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) return alert('La librería PDF no se cargó correctamente.');
  const doc = new window.jspdf.jsPDF();
  const headers = [['ID', 'Cliente', 'Monto', 'Tasa', 'Frecuencia', 'Total a Pagar', 'Deuda', 'Estado', 'Fecha']];
  const rows = state.loans.map(l => [
    l.id, l.clientName, l.amount, l.rate + '%', (FREQUENCIES[l.frequency] ? FREQUENCIES[l.frequency].name : null) || l.frequency, l.totalPayable, l.remainingBalance, l.status, l.startDate
  ]);
  doc.text('Lista de Préstamos', 14, 15);
  doc.autoTable({ startY: 20, head: headers, body: rows, styles: { fontSize: 8 } });
  
  const filename = `prestamos_${new Date().toISOString().split('T')[0]}.pdf`;
  if (window.Capacitor && window.Capacitor.isNativePlatform) {
    const base64Data = doc.output('datauristring').split(',')[1];
    shareFileApp(base64Data, filename, 'Exportación PDF Préstamos');
  } else {
    doc.save(filename);
  }
}

// --- LOGICA DE PLANES ---
async function renderPlansSection() {
  try {
    const [companyInfo, plans] = await Promise.all([
      apiRequest('/my-company'),
      apiRequest('/saas/public-plans')
    ]);

    // Actualizar sección de plan actual
    document.getElementById('current-plan-name').textContent = companyInfo.plan || 'Desconocido';
    document.getElementById('current-plan-usage').textContent = companyInfo.current_loans || 0;
    document.getElementById('current-plan-max').textContent = companyInfo.max_loans || 0;

    const statusLabel = companyInfo.status === 'suspended'
      ? 'Suspendida'
      : companyInfo.status === 'active'
        ? 'Activa'
        : (companyInfo.status || 'Activa');
    const statusBadge = companyInfo.status === 'suspended'
      ? 'badge-danger'
      : 'badge-success';
    document.getElementById('current-plan-status').innerHTML = `<span class="badge ${statusBadge}">${statusLabel}</span>`;
    document.getElementById('current-plan-dates').textContent = companyInfo.validUntil
      ? `Válida hasta: ${companyInfo.validUntil}`
      : '';

    // Mostrar banner de activación pendiente si hay un plan pendiente
    let pendingBanner = document.getElementById('pending-activation-banner');
    if (!pendingBanner) {
      pendingBanner = document.createElement('div');
      pendingBanner.id = 'pending-activation-banner';
      const plansSection = document.getElementById('sec-plans');
      const plansH3 = plansSection.querySelector('h3.mb-4');
      if (plansH3) plansH3.before(pendingBanner);
    }
    
    if (companyInfo.pending_plan && companyInfo.activation_token) {
      const pendingPlanInfo = plans.find(p => p.id === companyInfo.pending_plan);
      const pendingPlanName = pendingPlanInfo ? pendingPlanInfo.name : companyInfo.pending_plan;
      pendingBanner.innerHTML = `
        <div class="card mb-4" style="border: 2px solid #22c55e; background: linear-gradient(135deg, rgba(34,197,94,0.1), rgba(34,197,94,0.05));">
          <div class="card-body" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
            <div>
              <h3 style="margin: 0 0 0.25rem; font-size: 1.1rem; color: #22c55e;">
                <i data-lucide="gift" style="width:20px;height:20px;vertical-align:middle;margin-right:0.5rem;"></i>
                ¡Plan Pendiente de Activación!
              </h3>
              <p style="margin: 0; color: var(--text-muted); font-size: 0.9rem;">
                El administrador ha asignado el plan <strong style="color: var(--text);">${pendingPlanName}</strong> a tu cuenta. Haz clic para activarlo.
              </p>
            </div>
            <button onclick="activatePendingPlan('${companyInfo.activation_token}')" 
              class="btn btn-success" 
              style="background: linear-gradient(135deg, #22c55e, #16a34a); padding: 0.75rem 1.5rem; font-weight: 600; white-space: nowrap; border-radius: 0.75rem; box-shadow: 0 4px 15px rgba(34,197,94,0.3);">
              ✨ Activar Plan ${pendingPlanName}
            </button>
          </div>
        </div>
      `;
      lucide.createIcons();
    } else {
      pendingBanner.innerHTML = '';
    }

    const plansContainer = document.getElementById('plans-container');
    plansContainer.innerHTML = '';

    const isSuspended = companyInfo.status === 'suspended';

    plans.forEach(plan => {
      const isCurrent = companyInfo.plan === plan.id;
      const isAvailable = !isSuspended;
      
      const card = document.createElement('div');
      card.className = `card plan-card ${isCurrent ? 'current-plan' : ''}`;
      card.style.cssText = 'display:flex; flex-direction:column; height:100%; border:1px solid var(--border); border-radius:var(--radius-lg); padding:1.5rem; background:var(--card-bg);';
      
      let featuresHtml = '';
      try {
        const feats = typeof plan.features === 'string' ? JSON.parse(plan.features) : (plan.features || []);
        featuresHtml = feats.map(f => `
          <li style="margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem;">
            <i data-lucide="check" style="color: var(--success); width: 16px; height: 16px;"></i>
            <span>${f}</span>
          </li>
        `).join('');
      } catch (e) {
        featuresHtml = `
          <li style="margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem;">
            <i data-lucide="check" style="color: var(--success); width: 16px; height: 16px;"></i>
            <span>Hasta <strong>${plan.max_loans}</strong> préstamos</span>
          </li>
          <li style="margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem;">
            <i data-lucide="check" style="color: var(--success); width: 16px; height: 16px;"></i>
            <span>Hasta <strong>plan.max_users</strong> usuarios</span>
          </li>
        `;
      }

      const CONTACT_PHONE = '809-304-6143';
      const CONTACT_WA = '18093046143';
      const waMsg = `Hola, deseo activar el plan ${plan.name} (RD$ ${Number(plan.price).toLocaleString('es-DO')}/mes) en PrestamosApp. Le envío el capture del pago para activarlo.`;
      const ctaText = isCurrent ? 'Plan Actual' : 'Activar por WhatsApp';
      const ctaClass = isCurrent ? 'btn-secondary' : 'btn-primary';
      const ctaHref = isCurrent
        ? '#'
        : `https://wa.me/${CONTACT_WA}?text=${encodeURIComponent(waMsg)}`;

      card.innerHTML = `
        <div style="flex: 1; display: flex; flex-direction: column;">
          ${isCurrent ? '<span class="badge badge-primary mb-2" style="align-self: flex-start;">Tu Plan Actual</span>' : ''}
          
          <h3 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 0.5rem;">${plan.name}</h3>
          <div style="display: flex; align-items: baseline; gap: 0.25rem; margin-bottom: 1rem;">
            <span style="font-size: 2.5rem; font-weight: 800; color: var(--primary);">RD$ ${Number(plan.price).toLocaleString('es-DO')}</span>
            <span style="font-size: 0.9rem; color: var(--text-muted);">/mes</span>
          </div>
          
          <ul style="list-style: none; padding: 0; margin: 0 0 1.5rem; flex: 1;">
            ${featuresHtml}
          </ul>
          
          <div style="border-top: 1px solid var(--border); padding-top: 1rem; margin-top: auto;">
            <a href="${ctaHref}" target="_blank" class="btn ${ctaClass}" style="width: 100%; text-align: center; display: block; padding: 0.75rem; ${isCurrent ? 'pointer-events: none; opacity: 0.9;' : ''}">
              ${ctaText}
            </a>
            ${isCurrent ? '' : `<p style="margin: 0.75rem 0 0; font-size: 0.8rem; color: var(--text-muted); text-align: center; line-height: 1.4;">Escribe al <strong style="color: var(--text);">${CONTACT_PHONE}</strong> y envía el <strong style="color: var(--text);">capture del pago</strong> para activar tu plan.</p>`}
          </div>
        </div>
      `;
      plansContainer.appendChild(card);
    });
    lucide.createIcons();
  } catch (err) {
    console.error('Error cargando planes:', err);
  }
}

// --- LOGICA SUPER ADMIN ---
async function renderSuperAdminSection() {
  try {
    const [companies, plans] = await Promise.all([
      apiRequest('/saas/companies'),
      apiRequest('/saas/public-plans')
    ]);
    
    // Render companies
    const tbody = document.getElementById('saas-companies-tbody');
    tbody.innerHTML = '';
    companies.forEach(comp => {
      const isDefault = comp.id === 'comp_default';
      const tr = document.createElement('tr');
      const isActive = comp.status === 'active';

      // Check if subscription is expired
      const today = new Date().toISOString().split('T')[0];
      const isExpired = comp.validUntil && comp.validUntil < today;
      
      let planOptions = plans.map(p => `<option value="${p.id}" ${comp.plan === p.id ? 'selected' : ''}>${p.name}</option>`).join('');
      
      tr.innerHTML = `
        <td>
          <strong>${comp.name}</strong>
          <br><small style="color:var(--text-muted);font-size:0.75rem">ID: ${comp.id}</small>
        </td>
        <td>
          <span class="badge ${isActive && !isExpired ? 'badge-success' : 'badge-danger'}" style="font-size:0.78rem">
            ${isActive && !isExpired ? '✅ Activo' : isExpired ? '⏰ Vencido' : '🔴 Suspendido'}
          </span>
        </td>
        <td>
          <select class="form-select form-select-sm" onchange="changeCompanyPlan('${comp.id}', this.value)" ${isDefault ? 'disabled' : ''}>
            ${planOptions}
          </select>
        </td>
        <td style="font-size:0.88rem;${isExpired ? 'color:var(--danger)' : ''}">${comp.validUntil || '-'}</td>
        <td>
          <div style="display:flex; gap:0.3rem; flex-direction:column; font-size:0.82rem;">
            <span>👥 ${comp.clientCount} clientes</span>
            <span>💰 ${comp.loanCount} préstamos</span>
          </div>
        </td>
        <td style="white-space:nowrap;">
          <div style="display:flex;gap:0.4rem;flex-wrap:wrap;justify-content:flex-end;">
            ${!isDefault ? `
            <button class="btn btn-sm" style="background:var(--primary);color:#fff;font-size:0.78rem;padding:0.3rem 0.6rem;"
              onclick="showActivatePlanModal('${comp.id}', '${comp.plan}')" title="Activar / Renovar Plan">
              🔗 Activar Plan
            </button>` : ''}
            <button class="btn btn-sm" style="background:${isActive ? '#f59e0b' : '#22c55e'};color:#fff;font-size:0.78rem;padding:0.3rem 0.6rem;"
              onclick="showToggleStatusModal('${comp.id}', '${comp.status}', '${comp.name}')" ${isDefault ? 'disabled' : ''}
              title="${isActive ? 'Suspender' : 'Activar'} empresa">
              ${isActive ? '⏸ Suspender' : '▶ Activar'}
            </button>
            ${!isDefault ? `
            <button class="btn btn-sm" style="background:#ef4444;color:#fff;font-size:0.78rem;padding:0.3rem 0.5rem;"
              onclick="showDeleteCompanyModal('${comp.id}', '${comp.name}')" title="Eliminar empresa">
              🗑️
            </button>` : ''}
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Render plans
    const ptbody = document.getElementById('saas-plans-tbody');
    ptbody.innerHTML = '';
    plans.forEach(plan => {
      const feats = [];
      if(plan.allow_documents) feats.push('Docs');
      if(plan.allow_guarantees) feats.push('Garantías');
      if(plan.allow_expenses) feats.push('Gastos');
      if(plan.allow_banks) feats.push('Bancos');
      if(plan.allow_cash) feats.push('Caja');
      if(plan.allow_denominations) feats.push('Cuadre');
      if(plan.allow_finances) feats.push('Finanzas');
      if(plan.allow_whatsapp) feats.push('WA');
      if(plan.allow_debugger) feats.push('Depurador');
      
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${plan.name}</strong></td>
        <td>$${plan.price}</td>
        <td>${plan.max_loans}</td>
        <td>${plan.max_users}</td>
        <td style="font-size:0.75rem; color:var(--text-muted); max-width:150px;">
          ${feats.length > 0 ? feats.join(', ') : 'Ninguno'}
        </td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-primary" onclick='openPlanModal(${JSON.stringify(plan)})'><i data-lucide="edit"></i></button>
          <button class="btn btn-sm btn-outline-danger" onclick="deletePlan('${plan.id}')"><i data-lucide="trash-2"></i></button>
        </td>
      `;
      ptbody.appendChild(tr);
    });
    
    lucide.createIcons();
  } catch (err) {
    console.error(err);
  }
}

// ═══════════════════════════════════════════════════
// HELPER: Modal de acción genérico para administración
// ═══════════════════════════════════════════════════
function showAdminModal(html, onClose) {
  const id = 'sa-modal-' + Date.now();
  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.65);padding:1rem;animation:fadeIn .15s ease';
  overlay.innerHTML = `<div style="background:var(--bg-card,#1e293b);border:1px solid var(--border,#334155);border-radius:1rem;padding:2rem;max-width:460px;width:100%;box-shadow:0 24px 48px rgba(0,0,0,0.5);">${html}</div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); if (onClose) onClose(); } });
  document.body.appendChild(overlay);
  return overlay;
}
function closeAdminModal() {
  document.querySelectorAll('[id^="sa-modal-"]').forEach(el => el.remove());
}
function saToast(msg, ok = true) {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:1.5rem;right:1.5rem;z-index:10000;background:${ok?'#22c55e':'#ef4444'};color:#fff;padding:.75rem 1.25rem;border-radius:.75rem;font-weight:600;font-size:.9rem;box-shadow:0 4px 16px rgba(0,0,0,.35);animation:slideUp .2s ease`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ─── Cambiar plan desde el select ───
window.changeCompanyPlan = async function(companyId, newPlan) {
  try {
    await apiRequest('/saas/companies/' + companyId + '/plan', {
      method: 'PUT', body: JSON.stringify({ plan: newPlan })
    });
    saToast('✅ Plan actualizado correctamente');
    renderSuperAdminSection();
  } catch (err) {
    saToast('❌ Error: ' + err.message, false);
  }
};

// ─── MODAL: Suspender empresa ───
window.showToggleStatusModal = function(companyId, currentStatus, companyName) {
  if (currentStatus === 'active') {
    // Suspender
    showAdminModal(`
      <div style="text-align:center;margin-bottom:1.5rem">
        <div style="font-size:2.5rem;margin-bottom:.75rem">⏸️</div>
        <h3 style="margin:0 0 .5rem;font-size:1.15rem">Suspender Empresa</h3>
        <p style="color:var(--text-muted,#94a3b8);margin:0;font-size:.9rem">¿Deseas suspender a <strong style="color:var(--text,#f1f5f9)">${companyName}</strong>?<br>No podrán ingresar al sistema.</p>
      </div>
      <div style="display:flex;gap:.75rem">
        <button onclick="closeAdminModal()" style="flex:1;padding:.65rem;border-radius:.6rem;border:1px solid var(--border,#334155);background:transparent;color:var(--text,#f1f5f9);cursor:pointer;font-weight:600">Cancelar</button>
        <button id="sa-confirm-btn" onclick="execSuspend('${companyId}')" style="flex:1;padding:.65rem;border-radius:.6rem;border:none;background:#f59e0b;color:#fff;cursor:pointer;font-weight:700">⏸ Suspender</button>
      </div>
    `);
  } else {
    // Activar (con meses)
    showAdminModal(`
      <div style="text-align:center;margin-bottom:1.5rem">
        <div style="font-size:2.5rem;margin-bottom:.75rem">▶️</div>
        <h3 style="margin:0 0 .5rem;font-size:1.15rem">Activar / Renovar Acceso</h3>
        <p style="color:var(--text-muted,#94a3b8);margin:0;font-size:.9rem">Empresa: <strong style="color:var(--text,#f1f5f9)">${companyName}</strong></p>
      </div>
      <div style="margin-bottom:1.25rem">
        <label style="display:block;font-size:.85rem;color:var(--text-muted,#94a3b8);margin-bottom:.4rem;font-weight:600">¿Por cuántos meses?</label>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.75rem">
          ${[1,2,3,6,12].map(m => `<button onclick="document.getElementById('sa-months').value=${m};document.querySelectorAll('.months-quick').forEach(b=>b.style.background='var(--bg,#0f172a)');this.style.background='var(--primary,#3b82f6)'" class="months-quick" style="padding:.4rem .8rem;border-radius:.5rem;border:1px solid var(--border,#334155);background:var(--bg,#0f172a);color:var(--text,#f1f5f9);cursor:pointer;font-weight:600;font-size:.85rem">${m} mes${m>1?'es':''}</button>`).join('')}
        </div>
        <input type="number" id="sa-months" value="1" min="1" max="60" style="width:100%;padding:.55rem .75rem;border-radius:.6rem;border:1px solid var(--border,#334155);background:var(--bg,#0f172a);color:var(--text,#f1f5f9);font-size:.95rem">
      </div>
      <div style="display:flex;gap:.75rem">
        <button onclick="closeAdminModal()" style="flex:1;padding:.65rem;border-radius:.6rem;border:1px solid var(--border,#334155);background:transparent;color:var(--text,#f1f5f9);cursor:pointer;font-weight:600">Cancelar</button>
        <button onclick="execActivate('${companyId}')" style="flex:1;padding:.65rem;border-radius:.6rem;border:none;background:#22c55e;color:#fff;cursor:pointer;font-weight:700">▶ Activar</button>
      </div>
    `);
  }
};

window.execSuspend = async function(companyId) {
  try {
    await apiRequest('/saas/companies/' + companyId + '/status', {
      method: 'PUT', body: JSON.stringify({ status: 'suspended' })
    });
    closeAdminModal();
    saToast('⏸ Empresa suspendida');
    renderSuperAdminSection();
  } catch (err) {
    saToast('❌ Error: ' + err.message, false);
  }
};

window.execActivate = async function(companyId) {
  const months = parseInt(document.getElementById('sa-months')?.value) || 1;
  if (months < 1) { saToast('❌ Ingresa al menos 1 mes', false); return; }
  try {
    const res = await apiRequest('/saas/companies/' + companyId + '/status', {
      method: 'PUT', body: JSON.stringify({ status: 'active', months })
    });
    closeAdminModal();
    saToast('✅ Activado hasta: ' + (res.newValidUntil || ''));
    renderSuperAdminSection();
  } catch (err) {
    saToast('❌ Error: ' + err.message, false);
  }
};

// ─── MODAL: Eliminar empresa ───
window.showDeleteCompanyModal = function(companyId, companyName) {
  showAdminModal(`
    <div style="text-align:center;margin-bottom:1.5rem">
      <div style="font-size:2.5rem;margin-bottom:.75rem">🗑️</div>
      <h3 style="margin:0 0 .5rem;font-size:1.15rem;color:#ef4444">Eliminar Empresa</h3>
      <p style="color:var(--text-muted,#94a3b8);margin:0 0 1rem;font-size:.9rem">Esta acción <strong style="color:#ef4444">no se puede deshacer</strong>.<br>Se eliminarán todos los clientes, préstamos y datos de:<br><strong style="color:var(--text,#f1f5f9)">${companyName}</strong></p>
      <p style="font-size:.85rem;color:var(--text-muted,#94a3b8);margin:0">Escribe el nombre de la empresa para confirmar:</p>
      <input type="text" id="sa-confirm-name" placeholder="${companyName}" style="width:100%;margin-top:.5rem;padding:.55rem .75rem;border-radius:.6rem;border:1px solid var(--border,#334155);background:var(--bg,#0f172a);color:var(--text,#f1f5f9);font-size:.9rem;text-align:center">
    </div>
    <div style="display:flex;gap:.75rem">
      <button onclick="closeAdminModal()" style="flex:1;padding:.65rem;border-radius:.6rem;border:1px solid var(--border,#334155);background:transparent;color:var(--text,#f1f5f9);cursor:pointer;font-weight:600">Cancelar</button>
      <button onclick="execDeleteCompany('${companyId}', '${companyName}')" style="flex:1;padding:.65rem;border-radius:.6rem;border:none;background:#ef4444;color:#fff;cursor:pointer;font-weight:700">🗑️ Eliminar todo</button>
    </div>
  `);
};

window.execDeleteCompany = async function(companyId, expectedName) {
  const typed = document.getElementById('sa-confirm-name')?.value?.trim();
  if (typed !== expectedName) {
    saToast('❌ El nombre no coincide. Operación cancelada.', false);
    return;
  }
  try {
    await apiRequest('/saas/companies/' + companyId, { method: 'DELETE' });
    closeAdminModal();
    saToast('🗑️ Empresa eliminada correctamente');
    renderSuperAdminSection();
  } catch (err) {
    saToast('❌ Error: ' + err.message, false);
  }
};

// ─── MODAL: Generar link de activación de plan ───
window.showActivatePlanModal = async function(companyId, currentPlan) {
  try {
    const plans = await apiRequest('/saas/public-plans');
    const planOptions = plans.map(p =>
      `<option value="${p.id}" ${p.id === currentPlan ? 'selected' : ''}>` +
      `${p.name} — RD$${Number(p.price).toLocaleString('es-DO')}/mes</option>`
    ).join('');

    showAdminModal(`
      <div style="text-align:center;margin-bottom:1.5rem">
        <div style="font-size:2.5rem;margin-bottom:.75rem">🔗</div>
        <h3 style="margin:0 0 .5rem;font-size:1.15rem">Generar Link de Activación</h3>
        <p style="color:var(--text-muted,#94a3b8);margin:0;font-size:.88rem">Selecciona el plan y genera un link para que el cliente lo active.</p>
      </div>
      <div style="margin-bottom:1.25rem">
        <label style="display:block;font-size:.85rem;color:var(--text-muted,#94a3b8);margin-bottom:.4rem;font-weight:600">Plan a asignar:</label>
        <select id="sa-plan-select" style="width:100%;padding:.6rem .75rem;border-radius:.6rem;border:1px solid var(--border,#334155);background:var(--bg,#0f172a);color:var(--text,#f1f5f9);font-size:.9rem">
          ${planOptions}
        </select>
      </div>
      <div id="sa-link-result" style="display:none;background:rgba(0,0,0,.3);border-radius:.5rem;padding:.75rem;word-break:break-all;font-family:monospace;font-size:.8rem;color:#a5b4fc;margin-bottom:1rem"></div>
      <div style="display:flex;gap:.75rem">
        <button onclick="closeAdminModal()" style="flex:1;padding:.65rem;border-radius:.6rem;border:1px solid var(--border,#334155);background:transparent;color:var(--text,#f1f5f9);cursor:pointer;font-weight:600">Cerrar</button>
        <button onclick="execGenerateLink('${companyId}')" style="flex:2;padding:.65rem;border-radius:.6rem;border:none;background:var(--primary,#3b82f6);color:#fff;cursor:pointer;font-weight:700">🔗 Generar Link</button>
      </div>
    `);
  } catch (err) {
    saToast('❌ Error cargando planes: ' + err.message, false);
  }
};

window.execGenerateLink = async function(companyId) {
  const planId = document.getElementById('sa-plan-select')?.value;
  if (!planId) return;
  try {
    const res = await apiRequest('/saas/companies/' + companyId + '/generate-activation', {
      method: 'POST', body: JSON.stringify({ planId })
    });
    const linkDiv = document.getElementById('sa-link-result');
    if (linkDiv) { linkDiv.textContent = res.link; linkDiv.style.display = 'block'; }
    try { await navigator.clipboard.writeText(res.link); saToast('✅ Link copiado al portapapeles'); }
    catch(e) { saToast('🔗 Link generado — cópialo manualmente'); }
  } catch (err) {
    saToast('❌ Error: ' + err.message, false);
  }
};

// Alias para compatibilidad con el código antiguo
window.generateActivationLink = window.showActivatePlanModal;
window.toggleCompanyStatus = function(id, status, name) { window.showToggleStatusModal(id, status, name || id); };
window.deleteCompany = function(id, name) { window.showDeleteCompanyModal(id, name || id); };

window.activatePendingPlan = async function(token) {
  if (!confirm('Deseas activar tu nuevo plan ahora?')) return;
  try {
    var resp = await fetch('/api/activate/' + token);
    var data = await resp.json();
    if (resp.ok && data.success) {
      alert('Plan activado! Valido hasta: ' + (data.validUntil || ''));
      renderPlansSection();
    } else {
      alert(data.error || 'Error al activar el plan.');
    }
  } catch (err) {
    alert('Error de conexion: ' + err.message);
  }
};

// --- SAAS PLANS LOGIC ---
var editingPlanId = null;

window.openPlanModal = function(plan) {
  var form = document.getElementById('saas-plan-form');
  var title = document.getElementById('plan-modal-title');
  if (plan) {
    editingPlanId = plan.id;
    title.textContent = 'Editar Plan SaaS';
    document.getElementById('plan-id').value = plan.id;
    document.getElementById('plan-id').readOnly = true;
    document.getElementById('plan-name').value = plan.name;
    document.getElementById('plan-price').value = plan.price;
    document.getElementById('plan-max-loans').value = plan.max_loans;
    document.getElementById('plan-max-users').value = plan.max_users;
    
    // Checkboxes
    document.getElementById('plan-allow-documents').checked = !!plan.allow_documents;
    document.getElementById('plan-allow-guarantees').checked = !!plan.allow_guarantees;
    document.getElementById('plan-allow-expenses').checked = !!plan.allow_expenses;
    document.getElementById('plan-allow-banks').checked = !!plan.allow_banks;
    document.getElementById('plan-allow-cash').checked = !!plan.allow_cash;
    document.getElementById('plan-allow-denominations').checked = !!plan.allow_denominations;
    document.getElementById('plan-allow-finances').checked = !!plan.allow_finances;
    document.getElementById('plan-allow-whatsapp').checked = !!plan.allow_whatsapp;
    document.getElementById('plan-allow-debugger').checked = !!plan.allow_debugger;
  } else {
    editingPlanId = null;
    form.reset();
    title.textContent = 'Registrar Nuevo Plan';
    document.getElementById('plan-id').readOnly = false;
  }
  document.getElementById('modal-plan').classList.add('active');
};

document.getElementById('saas-plan-form')?.addEventListener('submit', async function(e) {
  e.preventDefault();
  var id = document.getElementById('plan-id').value.trim().toLowerCase();
  var name = document.getElementById('plan-name').value.trim();
  var price = parseFloat(document.getElementById('plan-price').value);
  var max_loans = parseInt(document.getElementById('plan-max-loans').value);
  var max_users = parseInt(document.getElementById('plan-max-users').value);
  
  var payload = {
    id: id, name: name, price: price, max_loans: max_loans, max_users: max_users,
    allow_documents: document.getElementById('plan-allow-documents').checked ? 1 : 0,
    allow_guarantees: document.getElementById('plan-allow-guarantees').checked ? 1 : 0,
    allow_expenses: document.getElementById('plan-allow-expenses').checked ? 1 : 0,
    allow_banks: document.getElementById('plan-allow-banks').checked ? 1 : 0,
    allow_cash: document.getElementById('plan-allow-cash').checked ? 1 : 0,
    allow_denominations: document.getElementById('plan-allow-denominations').checked ? 1 : 0,
    allow_finances: document.getElementById('plan-allow-finances').checked ? 1 : 0,
    allow_whatsapp: document.getElementById('plan-allow-whatsapp').checked ? 1 : 0,
    allow_debugger: document.getElementById('plan-allow-debugger').checked ? 1 : 0
  };

  try {
    var method = editingPlanId ? 'PUT' : 'POST';
    var url = editingPlanId ? '/saas/plans/' + editingPlanId : '/saas/plans';
    await apiRequest(url, { method: method, body: JSON.stringify(payload) });
    closeModal('modal-plan');
    renderSuperAdminSection();
  } catch (err) {
    alert('Error guardando plan: ' + err.message);
  }
});

window.deletePlan = async function(id) {
  if (confirm('Esta seguro de que desea eliminar este plan?')) {
    try {
      await apiRequest('/saas/plans/' + id, { method: 'DELETE' });
      renderSuperAdminSection();
    } catch (err) {
      alert('Error eliminando plan: ' + err.message);
    }
  }
};

// --- MOBILE MENU LOGIC ---
window.toggleMobileMenu = function(e) {
  if (e) e.stopPropagation();
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.classList.toggle('open');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('sidebar');
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  
  if (sidebar) {
    // Cerrar al hacer clic en un enlace
    const navLinks = sidebar.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
          sidebar.classList.remove('open');
        }
      });
    });
    
    // Cerrar al hacer clic fuera
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
        // Si el clic es dentro del sidebar o es en el boton de menu, no cerramos
        if (sidebar.contains(e.target)) return;
        if (mobileMenuBtn && mobileMenuBtn.contains(e.target)) return;
        
        sidebar.classList.remove('open');
      }
    });
  }
});

// ═══════════════════════════════════════════════════
// CERRAR APP & BOTÓN RETROCESO (MÓVIL)
// ═══════════════════════════════════════════════════

window.closeApp = function() {
  if (confirm('¿Desea cerrar sesión y salir de la aplicación?')) {
    localStorage.removeItem('prestamos_auth_token');
    localStorage.removeItem('prestamos_is_superadmin');
    
    // Regresar a la pantalla inicial sin redirigir ni recargar la página
    showLogin();
  }
};

// Insertar un estado artificial para capturar el botón de retroceso del celular
window.addEventListener('load', () => {
  history.pushState({ appOpen: true }, null, location.href);
});

window.addEventListener('popstate', async (e) => {
  // Si el usuario presionó Atrás en su celular
  if (confirm('¿Desea cerrar sesión y volver al inicio?')) {
    localStorage.removeItem('prestamos_auth_token');
    localStorage.removeItem('prestamos_is_superadmin');
    showLogin();
  } else {
    // Si cancela, volvemos a agregar el estado para atrapar el próximo click
    history.pushState({ appOpen: true }, null, location.href);
  }
});

// =========================================================
// NUEVOS MÓDULOS (Garantías, Gastos, Bancos, Caja, Finanzas)
// =========================================================

// --- GARANTÍAS ---
async function loadGuarantees() {
  try {
    const data = await apiRequest('/guarantees');
    const tbody = document.getElementById('guarantees-table-body');
    if(!tbody) return;
    tbody.innerHTML = '';
    if(data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No hay garantías registradas.</td></tr>';
      return;
    }
    data.forEach(g => {
      tbody.innerHTML += `
        <tr>
          <td>${formatDate(g.createdAt)}</td>
          <td>${g.loanId}</td>
          <td>${g.guarantorName}</td>
          <td>${g.guarantorPhone || '-'}</td>
          <td>${g.guarantorId || '-'}</td>
          <td>${g.guarantorAddress || '-'}</td>
          <td>
            <button class="btn btn-sm btn-danger" onclick="deleteGuarantee('${g.id}')">Eliminar</button>
          </td>
        </tr>`;
    });
  } catch(e) { console.error(e); }
}

async function submitGuarantee() {
  try {
    const payload = {
      loanId: document.getElementById('guar-loanId').value,
      guarantorName: document.getElementById('guar-name').value,
      guarantorPhone: document.getElementById('guar-phone').value,
      guarantorId: document.getElementById('guar-id').value,
      guarantorAddress: document.getElementById('guar-address').value,
      notes: document.getElementById('guar-notes').value
    };
    await apiRequest('/guarantees', 'POST', payload);
    closeModal('modal-guarantee-form');
    document.getElementById('form-guarantee').reset();
    loadGuarantees();
    alert('Garantía registrada');
  } catch(e) { alert(e.message); }
}

async function deleteGuarantee(id) {
  if(!confirm('¿Eliminar garantía?')) return;
  try {
    await apiRequest(`/guarantees/${id}`, 'DELETE');
    loadGuarantees();
  } catch(e) { alert(e.message); }
}

// --- GASTOS ---
async function loadExpenses() {
  try {
    const data = await apiRequest('/expenses');
    const tbody = document.getElementById('expenses-table-body');
    if(!tbody) return;
    tbody.innerHTML = '';
    if(data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No hay gastos registrados.</td></tr>';
      return;
    }
    data.forEach(e => {
      tbody.innerHTML += `
        <tr>
          <td>${formatDate(e.date)}</td>
          <td>${e.description}</td>
          <td style="text-transform: capitalize;">${e.category}</td>
          <td>$${e.amount.toFixed(2)}</td>
          <td>
            <button class="btn btn-sm btn-danger" onclick="deleteExpense('${e.id}')">Eliminar</button>
          </td>
        </tr>`;
    });
  } catch(e) { console.error(e); }
}

async function submitExpense() {
  try {
    const payload = {
      description: document.getElementById('exp-description').value,
      amount: document.getElementById('exp-amount').value,
      category: document.getElementById('exp-category').value,
      date: document.getElementById('exp-date').value,
      notes: document.getElementById('exp-notes').value
    };
    await apiRequest('/expenses', 'POST', payload);
    closeModal('modal-expense-form');
    document.getElementById('form-expense').reset();
    loadExpenses();
    alert('Gasto registrado');
  } catch(e) { alert(e.message); }
}

async function deleteExpense(id) {
  if(!confirm('¿Eliminar gasto?')) return;
  try {
    await apiRequest(`/expenses/${id}`, 'DELETE');
    loadExpenses();
  } catch(e) { alert(e.message); }
}

// --- BANCOS ---
async function loadBanks() {
  try {
    const data = await apiRequest('/banks');
    const grid = document.getElementById('banks-grid');
    const select = document.getElementById('btx-account');
    if(!grid || !select) return;
    grid.innerHTML = '';
    select.innerHTML = '';
    if(data.length === 0) {
      grid.innerHTML = '<p class="text-muted">No hay cuentas bancarias registradas.</p>';
      return;
    }
    data.forEach(b => {
      grid.innerHTML += `
        <div class="card" style="border:1px solid var(--border);">
          <div class="card-body">
            <h4 style="margin:0 0 0.5rem 0;">${b.bankName} <span class="text-muted" style="font-size:0.8rem">(${b.accountType})</span></h4>
            <div class="text-muted" style="font-size:0.9rem; margin-bottom: 1rem;">Nº ${b.accountNumber || 'N/A'}</div>
            <div style="font-size: 1.5rem; font-weight: bold; color: ${b.balance >= 0 ? 'var(--success)' : 'var(--danger)'}">
              $${b.balance.toFixed(2)}
            </div>
            <div style="text-align: right; margin-top: 1rem;">
              <button class="btn btn-sm btn-danger" onclick="deleteBank('${b.id}')"><i data-lucide="trash-2"></i></button>
            </div>
          </div>
        </div>`;
      select.innerHTML += `<option value="${b.id}">${b.bankName} - ${b.accountNumber} ($${b.balance.toFixed(2)})</option>`;
    });
    if(window.lucide) lucide.createIcons();
  } catch(e) { console.error(e); }
}

async function submitBank() {
  try {
    const payload = {
      bankName: document.getElementById('bank-name').value,
      accountNumber: document.getElementById('bank-number').value,
      accountType: document.getElementById('bank-type').value,
      balance: document.getElementById('bank-balance').value
    };
    await apiRequest('/banks', 'POST', payload);
    closeModal('modal-bank-form');
    document.getElementById('form-bank').reset();
    loadBanks();
    alert('Cuenta creada');
  } catch(e) { alert(e.message); }
}

async function deleteBank(id) {
  if(!confirm('¿Eliminar esta cuenta bancaria?')) return;
  try {
    await apiRequest(`/banks/${id}`, 'DELETE');
    loadBanks();
  } catch(e) { alert(e.message); }
}

async function loadBankTransactions() {
  try {
    const data = await apiRequest('/bank-transactions');
    const tbody = document.getElementById('bank-transactions-body');
    if(!tbody) return;
    tbody.innerHTML = '';
    if(data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No hay transacciones registradas.</td></tr>';
      return;
    }
    data.forEach(t => {
      const color = (t.type === 'deposito' || t.type === 'ingreso') ? 'var(--success)' : 'var(--danger)';
      const sign = (t.type === 'deposito' || t.type === 'ingreso') ? '+' : '-';
      tbody.innerHTML += `
        <tr>
          <td>${formatDate(t.date)}</td>
          <td>${t.accountId}</td>
          <td style="text-transform: capitalize;">${t.type}</td>
          <td style="color: ${color}; font-weight: bold;">${sign}$${t.amount.toFixed(2)}</td>
          <td>${t.description}</td>
        </tr>`;
    });
  } catch(e) { console.error(e); }
}

async function submitBankTransaction() {
  try {
    const payload = {
      accountId: document.getElementById('btx-account').value,
      type: document.getElementById('btx-type').value,
      amount: document.getElementById('btx-amount').value,
      date: document.getElementById('btx-date').value,
      description: document.getElementById('btx-description').value
    };
    await apiRequest('/bank-transactions', 'POST', payload);
    closeModal('modal-bank-transaction');
    document.getElementById('form-bank-transaction').reset();
    loadBanks();
    loadBankTransactions();
    alert('Movimiento registrado');
  } catch(e) { alert(e.message); }
}

// --- CAJA ---
async function loadCashStatus() {
  try {
    const data = await apiRequest('/cash/current');
    const banner = document.getElementById('cash-status-banner');
    const btnOpen = document.getElementById('btn-open-cash');
    const btnClose = document.getElementById('btn-close-cash');
    if(!banner) return;
    
    if(data) {
      banner.className = 'alert alert-success mb-4';
      banner.innerHTML = `<strong>Caja Abierta</strong> - Abierta el ${formatDate(data.openedAt)} con saldo inicial de $${data.openingBalance.toFixed(2)}`;
      btnOpen.disabled = true;
      btnClose.disabled = false;
    } else {
      banner.className = 'alert alert-warning mb-4';
      banner.innerHTML = `<strong>Caja Cerrada</strong> - Debe abrir caja para registrar movimientos en efectivo de hoy.`;
      btnOpen.disabled = false;
      btnClose.disabled = true;
    }
  } catch(e) { console.error(e); }
}

async function submitOpenCash() {
  try {
    const payload = {
      openingBalance: document.getElementById('cash-open-balance').value,
      notes: document.getElementById('cash-open-notes').value
    };
    await apiRequest('/cash/open', 'POST', payload);
    closeModal('modal-open-cash');
    document.getElementById('form-open-cash').reset();
    loadCashStatus();
    loadCashHistory();
    alert('Caja abierta');
  } catch(e) { alert(e.message); }
}

async function submitCloseCash() {
  try {
    const payload = {
      closingBalance: document.getElementById('cash-close-balance').value,
      notes: document.getElementById('cash-close-notes').value
    };
    const res = await apiRequest('/cash/close', 'PUT', payload);
    closeModal('modal-close-cash');
    document.getElementById('form-close-cash').reset();
    loadCashStatus();
    loadCashHistory();
    alert(`Caja cerrada. Saldo esperado: $${res.expected.toFixed(2)}. Diferencia: $${res.difference.toFixed(2)}`);
  } catch(e) { alert(e.message); }
}

async function loadCashHistory() {
  try {
    const data = await apiRequest('/cash/history');
    const tbody = document.getElementById('cash-history-body');
    if(!tbody) return;
    tbody.innerHTML = '';
    if(data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No hay historial de cajas.</td></tr>';
      return;
    }
    data.forEach(c => {
      const isClosed = c.status === 'closed';
      tbody.innerHTML += `
        <tr>
          <td>${formatDate(c.openedAt)}</td>
          <td>${isClosed ? formatDate(c.closedAt) : '-'}</td>
          <td>$${c.openingBalance.toFixed(2)}</td>
          <td>${isClosed ? '$'+c.closingBalance.toFixed(2) : '-'}</td>
          <td style="color: ${c.difference < 0 ? 'var(--danger)' : (c.difference > 0 ? 'var(--success)' : 'inherit')}">
            ${isClosed ? (c.difference > 0 ? '+' : '') + '$'+c.difference.toFixed(2) : '-'}
          </td>
          <td><span class="badge ${isClosed ? 'badge-danger' : 'badge-success'}">${isClosed ? 'Cerrada' : 'Abierta'}</span></td>
        </tr>`;
    });
  } catch(e) { console.error(e); }
}

function calcDenominationsTotal() {
  const d2000 = parseInt(document.getElementById('den-2000').value || 0);
  const d1000 = parseInt(document.getElementById('den-1000').value || 0);
  const d500 = parseInt(document.getElementById('den-500').value || 0);
  const d200 = parseInt(document.getElementById('den-200').value || 0);
  const d100 = parseInt(document.getElementById('den-100').value || 0);
  const d50 = parseInt(document.getElementById('den-50').value || 0);
  const d25 = parseInt(document.getElementById('den-25').value || 0);
  const d10 = parseInt(document.getElementById('den-10').value || 0);
  const d5 = parseInt(document.getElementById('den-5').value || 0);
  const d1 = parseInt(document.getElementById('den-1').value || 0);

  const total = (d2000*2000) + (d1000*1000) + (d500*500) + (d200*200) +
                (d100*100) + (d50*50) + (d25*25) + (d10*10) + (d5*5) + (d1*1);
  
  document.getElementById('den-total-preview').textContent = `$${total.toFixed(2)}`;
  return total;
}

async function submitDenominations() {
  try {
    const payload = {
      d2000: parseInt(document.getElementById('den-2000').value || 0),
      d1000: parseInt(document.getElementById('den-1000').value || 0),
      d500: parseInt(document.getElementById('den-500').value || 0),
      d200: parseInt(document.getElementById('den-200').value || 0),
      d100: parseInt(document.getElementById('den-100').value || 0),
      d50: parseInt(document.getElementById('den-50').value || 0),
      d25: parseInt(document.getElementById('den-25').value || 0),
      d10: parseInt(document.getElementById('den-10').value || 0),
      d5: parseInt(document.getElementById('den-5').value || 0),
      d1: parseInt(document.getElementById('den-1').value || 0),
      sessionDate: new Date().toISOString().split('T')[0]
    };
    const res = await apiRequest('/denominations', 'POST', payload);
    closeModal('modal-denominations');
    document.getElementById('form-denominations').reset();
    document.getElementById('den-total-preview').textContent = '$0.00';
    loadDenominations();
    alert(`Cuadre guardado exitosamente. Total contabilizado: $${res.total.toFixed(2)}`);
  } catch(e) { alert(e.message); }
}

async function loadDenominations() {
  try {
    const data = await apiRequest('/denominations');
    const tbody = document.getElementById('denominations-history');
    if(!tbody) return;
    tbody.innerHTML = '';
    if(data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No hay cuadres registrados.</td></tr>';
      return;
    }
    data.forEach(d => {
      tbody.innerHTML += `
        <tr>
          <td>${d.sessionDate}</td>
          <td><strong>$${d.totalCash.toFixed(2)}</strong></td>
          <td>${formatDate(d.createdAt)}</td>
        </tr>`;
    });
  } catch(e) { console.error(e); }
}

// --- FINANZAS ---
async function loadFinancesSummary() {
  try {
    const data = await apiRequest('/finances/summary');
    
    document.getElementById('fin-capital-lent').textContent = `$${data.capitalLent.toFixed(2)}`;
    document.getElementById('fin-collected').textContent = `$${data.collected.toFixed(2)}`;
    document.getElementById('fin-expenses').textContent = `$${data.totalExpenses.toFixed(2)}`;
    
    const profitEl = document.getElementById('fin-net-profit');
    profitEl.textContent = `$${data.netProfit.toFixed(2)}`;
    profitEl.style.color = data.netProfit >= 0 ? 'var(--success)' : 'var(--danger)';
    
    const monthlyEl = document.getElementById('fin-monthly-profit');
    monthlyEl.textContent = `$${data.monthlyProfit.toFixed(2)}`;
    monthlyEl.style.color = data.monthlyProfit >= 0 ? 'var(--success)' : 'var(--danger)';
    
    const expList = document.getElementById('fin-expenses-category');
    expList.innerHTML = '';
    if (data.expensesByCategory.length === 0) {
      expList.innerHTML = '<li class="text-muted">No hay gastos registrados.</li>';
    } else {
      data.expensesByCategory.forEach(c => {
        expList.innerHTML += `
          <li style="display:flex; justify-content:space-between; margin-bottom:0.5rem; padding-bottom:0.5rem; border-bottom:1px solid var(--border)">
          <li style="display:flex; justify-content:space-between; margin-bottom:0.5rem; padding-bottom:0.5rem; border-bottom:1px solid var(--border)">
            <span style="text-transform:capitalize">${c.category}</span>
            <strong>$${c.total.toFixed(2)}</strong>
          </li>`;
      });
    }

    // Renderizar Gráficos
    renderFinancialCharts(data);
    
  } catch(e) { console.error(e); }
}

function renderFinancialCharts(data) {
  if (typeof Chart === 'undefined') return;

  // 1. Gráfico de Flujo de Caja (Ingresos vs Gastos)
  const ctxCashflow = document.getElementById('chart-cashflow');
  if (ctxCashflow) {
    if (collectionsChartInstance) collectionsChartInstance.destroy();
    
    // Asumimos que data.cashflow viene del backend ordenado cronológicamente
    const labels = data.cashflow.map(c => c.month);
    const incomeData = data.cashflow.map(c => c.income);
    const expenseData = data.cashflow.map(c => c.expense);
    
    collectionsChartInstance = new Chart(ctxCashflow, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Ingresos (Cobros)',
            data: incomeData,
            backgroundColor: 'rgba(34, 197, 94, 0.6)',
            borderColor: 'rgb(34, 197, 94)',
            borderWidth: 1,
            borderRadius: 4
          },
          {
            label: 'Gastos Operativos',
            data: expenseData,
            backgroundColor: 'rgba(239, 68, 68, 0.6)',
            borderColor: 'rgb(239, 68, 68)',
            borderWidth: 1,
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' }
        },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }

  // 2. Gráfico de Estado de Cartera (Préstamos)
  const ctxPortfolio = document.getElementById('chart-portfolio');
  if (ctxPortfolio) {
    if (statusChartInstance) statusChartInstance.destroy();
    
    let active = 0;
    let paid = 0;
    let overdue = 0;
    
    state.loans.forEach(l => {
      if (l.status === 'paid') paid++;
      else if (l.status === 'overdue') overdue++;
      else active++;
    });
    
    statusChartInstance = new Chart(ctxPortfolio, {
      type: 'doughnut',
      data: {
        labels: ['Activos', 'Pagados', 'Morosos'],
        datasets: [{
          data: [active, paid, overdue],
          backgroundColor: [
            'rgba(59, 130, 246, 0.7)',
            'rgba(34, 197, 94, 0.7)',
            'rgba(239, 68, 68, 0.7)'
          ],
          borderColor: [
            'rgb(59, 130, 246)',
            'rgb(34, 197, 94)',
            'rgb(239, 68, 68)'
          ],
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' }
        }
      }
    });
  }
}

// =========================================================
// MÓDULO DOCUMENTOS: GENERADOR DE CONTRATO EN PDF
// =========================================================
window.generateContractPDF = function(loanId) {
  if (!hasFeature('allow_documents')) {
    alert('Su plan actual no incluye la generación de documentos y contratos. Actualice su plan para acceder a esta función.');
    return;
  }

  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert('La librería PDF no está cargada. Actualiza la página e intenta de nuevo.');
    return;
  }

  const loan = state.loans.find(l => l.id === loanId);
  if (!loan) { alert('Préstamo no encontrado.'); return; }

  const client = state.clients.find(c => c.id === loan.clientId);
  const companyName = window.appSettings?.companyName || 'Prestamista';
  const companyEmail = window.appSettings?.email || '';

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 20;
  let y = margin;

  // --- ENCABEZADO ---
  doc.setFillColor(30, 58, 138); // Azul corporativo
  doc.rect(0, 0, pageW, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('CONTRATO DE PRÉSTAMO DE DINERO', pageW / 2, 14, { align: 'center' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(companyName.toUpperCase(), pageW / 2, 22, { align: 'center' });

  y = 40;
  doc.setTextColor(30, 30, 30);

  // --- NÚMERO DE CONTRATO ---
  doc.setFillColor(243, 244, 246);
  doc.roundedRect(margin, y - 4, pageW - margin * 2, 12, 2, 2, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(`Contrato N°: ${loan.id}`, margin + 4, y + 4);
  doc.text(`Fecha: ${new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}`, pageW - margin - 4, y + 4, { align: 'right' });
  y += 20;

  // --- CLÁUSULA 1: PARTES CONTRATANTES ---
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 58, 138);
  doc.text('CLÁUSULA I – PARTES CONTRATANTES', margin, y);
  y += 6;
  doc.setDrawColor(30, 58, 138);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('PRESTAMISTA (Acreedor):', margin, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Nombre / Empresa: ${companyName}`, margin + 4, y); y += 4;
  if (companyEmail) { doc.text(`Correo: ${companyEmail}`, margin + 4, y); y += 4; }
  y += 3;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('PRESTATARIO (Deudor):', margin, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Nombre: ${client ? client.name : loan.clientName}`, margin + 4, y); y += 4;
  if (client?.phone) { doc.text(`Teléfono: ${client.phone}`, margin + 4, y); y += 4; }
  if (client?.email) { doc.text(`Correo: ${client.email}`, margin + 4, y); y += 4; }
  y += 5;

  // --- CLÁUSULA 2: TÉRMINOS DEL PRÉSTAMO ---
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 58, 138);
  doc.text('CLÁUSULA II – TÉRMINOS DEL PRÉSTAMO', margin, y);
  y += 6;
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  const freq = { daily: 'Diaria', weekly: 'Semanal', biweekly: 'Quincenal', monthly: 'Mensual' };
  const tipoSistema = loan.type === 'french' ? 'Sistema Francés (Cuota Fija)' : loan.type === 'german' ? 'Sistema Alemán (Capital Fijo)' : 'Interés Simple';

  const terminos = [
    ['Monto Capital Prestado', formatCurrency(loan.amount)],
    ['Tasa de Interés', `${loan.rate}% anual`],
    ['Sistema de Amortización', tipoSistema],
    ['Frecuencia de Pago', freq[loan.frequency] || loan.frequency],
    ['Número de Cuotas', `${loan.term} cuotas`],
    ['Fecha de Inicio', formatDateReadable(loan.startDate)],
    ['Total Intereses', formatCurrency(loan.interestAmount)],
    ['Total a Pagar', formatCurrency(loan.totalPayable)],
  ];

  doc.setTextColor(30, 30, 30);
  terminos.forEach(([label, val]) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(label + ':', margin + 2, y);
    doc.setFont('helvetica', 'normal');
    doc.text(val, margin + 60, y);
    y += 5;
  });

  y += 4;

  // --- CLÁUSULA 3: MORA ---
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 58, 138);
  doc.text('CLÁUSULA III – MORA Y PENALIDADES', margin, y);
  y += 6;
  doc.line(margin, y, pageW - margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(30, 30, 30);
  const moraText = 'En caso de retraso en el pago de cualquier cuota, el PRESTATARIO incurrirá automáticamente en mora, ' +
    'sin necesidad de requerimiento previo, desde el día siguiente al vencimiento de la cuota impaga. ' +
    'Se aplicarán los cargos por mora y recargos establecidos por el PRESTAMISTA al momento del cobro.';
  const splitMora = doc.splitTextToSize(moraText, pageW - margin * 2);
  doc.text(splitMora, margin, y);
  y += splitMora.length * 4 + 5;

  // --- TABLA DE AMORTIZACIÓN ---
  if (loan.instalments && loan.instalments.length > 0) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 58, 138);
    doc.text('PLAN DE PAGOS (TABLA DE AMORTIZACIÓN)', margin, y);
    y += 6;
    doc.line(margin, y, pageW - margin, y);
    y += 3;

    const tableRows = loan.instalments.map(inst => [
      inst.index,
      formatDateReadable(inst.dueDate),
      formatCurrency(inst.capitalPayment || 0),
      formatCurrency(inst.interestPayment || 0),
      formatCurrency(inst.amount),
      inst.status === 'paid' ? '✓ Pagado' : 'Pendiente'
    ]);

    doc.autoTable({
      startY: y,
      head: [['#', 'Vencimiento', 'Capital', 'Interés', 'Cuota', 'Estado']],
      body: tableRows,
      theme: 'striped',
      headStyles: { fillColor: [30, 58, 138], textColor: 255, fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7.5 },
      margin: { left: margin, right: margin },
      didDrawPage: (data) => { y = data.cursor.y; }
    });

    y = doc.lastAutoTable.finalY + 10;
  }

  // --- FIRMAS ---
  if (y + 45 > pageH - margin) { doc.addPage(); y = margin + 10; }

  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  // Línea firma prestamista
  doc.line(margin, y + 25, margin + 65, y + 25);
  doc.text('Firma del Prestamista / Acreedor', margin, y + 30);
  doc.setFont('helvetica', 'bold');
  doc.text(companyName, margin, y + 35);

  // Línea firma prestatario
  const rightCol = pageW - margin - 65;
  doc.setFont('helvetica', 'normal');
  doc.line(rightCol, y + 25, rightCol + 65, y + 25);
  doc.text('Firma del Prestatario / Deudor', rightCol, y + 30);
  doc.setFont('helvetica', 'bold');
  doc.text(client ? client.name : loan.clientName, rightCol, y + 35);

  y += 48;

  // --- PIE DE PÁGINA ---
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(150, 150, 150);
  doc.text(`Documento generado el ${new Date().toLocaleString('es-ES')} por ${companyName}. Contrato N° ${loan.id}.`, pageW / 2, pageH - 8, { align: 'center' });

  // --- GUARDAR ---
  const filename = `contrato_prestamo_${loan.id.substring(0, 8)}.pdf`;
  const pdfData = doc.output('datauristring');
  
  // Intentar compartir en móvil / descargar en desktop
  try {
    const base64 = pdfData.split(',')[1];
    if (typeof shareFileApp === 'function') {
      shareFileApp(base64, filename, 'Contrato de Préstamo PDF');
    } else {
      doc.save(filename);
    }
  } catch(e) {
    doc.save(filename);
  }
};

// =========================================================
// MÓDULO DEPURADOR DE BASE DE DATOS
// =========================================================
let debugCurrentData = []; // Datos crudos actuales en el depurador

function loadDebuggerSection() {
  if (!hasFeature('allow_debugger')) {
    const wrapper = document.getElementById('debug-results-wrapper');
    if (wrapper) wrapper.innerHTML = `
      <div class="text-center text-muted" style="padding:3rem;">
        <i data-lucide="lock" style="width:40px; height:40px; margin-bottom:1rem; opacity:0.5;"></i>
        <p style="font-size:1rem; font-weight:600;">Acceso restringido</p>
        <p>Su plan actual no incluye el Depurador de Base de Datos.</p>
      </div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }
  // Resetear estado
  debugCurrentData = [];
  document.getElementById('debug-sql-input').value = '';
  document.getElementById('debug-table-select').value = '';
  document.getElementById('debug-search').value = '';
  debugShowPlaceholder();
}

function debugShowPlaceholder() {
  document.getElementById('debug-placeholder').style.display = 'block';
  document.getElementById('debug-results-table').style.display = 'none';
  document.getElementById('debug-status-bar').style.display = 'none';
  if (window.lucide) lucide.createIcons();
}

function debugShowStatus(msg, type = 'info') {
  const bar = document.getElementById('debug-status-bar');
  const colors = {
    info: { bg: 'rgba(59,130,246,0.1)', border: '#3b82f6', text: '#3b82f6' },
    success: { bg: 'rgba(34,197,94,0.1)', border: '#22c55e', text: '#22c55e' },
    error: { bg: 'rgba(239,68,68,0.1)', border: '#ef4444', text: '#ef4444' }
  };
  const c = colors[type] || colors.info;
  bar.style.display = 'block';
  bar.style.background = c.bg;
  bar.style.border = `1px solid ${c.border}`;
  bar.style.color = c.text;
  bar.textContent = msg;
}

function debugRenderTable(rows) {
  if (!rows || rows.length === 0) {
    debugShowStatus('✓ Consulta exitosa — 0 registros encontrados.', 'info');
    document.getElementById('debug-results-table').style.display = 'none';
    document.getElementById('debug-placeholder').innerHTML = `
      <i data-lucide="search-x" style="width:36px; height:36px; margin-bottom:0.75rem; opacity:0.4;"></i>
      <p>No se encontraron registros con esta consulta.</p>`;
    document.getElementById('debug-placeholder').style.display = 'block';
    if (window.lucide) lucide.createIcons();
    return;
  }

  const cols = Object.keys(rows[0]);
  const thead = document.getElementById('debug-thead');
  const tbody = document.getElementById('debug-tbody');

  thead.innerHTML = '<tr>' + cols.map(c => `<th style="white-space:nowrap; font-size:0.78rem; background:rgba(124,58,237,0.1); color:#7c3aed;">${c}</th>`).join('') + '</tr>';
  
  tbody.innerHTML = '';
  rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = cols.map(c => {
      const val = row[c];
      let display = val === null ? '<span style="color:var(--text-muted);font-style:italic;">null</span>' : String(val);
      if (typeof val === 'string' && val.length > 80) display = val.substring(0, 80) + '…';
      return `<td style="font-size:0.8rem; white-space:nowrap; max-width:200px; overflow:hidden; text-overflow:ellipsis;" title="${String(val || '')}">${display}</td>`;
    }).join('');
    tbody.appendChild(tr);
  });

  document.getElementById('debug-placeholder').style.display = 'none';
  document.getElementById('debug-results-table').style.display = 'table';
  debugShowStatus(`✓ ${rows.length} registro(s) encontrado(s). Máximo 500 por consulta.`, 'success');
  debugCurrentData = rows;
}

window.debugLoadTable = async function(table) {
  if (!table) { debugShowPlaceholder(); return; }
  if (!hasFeature('allow_debugger')) return;
  
  debugShowStatus('⏳ Cargando tabla...', 'info');
  document.getElementById('debug-sql-input').value = `SELECT * FROM ${table} LIMIT 100`;

  try {
    const data = await apiRequest(`/debugger/table/${table}`);
    debugRenderTable(data);
  } catch(e) {
    debugShowStatus('✗ Error: ' + e.message, 'error');
  }
};

window.debugRunQuery = async function() {
  if (!hasFeature('allow_debugger')) return;
  const sql = document.getElementById('debug-sql-input').value.trim();
  if (!sql) { alert('Escribe una consulta SQL para ejecutar.'); return; }

  debugShowStatus('⏳ Ejecutando consulta...', 'info');
  try {
    const data = await apiRequest('/debugger/query', 'POST', { sql });
    debugRenderTable(data);
  } catch(e) {
    debugShowStatus('✗ Error SQL: ' + e.message, 'error');
  }
};

window.debugFilterResults = function() {
  const q = document.getElementById('debug-search').value.toLowerCase();
  if (!debugCurrentData.length) return;

  const filtered = q
    ? debugCurrentData.filter(row => Object.values(row).some(v => String(v || '').toLowerCase().includes(q)))
    : debugCurrentData;

  const tbody = document.getElementById('debug-tbody');
  const cols = Object.keys(debugCurrentData[0]);
  tbody.innerHTML = '';
  filtered.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = cols.map(c => {
      const val = row[c];
      let display = val === null ? '<span style="color:var(--text-muted);font-style:italic;">null</span>' : String(val);
      if (typeof val === 'string' && val.length > 80) display = val.substring(0, 80) + '…';
      return `<td style="font-size:0.8rem; white-space:nowrap; max-width:200px; overflow:hidden; text-overflow:ellipsis;" title="${String(val || '')}">${display}</td>`;
    }).join('');
    tbody.appendChild(tr);
  });
  debugShowStatus(`✓ Mostrando ${filtered.length} de ${debugCurrentData.length} registro(s).`, filtered.length < debugCurrentData.length ? 'info' : 'success');
};

window.debugExportJSON = function() {
  if (!debugCurrentData.length) { alert('No hay datos para exportar. Ejecuta una consulta primero.'); return; }
  const json = JSON.stringify(debugCurrentData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `debug_export_${new Date().toISOString().split('T')[0]}.json`;
  a.click(); URL.revokeObjectURL(url);
};

window.debugExportCSV = function() {
  if (!debugCurrentData.length) { alert('No hay datos para exportar. Ejecuta una consulta primero.'); return; }
  const cols = Object.keys(debugCurrentData[0]);
  const rows = [cols.join(',')];
  debugCurrentData.forEach(row => {
    rows.push(cols.map(c => `"${String(row[c] ?? '').replace(/"/g, '""')}"`).join(','));
  });
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `debug_export_${new Date().toISOString().split('T')[0]}.csv`;
  a.click(); URL.revokeObjectURL(url);
};

// =========================================================
// MÓDULO KYC – VISOR DE IMÁGENES EN PANTALLA COMPLETA
// =========================================================
window.viewKycImageFullscreen = function(src, title) {
  if (!src) return;
  
  // Crear overlay de pantalla completa
  const overlay = document.createElement('div');
  overlay.id = 'kyc-fullscreen-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(0,0,0,0.92); display: flex; flex-direction: column;
    align-items: center; justify-content: center; cursor: zoom-out;
    animation: fadeIn 0.2s ease;
  `;
  
  const header = document.createElement('div');
  header.style.cssText = 'position:absolute; top:0; left:0; right:0; padding:1rem 1.5rem; display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.5);';
  header.innerHTML = `
    <span style="color:#fff; font-weight:600; font-size:1rem;">${title}</span>
    <button onclick="document.getElementById('kyc-fullscreen-overlay').remove()" 
      style="background:rgba(255,255,255,0.15); border:none; color:#fff; border-radius:50%; width:36px; height:36px; cursor:pointer; font-size:1.2rem; display:flex; align-items:center; justify-content:center;">✕</button>
  `;
  
  const img = document.createElement('img');
  img.src = src;
  img.alt = title;
  img.style.cssText = 'max-width:90vw; max-height:85vh; border-radius:8px; box-shadow:0 20px 60px rgba(0,0,0,0.5); object-fit:contain;';
  
  overlay.appendChild(header);
  overlay.appendChild(img);
  
  // Cerrar al hacer clic fuera de la imagen
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  
  // Cerrar con Escape
  const escHandler = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);
  
  document.body.appendChild(overlay);
};

// =========================================================
// INVITAR USUARIO POR EMAIL
// =========================================================
const inviteUserForm = document.getElementById('invite-user-form');
if (inviteUserForm) {
  inviteUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById('invite-user-email');
    const msgEl = document.getElementById('invite-user-msg');
    const submitBtn = inviteUserForm.querySelector('button[type="submit"]');
    
    msgEl.textContent = 'Enviando invitación...';
    msgEl.style.color = 'var(--text-muted)';
    submitBtn.disabled = true;
    
    try {
      const res = await apiRequest('/users/invite', 'POST', {
        email: emailInput.value
      });
      
      msgEl.textContent = res.message;
      msgEl.style.color = 'var(--success)';
      emailInput.value = '';
      
      if (res.link) {
        msgEl.innerHTML = `Invitación generada. <a href="${res.link}" target="_blank" style="color:var(--primary);text-decoration:underline;">Abrir Link de Prueba</a>`;
      }
      
    } catch (err) {
      msgEl.textContent = err.message || 'Error al enviar invitación.';
      msgEl.style.color = 'var(--danger)';
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// =========================================================
// NOTIFICACIONES DE MORA
// =========================================================
async function triggerOverdueCron() {
  const btn = document.getElementById('btn-trigger-cron');
  const msgEl = document.getElementById('cron-msg');
  if (!btn || !msgEl) return;
  
  const originalHtml = btn.innerHTML;
  btn.innerHTML = 'Ejecutando...';
  btn.disabled = true;
  msgEl.textContent = '';
  
  try {
    const res = await apiRequest('/cron/overdue', 'POST');
    msgEl.textContent = res.message;
    msgEl.style.color = 'var(--success)';
  } catch (err) {
    msgEl.textContent = err.message || 'Error al ejecutar cron';
    msgEl.style.color = 'var(--danger)';
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
}

// =========================================================
// WHATSAPP API
// =========================================================
let waInterval = null;

async function checkWhatsAppStatus() {
  const badge = document.getElementById('wa-status-badge');
  const qrContainer = document.getElementById('wa-qr-container');
  const qrImage = document.getElementById('wa-qr-image');
  const readyContainer = document.getElementById('wa-ready-container');
  
  if (!badge) return;

  try {
    const res = await apiRequest('/whatsapp/status');
    
    if (res.ready) {
      badge.textContent = 'Conectado';
      badge.style.color = 'var(--success)';
      badge.style.borderColor = 'var(--success)';
      qrContainer.style.display = 'none';
      readyContainer.style.display = 'block';
      if (waInterval) clearInterval(waInterval);
    } else {
      readyContainer.style.display = 'none';
      if (res.qrUrl) {
        badge.textContent = 'Escanea el QR';
        badge.style.color = 'var(--primary)';
        badge.style.borderColor = 'var(--primary)';
        qrImage.src = res.qrUrl;
        qrContainer.style.display = 'block';
      } else {
        badge.textContent = 'Generando QR...';
        badge.style.color = 'var(--text-muted)';
        badge.style.borderColor = 'var(--border)';
        qrContainer.style.display = 'none';
      }
    }
  } catch (err) {
    console.error('Error verificando WhatsApp:', err);
    badge.textContent = 'Error de conexión';
    badge.style.color = 'var(--danger)';
    badge.style.borderColor = 'var(--danger)';
  }
}

// Interceptar cambios de sección para empezar/detener polling de WA
const originalSwitchSection = switchSection;
window.switchSection = function(sectionId) {
  originalSwitchSection(sectionId);
  if (sectionId === 'sec-settings') {
    checkWhatsAppStatus();
    if (waInterval) clearInterval(waInterval);
    waInterval = setInterval(checkWhatsAppStatus, 5000);
  } else {
    if (waInterval) {
      clearInterval(waInterval);
      waInterval = null;
    }
  }
};

async function sendWhatsAppToClient() {
  if (!currentClient || !currentClient.phone) {
    alert('El cliente no tiene un número de teléfono válido registrado.');
    return;
  }
  
  const message = prompt(`Escribe el mensaje de WhatsApp para ${currentClient.name}:`, `Hola ${currentClient.name}, nos comunicamos de PrestamosApp...`);
  
  if (!message) return; // Cancelado
  
  try {
    const res = await apiRequest('/whatsapp/send', 'POST', {
      phone: currentClient.phone,
      message: message
    });
    alert('✅ ' + res.message);
  } catch (err) {
    alert('❌ Error: ' + err.message);
  }
}
