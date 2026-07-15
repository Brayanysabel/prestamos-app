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

// --- 2. PERSISTENCIA DE DATOS Y API ---

const API_URL = window.PRESTAMOS_API_URL || 'http://localhost:8080/api';

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
    ...(token && { 'X-Auth-Token': token }),
    ...options.headers
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
    plansNav.style.display = !isSuperAdmin ? 'flex' : 'none';
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
}

function showLogin() {
  const loginScreen = document.getElementById('login-screen');
  if (loginScreen) loginScreen.classList.add('active');
  
  let appWrapper = document.getElementById('app-wrapper');
  if (!appWrapper) appWrapper = document.getElementById('main-app');
  if (appWrapper) appWrapper.classList.add('d-none');
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
      if (data.isSuperAdmin) {
        localStorage.setItem('prestamos_is_superadmin', 'true');
      } else {
        localStorage.removeItem('prestamos_is_superadmin');
      }
      errorEl.classList.add('d-none');
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
    'superadmin': { title: 'Administración Global', subtitle: 'Gestión SaaS de inquilinos y planes' }
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
      switchSection('calculator');
    });
  }
  const newLoanShortcutBtn = document.getElementById('new-loan-shortcut-btn');
  if (newLoanShortcutBtn) {
    newLoanShortcutBtn.addEventListener('click', () => {
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
  const totalBalance = totalPayable - totalCollected;

  // Actualizar KPIs
  document.getElementById('kpi-capital').textContent = formatCurrency(totalCapital);
  document.getElementById('kpi-interests').textContent = formatCurrency(totalInterests);
  document.getElementById('kpi-collected').textContent = formatCurrency(totalCollected);
  document.getElementById('kpi-balance').textContent = formatCurrency(totalBalance);

  // Renderizar gráficos
  renderStatusChart(activeCount, paidCount, overdueCount);
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
function renderStatusChart(active, paid, overdue) {
  const ctx = document.getElementById('statusChart').getContext('2d');
  
  if (statusChartInstance) {
    statusChartInstance.destroy();
  }

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const labelColor = isDark ? '#fafafa' : '#09090b';

  // Si no hay datos, mostrar vacío
  if (active === 0 && paid === 0 && overdue === 0) {
    active = 1; // Solo para que dibuje algo neutro
  }

  statusChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Activos', 'Pagados', 'Vencidos'],
      datasets: [{
        data: [active, paid, overdue],
        backgroundColor: [
          '#2563eb', // Azul
          '#10b981', // Verde
          '#ef4444'  // Rojo
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
  const typeName = type === 'french' ? 'Francés (Cuota Fija)' : 'Simple (Cuota Lineal)';
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
  
  const typeName = loan.type === 'french' ? 'Sistema Francés' : 'Interés Simple';
  document.getElementById('loan-detail-type').textContent = typeName;
  
  const freqName = FREQUENCIES[loan.frequency].name;
  document.getElementById('loan-detail-frequency').textContent = `${freqName} (${loan.term} cuotas)`;
  
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
        <button class="btn btn-success btn-sm" onclick="sendWhatsAppReceipt('${loan.id}', ${inst.index})" title="Enviar por WhatsApp" style="background-color: #25D366; border-color: #25D366;">
          <i data-lucide="message-circle" style="width: 12px; height: 12px;"></i>
        </button>
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

if (kycSubmitBtn) {
  kycSubmitBtn.addEventListener('click', async () => {
    const clientId = document.getElementById('kyc-client-id').value;
    const client = state.clients.find(c => c.id === clientId);
    if (!client) return;
    
    // Guardar KYC en el backend
    try {
      const res = await fetch(`${API_URL}/clients/${clientId}/kyc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': localStorage.getItem('prestamos_auth_token')
        },
        body: JSON.stringify({ selfieUrl: kycSnapshot.src, idDocumentUrl: '' })
      });
      if (!res.ok) throw new Error('Error al validar la identidad en el servidor.');
      
      client.kycStatus = 'verified';
      client.kycPhoto = kycSnapshot.src;
    } catch (e) {
      console.error(e);
      alert(e.message);
      return;
    }
    
    stopCamera();
    closeModal('modal-kyc');
    renderClientsTable();
    viewClientDetail(clientId);
    alert('Verificación KYC guardada correctamente.');
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

// --- ELIMINACIÓN SEGURA ---
const deleteLoanBtn = document.getElementById('delete-loan-btn');
const deleteClientBtn = document.getElementById('delete-client-btn');
const modalDeleteAuth = document.getElementById('modal-delete-auth');
const deleteAuthForm = document.getElementById('delete-auth-form');

if (deleteLoanBtn) {
  deleteLoanBtn.addEventListener('click', () => {
    const loanId = document.getElementById('loan-detail-id').textContent;
    if (loanId && loanId !== '-') {
      document.getElementById('delete-target-id').value = loanId;
      document.getElementById('delete-target-type').value = 'loan';
      document.getElementById('delete-auth-warning-text').textContent = 'Esta acción borrará permanentemente este préstamo y todos sus pagos asociados. Ingrese su contraseña de administrador para confirmar.';
      openModal('modal-delete-auth');
    }
  });
}

if (deleteClientBtn) {
  deleteClientBtn.addEventListener('click', () => {
    // Tomamos el ID del cliente de algún lugar, aunque modal-client-detail no muestra el ID directamente.
    // Vamos a usar client-detail-email o pasar el ID a un campo oculto al abrir el modal.
    // Wait, let's check how the client modal is populated. It sets `currentClientId = client.id` when opened.
    // So we can rely on `currentClientId` global variable!
    if (currentClientId) {
      document.getElementById('delete-target-id').value = currentClientId;
      document.getElementById('delete-target-type').value = 'client';
      document.getElementById('delete-auth-warning-text').textContent = 'Esta acción borrará permanentemente a este cliente, TODOS SUS PRÉSTAMOS y todos sus pagos asociados. Ingrese su contraseña de administrador para confirmar.';
      openModal('modal-delete-auth');
    }
  });
}

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
        await renderLoans();
      } else if (targetType === 'client') {
        await apiRequest(`/clients/${targetId}`, { method: 'DELETE', body: JSON.stringify({ password }) });
        closeModal('modal-client-detail');
        await renderClients(); // recargar la tabla de clientes
        // Also refresh loans just in case they were looking at loans of this client
        await renderLoans();
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

// Exportación CSV
function downloadCSV(csvContent, fileName) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

if (document.getElementById('export-clients-btn')) document.getElementById('export-clients-btn').addEventListener('click', () => {
  if (state.clients.length === 0) return alert('No hay clientes para exportar');
  const headers = "ID,Nombre,Telefono,Email,Notas,FechaCreacion\n";
  const rows = state.clients.map(c => `"${c.id}","${c.name}","${c.phone}","${c.email}","${(c.notes || '').replace(/"/g, '""')}","${c.createdAt}"`).join("\n");
  downloadCSV(headers + rows, 'clientes.csv');
});

if (document.getElementById('export-loans-btn')) document.getElementById('export-loans-btn').addEventListener('click', () => {
  if (state.loans.length === 0) return alert('No hay préstamos para exportar');
  const headers = "ID,Cliente,Monto,Tasa,Cuotas,Frecuencia,Estado,BalancePendiente,FechaCreacion\n";
  const rows = state.loans.map(l => `"${l.id}","${l.clientName}","${l.amount}","${l.annualRate}","${l.term}","${l.frequency}","${l.status}","${l.remainingBalance}","${l.createdAt}"`).join("\n");
  downloadCSV(headers + rows, 'prestamos.csv');
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

function downloadCSV(csvContent, filename) {
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
      
      let planOptions = plans.map(p => `<option value="${p.id}" ${comp.plan === p.id ? 'selected' : ''}>${p.name}</option>`).join('');
      
      tr.innerHTML = `
        <td><strong>${comp.name}</strong><br><small class="text-muted">ID: ${comp.id}</small></td>
        <td>
          <span class="badge ${comp.status === 'active' ? 'badge-success' : 'badge-danger'}">
            ${comp.status === 'active' ? 'Activo' : 'Suspendido'}
          </span>
        </td>
        <td>
          <select class="form-select form-select-sm" onchange="changeCompanyPlan('${comp.id}', this.value)" ${isDefault ? 'disabled' : ''}>
            ${planOptions}
          </select>
        </td>
        <td>${comp.validUntil || '-'}</td>
        <td>
          <div style="display:flex; gap:0.5rem; flex-direction:column; font-size:0.85rem;">
            <span><i data-lucide="users" style="width:14px; height:14px"></i> Clientes: ${comp.clientCount}</span>
            <span><i data-lucide="hand-coins" style="width:14px; height:14px"></i> Préstamos: ${comp.loanCount}</span>
          </div>
        </td>
        <td class="text-end" style="white-space: nowrap;">
          ${!isDefault ? `<button class="btn btn-sm btn-primary" onclick="generateActivationLink('${comp.id}', '${comp.plan}')" title="Generar Link de Activación">
            <i data-lucide="link" style="width:14px;height:14px"></i> Activar Plan
          </button>` : ''}
          <button class="btn btn-sm btn-secondary" onclick="toggleCompanyStatus('${comp.id}', '${comp.status}')" ${isDefault ? 'disabled' : ''}>
            ${comp.status === 'active' ? 'Suspender' : 'Activar'}
          </button>
          ${!isDefault ? `<button class="btn btn-sm btn-danger" onclick="deleteCompany('${comp.id}')"><i data-lucide="trash-2"></i></button>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Render plans
    const ptbody = document.getElementById('saas-plans-tbody');
    ptbody.innerHTML = '';
    plans.forEach(plan => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${plan.name}</strong></td>
        <td>$${plan.price}</td>
        <td>${plan.max_loans}</td>
        <td>${plan.max_users}</td>
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

window.changeCompanyPlan = async function(companyId, newPlan) {
  if (!confirm('¿Cambiar el plan de esta empresa?')) return;
  try {
    await apiRequest(`/saas/companies/${companyId}/plan`, {
      method: 'PUT',
      body: JSON.stringify({ plan: newPlan })
    });
    renderSuperAdminSection();
  } catch (err) {
    alert('Error: ' + err.message);
  }
};

window.toggleCompanyStatus = async function(companyId, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'suspended' : 'active';

  if (newStatus === 'suspended') {
    if (!confirm('¿Desea SUSPENDER esta empresa? No podrá usar la app hasta reactivarla.')) return;
    try {
      await apiRequest(`/saas/companies/${companyId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'suspended' })
      });
      renderSuperAdminSection();
    } catch (err) {
      alert('Error: ' + err.message);
    }
    return;
  }

  // Activar: preguntar cuántos meses agregar
  const input = prompt('¿Por cuántos meses deseas activar/renovar esta empresa?', '1');
  if (input === null) return; // canceló
  const months = parseInt(input, 10);
  if (isNaN(months) || months < 1) {
    alert('Ingresa un número de meses válido (mínimo 1).');
    return;
  }
  try {
    const res = await apiRequest(`/saas/companies/${companyId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'active', months })
    });
    alert(`Empresa activada. Válida hasta: ${res.newValidUntil}`);
    renderSuperAdminSection();
  } catch (err) {
    alert('Error: ' + err.message);
  }
};

window.deleteCompany = async function(companyId) {
  if (!confirm('¿Eliminar esta empresa permanentemente? Esta acción no se puede deshacer.')) return;
  try {
    await apiRequest(`/saas/companies/${companyId}`, { method: 'DELETE' });
    renderSuperAdminSection();
  } catch (err) {
    alert('Error: ' + err.message);
  }
};

// Modal Planes SaaS
window.openPlanModal = function(plan = null) {
  const modal = document.getElementById('plan-modal');
  const title = document.getElementById('plan-modal-title');
  const form = document.getElementById('plan-form');
  const idInput = document.getElementById('plan-id-input');
  
  form.reset();
  
  if (plan) {
    title.textContent = 'Editar Plan SaaS';
    document.getElementById('plan-id').value = plan.id;
    idInput.value = plan.id;
    idInput.disabled = true;
    document.getElementById('plan-name').value = plan.name;
    document.getElementById('plan-price').value = plan.price;
    document.getElementById('plan-max-loans').value = plan.max_loans;
    document.getElementById('plan-max-users').value = plan.max_users;
  } else {
    title.textContent = 'Crear Plan SaaS';
    document.getElementById('plan-id').value = '';
    idInput.disabled = false;
  }
  
  modal.style.display = 'flex';
};

window.closePlanModal = function() {
  document.getElementById('plan-modal').style.display = 'none';
};

document.getElementById('plan-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const originalId = document.getElementById('plan-id').value;
  const id = document.getElementById('plan-id-input').value;
  const name = document.getElementById('plan-name').value;
  const price = document.getElementById('plan-price').value;
  const max_loans = document.getElementById('plan-max-loans').value;
  const max_users = document.getElementById('plan-max-users').value;
  
  try {
    if (originalId) {
      await apiRequest(`/saas/plans/${originalId}`, {
        method: 'PUT',
        body: JSON.stringify({ name, price, max_loans, max_users })
      });
    } else {
      await apiRequest('/saas/plans', {
        method: 'POST',
        body: JSON.stringify({ id, name, price, max_loans, max_users })
      });
    }
    closePlanModal();
    renderSuperAdminSection();
  } catch (err) {
    alert('Error guardando el plan: ' + err.message);
  }
});

window.deletePlan = async function(planId) {
  if (!confirm('¿Seguro que desea eliminar este plan? Los inquilinos con este plan podrían fallar si no se reasignan.')) return;
  try {
    await apiRequest(`/saas/plans/${planId}`, { method: 'DELETE' });
    renderSuperAdminSection();
  } catch (err) {
    alert('Error eliminando plan: ' + err.message);
  }
};

// --- Generar Link de Activación de Plan ---
window.generateActivationLink = async function(companyId, currentPlan) {
  try {
    const plans = await apiRequest('/saas/public-plans');
    
    // Crear modal de selección de plan
    const planOptions = plans.map(p => 
      `<option value="${p.id}" ${p.id === currentPlan ? 'selected' : ''}>${p.name} - RD$ ${Number(p.price).toLocaleString('es-DO')}/mes</option>`
    ).join('');
    
    const selectedPlan = prompt(
      'Selecciona el plan a activar (escribe el ID del plan):\n\n' +
      plans.map(p => `• ${p.id} → ${p.name} (RD$ ${Number(p.price).toLocaleString('es-DO')}/mes)`).join('\n') +
      '\n\nEscribe el ID del plan:',
      currentPlan
    );
    
    if (!selectedPlan) return;
    
    const res = await apiRequest(`/saas/companies/${companyId}/generate-activation`, {
      method: 'POST',
      body: JSON.stringify({ planId: selectedPlan })
    });
    
    // Copiar al portapapeles
    try {
      await navigator.clipboard.writeText(res.link);
    } catch(e) { /* clipboard may fail on some devices */ }
    
    // Mostrar modal con el link
    const modalHtml = `
      <div id="activation-link-modal" style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);padding:1rem;">
        <div style="background:var(--card-bg,#1e293b);border:1px solid var(--border,#334155);border-radius:1rem;padding:2rem;max-width:520px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,0.5);">
          <div style="text-align:center;margin-bottom:1.5rem;">
            <div style="width:60px;height:60px;margin:0 auto 1rem;background:rgba(34,197,94,0.15);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.5rem;">🔗</div>
            <h3 style="margin:0 0 0.5rem;font-size:1.25rem;">Link de Activación Generado</h3>
            <p style="color:var(--text-muted,#94a3b8);margin:0;font-size:0.9rem;">Plan: <strong>${res.plan}</strong> · Expira en ${res.expiresIn}</p>
          </div>
          <div style="background:rgba(0,0,0,0.3);border:1px solid rgba(99,102,241,0.3);border-radius:0.5rem;padding:0.75rem;word-break:break-all;font-family:monospace;font-size:0.8rem;color:#a5b4fc;margin-bottom:1.5rem;">
            ${res.link}
          </div>
          <div style="display:flex;gap:0.75rem;">
            <button onclick="navigator.clipboard.writeText('${res.link}');this.textContent='¡Copiado!';setTimeout(()=>this.textContent='Copiar Link',2000)" class="btn btn-primary" style="flex:1;padding:0.75rem;">
              Copiar Link
            </button>
            <button onclick="window.open('https://wa.me/?text='+encodeURIComponent('Activa tu plan aquí: ${res.link}'),'_blank')" class="btn btn-success" style="flex:1;padding:0.75rem;background:linear-gradient(135deg,#22c55e,#16a34a);">
              Enviar por WhatsApp
            </button>
          </div>
          <button onclick="document.getElementById('activation-link-modal').remove()" style="display:block;width:100%;margin-top:0.75rem;padding:0.5rem;background:transparent;border:1px solid var(--border,#334155);border-radius:0.5rem;color:var(--text-muted,#94a3b8);cursor:pointer;">
            Cerrar
          </button>
        </div>
      </div>
    `;
    
    // Remove existing modal if any
    const existing = document.getElementById('activation-link-modal');
    if (existing) existing.remove();
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
  } catch (err) {
    alert('Error generando link de activación: ' + err.message);
  }
};

// --- Activar plan pendiente (usuario final) ---
window.activatePendingPlan = async function(token) {
  if (!confirm('¿Deseas activar tu nuevo plan ahora?')) return;
  
  try {
    const resp = await fetch(`/api/activate/${token}`);
    const data = await resp.json();
    
    if (resp.ok && data.success) {
      // Mostrar mensaje de éxito
      const modalHtml = `
        <div id="plan-activated-modal" style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);padding:1rem;">
          <div style="background:var(--card-bg,#1e293b);border:1px solid rgba(34,197,94,0.4);border-radius:1rem;padding:2.5rem;max-width:420px;width:100%;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.5);">
            <div style="width:70px;height:70px;margin:0 auto 1rem;background:rgba(34,197,94,0.15);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:2rem;">✅</div>
            <h3 style="margin:0 0 0.5rem;font-size:1.35rem;">¡Plan Activado!</h3>
            <p style="color:var(--text-muted,#94a3b8);margin:0 0 0.5rem;font-size:0.95rem;">${data.message}</p>
            <p style="color:var(--text-muted,#94a3b8);margin:0 0 1.5rem;font-size:0.85rem;">Válido hasta: <strong style="color:#22c55e;">${data.validUntil}</strong></p>
            <button onclick="document.getElementById('plan-activated-modal').remove();renderPlansSection();" 
              class="btn btn-success" 
              style="background:linear-gradient(135deg,#22c55e,#16a34a);padding:0.75rem 2rem;font-weight:600;border-radius:0.75rem;width:100%;">
              ¡Entendido!
            </button>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', modalHtml);
    } else {
      alert(data.error || 'Error al activar el plan.');
    }
  } catch (err) {
    alert('Error de conexión al activar el plan: ' + err.message);
  }
};

// --- SAAS PLANS LOGIC ---
let editingPlanId = null;

window.openPlanModal = function(plan = null) {
  const form = document.getElementById('saas-plan-form');
  const title = document.getElementById('plan-modal-title');
  if (plan) {
    editingPlanId = plan.id;
    title.textContent = 'Editar Plan SaaS';
    document.getElementById('plan-id').value = plan.id;
    document.getElementById('plan-id').readOnly = true;
    document.getElementById('plan-name').value = plan.name;
    document.getElementById('plan-price').value = plan.price;
    document.getElementById('plan-max-loans').value = plan.max_loans;
    document.getElementById('plan-max-users').value = plan.max_users;
  } else {
    editingPlanId = null;
    form.reset();
    title.textContent = 'Registrar Nuevo Plan';
    document.getElementById('plan-id').readOnly = false;
  }
  document.getElementById('modal-plan').classList.add('active');
};

document.getElementById('saas-plan-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('plan-id').value.trim().toLowerCase();
  const name = document.getElementById('plan-name').value.trim();
  const price = parseFloat(document.getElementById('plan-price').value);
  const max_loans = parseInt(document.getElementById('plan-max-loans').value);
  const max_users = parseInt(document.getElementById('plan-max-users').value);
  
  try {
    const method = editingPlanId ? 'PUT' : 'POST';
    const url = editingPlanId ? '/saas/plans/' + editingPlanId : '/saas/plans';
    
    await apiRequest(url, {
      method: method,
      body: JSON.stringify({ id, name, price, max_loans, max_users })
    });
    
    closeModal('modal-plan');
    loadSuperAdminDashboard();
  } catch (err) {
    alert('Error guardando plan: ' + err.message);
  }
});

window.deletePlan = async function(id) {
  if (confirm('Est seguro de que desea eliminar este plan? Esto podra afectar a los inquilinos suscritos a l.')) {
    try {
      await apiRequest('/saas/plans/' + id, { method: 'DELETE' });
      loadSuperAdminDashboard();
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
