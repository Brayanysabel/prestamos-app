// app.js - VentasApp Frontend
const API_BASE = '/api';
let products = [];
let clients = [];
let sales = [];
let payments = [];
let expenses = [];
let currentSection = 'products';

document.addEventListener('DOMContentLoaded', () => {
  const today = new Date().toISOString().split('T')[0];
  const saleDate = document.getElementById('sale-date');
  if (saleDate) saleDate.value = today;
  const payDate = document.getElementById('pay-date');
  if (payDate) payDate.value = today;
  const expDate = document.getElementById('exp-date');
  if (expDate) expDate.value = today;

  switchSection('products', document.querySelector('.nav-item'));
  startClock();
});

function startClock() {
  const el = document.getElementById('clock');
  if (!el) return;
  const tick = () => {
    const now = new Date();
    el.textContent = now.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
  };
  tick();
  setInterval(tick, 30000);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('sidebar-open');
}

function closeModal(id) {
  document.getElementById(id).classList.add('d-none');
}

function openModal(id) {
  document.getElementById(id).classList.remove('d-none');
}

function switchSection(section, btn) {
  currentSection = section;
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-item').forEach(b => b.classList.remove('active'));
  const target = document.getElementById('section-' + section);
  if (target) target.classList.add('active');
  if (btn) btn.classList.add('active');
  document.getElementById('sidebar').classList.remove('sidebar-open');

  if (section === 'products') {
    const search = document.getElementById('product-search');
    if (search) search.value = '';
    loadProducts();
  }
  if (section === 'clients') loadClients();
  if (section === 'sales') loadSales();
  if (section === 'payments') loadPayments();
  if (section === 'expenses') loadExpenses();
  if (section === 'reports') loadReports();
}

async function api(endpoint, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body ? JSON.parse(options.body) : null;
  const DB = window.DB;
  const parts = endpoint.replace(/^\//, '').split('/');
  const resource = parts[0];
  const id = parts[1];
  let result;

  if (resource === 'products') {
    if (method === 'GET' && !id) result = await DB.listProducts();
    else if (method === 'POST') result = await DB.createProduct(body);
    else if (method === 'PUT' && id) result = await DB.updateProduct(id, body);
    else if (method === 'DELETE' && id) result = await DB.removeProduct(id);
  } else if (resource === 'clients') {
    if (method === 'GET' && !id) result = await DB.listClients();
    else if (method === 'POST') result = await DB.createClient(body);
    else if (method === 'PUT' && id) result = await DB.updateClient(id, body);
    else if (method === 'DELETE' && id) result = await DB.removeClient(id);
  } else if (resource === 'sales') {
    if (method === 'GET' && !id) result = await DB.listSales();
    else if (method === 'GET' && id) result = await DB.getSale(id);
    else if (method === 'POST') result = await DB.createSale(body);
    else if (method === 'DELETE' && id) result = await DB.removeSale(id);
  } else if (resource === 'payments') {
    if (method === 'GET') result = await DB.listPayments();
    else if (method === 'POST') result = await DB.createPayment(body);
  } else if (resource === 'expenses') {
    if (method === 'GET' && !id) result = await DB.listExpenses();
    else if (method === 'POST') result = await DB.createExpense(body);
    else if (method === 'PUT' && id) result = await DB.updateExpense(id, body);
    else if (method === 'DELETE' && id) result = await DB.removeExpense(id);
  } else if (resource === 'reports') {
    if (id === 'summary') result = await DB.reportSummary();
    else if (id === 'top-products') result = await DB.reportTopProducts();
  }

  return { ok: true, data: result || [] };
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function formatMoney(amount) {
  return parseFloat(amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// PRODUCTS
async function loadProducts() {
  const data = await api('/products');
  products = data.data || [];
  renderProducts();
}

function renderProducts(list) {
  const tbody = document.getElementById('products-table');
  if (!tbody) return;
  const items = list || products;
  tbody.innerHTML = items.map(p => `
    <tr>
      <td>${p.name}</td>
      <td>${p.category || '-'}</td>
      <td><span class="badge ${p.stock > 0 ? 'badge-success' : 'badge-danger'}">${p.stock}</span></td>
      <td>RD$ ${formatMoney(p.salePrice)}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="editProduct('${p.id}')">Editar</button>
        <button class="btn btn-sm btn-danger" onclick="deleteProduct('${p.id}')">Borrar</button>
      </td>
    </tr>
  `).join('');
  toggleEmpty('products', items.length === 0);
}

function openProductModal() {
  document.getElementById('product-form').reset();
  document.getElementById('prod-id').value = '';
  openModal('modal-product');
}

function editProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  document.getElementById('prod-id').value = p.id;
  document.getElementById('prod-name').value = p.name;
  document.getElementById('prod-description').value = p.description || '';
  document.getElementById('prod-category').value = p.category || '';
  document.getElementById('prod-stock').value = p.stock;
  document.getElementById('prod-cost').value = p.costPrice;
  document.getElementById('prod-sale').value = p.salePrice;
  document.getElementById('prod-supplier').value = p.supplier || '';
  openModal('modal-product');
}

async function saveProduct(e) {
  e.preventDefault();
  const id = document.getElementById('prod-id').value;
  const data = {
    name: document.getElementById('prod-name').value,
    description: document.getElementById('prod-description').value,
    category: document.getElementById('prod-category').value,
    stock: parseInt(document.getElementById('prod-stock').value) || 0,
    costPrice: parseFloat(document.getElementById('prod-cost').value) || 0,
    salePrice: parseFloat(document.getElementById('prod-sale').value) || 0,
    supplier: document.getElementById('prod-supplier').value
  };
  try {
    if (id) await api(`/products/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    else await api('/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    closeModal('modal-product');
    loadProducts();
    showToast(id ? 'Producto actualizado' : 'Producto creado', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteProduct(id) {
  if (!confirm('¿Eliminar producto?')) return;
  try {
    await api(`/products/${id}`, { method: 'DELETE' });
    loadProducts();
    showToast('Producto eliminado', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

// CLIENTS
async function loadClients() {
  const data = await api('/clients');
  clients = data.data || [];
  renderClients();
}

function renderClients() {
  const tbody = document.getElementById('clients-table');
  if (!tbody) return;
  tbody.innerHTML = clients.map(c => `
    <tr>
      <td>${c.name}</td>
      <td>${c.phone || '-'}</td>
      <td>${c.email || '-'}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="editClient('${c.id}')">Editar</button>
        <button class="btn btn-sm btn-danger" onclick="deleteClient('${c.id}')">Borrar</button>
      </td>
    </tr>
  `).join('');
  toggleEmpty('clients', clients.length === 0);
}

function openClientModal() {
  document.getElementById('client-form').reset();
  document.getElementById('cli-id').value = '';
  openModal('modal-client');
}

function editClient(id) {
  const c = clients.find(x => x.id === id);
  if (!c) return;
  document.getElementById('cli-id').value = c.id;
  document.getElementById('cli-name').value = c.name;
  document.getElementById('cli-phone').value = c.phone || '';
  document.getElementById('cli-email').value = c.email || '';
  document.getElementById('cli-address').value = c.address || '';
  document.getElementById('cli-notes').value = c.notes || '';
  openModal('modal-client');
}

async function saveClient(e) {
  e.preventDefault();
  const id = document.getElementById('cli-id').value;
  const data = {
    name: document.getElementById('cli-name').value,
    phone: document.getElementById('cli-phone').value,
    email: document.getElementById('cli-email').value,
    address: document.getElementById('cli-address').value,
    notes: document.getElementById('cli-notes').value
  };
  try {
    if (id) await api(`/clients/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    else await api('/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    closeModal('modal-client');
    loadClients();
    showToast(id ? 'Cliente actualizado' : 'Cliente creado', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteClient(id) {
  if (!confirm('¿Eliminar cliente?')) return;
  try {
    await api(`/clients/${id}`, { method: 'DELETE' });
    loadClients();
    showToast('Cliente eliminado', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

// SALES
async function loadSales() {
  const data = await api('/sales');
  sales = data.data || [];
  renderSales();
}

function renderSales() {
  const tbody = document.getElementById('sales-table');
  if (!tbody) return;
  tbody.innerHTML = sales.map(s => `
    <tr>
      <td>${s.saleDate}</td>
      <td>${s.clientName}</td>
      <td>RD$ ${formatMoney(s.totalAmount)}</td>
      <td>${s.paymentMethod}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="viewSale('${s.id}')">Ver</button>
        <button class="btn btn-sm btn-danger" onclick="deleteSale('${s.id}')">Borrar</button>
      </td>
    </tr>
  `).join('');
  toggleEmpty('sales', sales.length === 0);
}

function openSaleModal() {
  document.getElementById('sale-form').reset();
  document.getElementById('sale-date').value = new Date().toISOString().split('T')[0];
  loadClientsForSale();
  addSaleItem();
  openModal('modal-sale');
}

async function loadClientsForSale() {
  const data = await api('/clients');
  clients = data.data || [];
  const select = document.getElementById('sale-client-id');
  if (!select) return;
  select.innerHTML = '<option value="">Consumidor Final</option>' + clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

function addSaleItem() {
  const container = document.getElementById('sale-items-container');
  const row = document.createElement('div');
  row.className = 'sale-item-row';
  row.style.cssText = 'display: grid; grid-template-columns: 2fr 1fr 1fr 1fr auto; gap: 0.5rem; margin-bottom: 0.5rem;';
  row.innerHTML = `
    <select class="sale-product-select" required>
      <option value="">Producto</option>
      ${products.map(p => `<option value="${p.id}" data-price="${p.salePrice}" data-name="${p.name}">${p.name}</option>`).join('')}
    </select>
    <input type="number" class="sale-qty" placeholder="Cant" value="1" min="1" required>
    <input type="number" class="sale-price" placeholder="Precio" step="0.01" required>
    <input type="text" class="sale-subtotal" placeholder="Subtotal" readonly>
    <button type="button" class="btn btn-danger" onclick="removeSaleItem(this)" style="padding: 0.5rem;">&times;</button>
  `;
  container.appendChild(row);
  row.querySelector('.sale-product-select').addEventListener('change', function() {
    const opt = this.options[this.selectedIndex];
    if (opt.value) {
      row.querySelector('.sale-price').value = opt.dataset.price || 0;
      updateSaleTotals();
    }
  });
  row.querySelector('.sale-qty').addEventListener('input', updateSaleTotals);
  row.querySelector('.sale-price').addEventListener('input', updateSaleTotals);
}

function removeSaleItem(btn) {
  const rows = document.querySelectorAll('.sale-item-row');
  if (rows.length > 1) btn.closest('.sale-item-row').remove();
}

function updateSaleTotals() {
  let subtotal = 0;
  document.querySelectorAll('.sale-item-row').forEach(row => {
    const qty = parseFloat(row.querySelector('.sale-qty').value) || 0;
    const price = parseFloat(row.querySelector('.sale-price').value) || 0;
    const sub = qty * price;
    row.querySelector('.sale-subtotal').value = sub.toFixed(2);
    subtotal += sub;
  });
  document.getElementById('sale-subtotal').textContent = `RD$ ${formatMoney(subtotal)}`;
  document.getElementById('sale-total').textContent = `RD$ ${formatMoney(subtotal)}`;
}

async function saveSale(e) {
  e.preventDefault();
  const clientId = document.getElementById('sale-client-id').value;
  const saleDate = document.getElementById('sale-date').value;
  const paymentMethod = document.getElementById('sale-method').value;
  const clientName = clientId ? (clients.find(c => c.id === clientId)?.name || 'Cliente') : 'Consumidor Final';

  const items = [];
  let subtotal = 0;
  document.querySelectorAll('.sale-item-row').forEach(row => {
    const productSelect = row.querySelector('.sale-product-select');
    const productId = productSelect.value;
    const productName = productSelect.options[productSelect.selectedIndex]?.text || 'Producto';
    const qty = parseFloat(row.querySelector('.sale-qty').value) || 0;
    const price = parseFloat(row.querySelector('.sale-price').value) || 0;
    const itemSub = qty * price;
    subtotal += itemSub;
    if (qty > 0) items.push({ productId, productName, quantity: qty, unitPrice: price, subtotal: itemSub });
  });

  if (items.length === 0) { showToast('Agrega al menos un producto', 'error'); return; }

  try {
    await api('/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientName, saleDate, items, subtotal, taxAmount: 0, totalAmount: subtotal, paymentMethod })
    });
    closeModal('modal-sale');
    loadSales();
    showToast('Venta registrada', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function viewSale(id) {
  const data = await api(`/sales/${id}`);
  const sale = data.data;
  alert(`Venta #${sale.id}\nCliente: ${sale.clientName}\nTotal: RD$ ${formatMoney(sale.totalAmount)}\nFecha: ${sale.saleDate}`);
}

async function deleteSale(id) {
  if (!confirm('¿Eliminar venta? Se restaurará el stock.')) return;
  try {
    await api(`/sales/${id}`, { method: 'DELETE' });
    loadSales();
    showToast('Venta eliminada', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

// PAYMENTS
async function loadPayments() {
  const data = await api('/payments');
  payments = data.data || [];
  renderPayments();
}

function renderPayments() {
  const tbody = document.getElementById('payments-table');
  if (!tbody) return;
  tbody.innerHTML = payments.map(p => `
    <tr>
      <td>${p.paymentDate}</td>
      <td>${p.clientName || '-'}</td>
      <td>RD$ ${formatMoney(p.amount)}</td>
      <td>${p.paymentMethod}</td>
    </tr>
  `).join('');
  toggleEmpty('payments', payments.length === 0);
}

function openPaymentModal() {
  document.getElementById('payment-form').reset();
  loadSalesForPayment();
  openModal('modal-payment');
}

async function loadSalesForPayment() {
  const data = await api('/sales');
  sales = data.data || [];
  const select = document.getElementById('payment-sale-id');
  if (!select) return;
  select.innerHTML = '<option value="">Seleccionar venta</option>' + sales.map(s => `<option value="${s.id}">#${s.id} - ${s.clientName} - RD$ ${formatMoney(s.totalAmount)}</option>`).join('');
}

async function savePayment(e) {
  e.preventDefault();
  const saleId = document.getElementById('payment-sale-id').value;
  const amount = parseFloat(document.getElementById('pay-amount').value);
  const paymentDate = document.getElementById('pay-date').value;
  const paymentMethod = document.getElementById('pay-method').value;
  const notes = document.getElementById('pay-notes').value;
  if (!saleId) { showToast('Selecciona una venta', 'error'); return; }

  try {
    await api('/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saleId, amount, paymentDate, paymentMethod, notes })
    });
    closeModal('modal-payment');
    loadPayments();
    showToast('Pago registrado', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

// EXPENSES
async function loadExpenses() {
  const data = await api('/expenses');
  expenses = data.data || [];
  renderExpenses();
}

function renderExpenses() {
  const tbody = document.getElementById('expenses-table');
  if (!tbody) return;
  tbody.innerHTML = expenses.map(e => `
    <tr>
      <td>${e.date}</td>
      <td>${e.description}</td>
      <td>${e.category}</td>
      <td>RD$ ${formatMoney(e.amount)}</td>
      <td><button class="btn btn-sm btn-danger" onclick="deleteExpense('${e.id}')">Borrar</button></td>
    </tr>
  `).join('');
  toggleEmpty('expenses', expenses.length === 0);
}

function openExpenseModal() {
  document.getElementById('expense-form').reset();
  document.getElementById('exp-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('exp-id').value = '';
  openModal('modal-expense');
}

async function saveExpense(e) {
  e.preventDefault();
  const id = document.getElementById('exp-id').value;
  const data = {
    date: document.getElementById('exp-date').value,
    description: document.getElementById('exp-description').value,
    category: document.getElementById('exp-category').value,
    amount: parseFloat(document.getElementById('exp-amount').value)
  };
  try {
    if (id) await api(`/expenses/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    else await api('/expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    closeModal('modal-expense');
    loadExpenses();
    showToast(id ? 'Gasto actualizado' : 'Gasto registrado', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteExpense(id) {
  if (!confirm('¿Eliminar gasto?')) return;
  try {
    await api(`/expenses/${id}`, { method: 'DELETE' });
    loadExpenses();
    showToast('Gasto eliminado', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

// REPORTS
async function loadReports() {
  const summary = await api('/reports/summary');
  const data = summary.data || {};
  document.getElementById('stat-sales').textContent = `RD$ ${formatMoney(data.month_sales)}`;
  document.getElementById('stat-expenses').textContent = `RD$ ${formatMoney(data.month_expenses)}`;
  document.getElementById('stat-profit').textContent = `RD$ ${formatMoney(data.month_profit)}`;
  document.getElementById('stat-count').textContent = data.sales_count || 0;

  const topProducts = await api('/reports/top-products');
  const rows = topProducts.data || [];
  const tbody = document.getElementById('top-products-table');
  if (!tbody) return;
  tbody.innerHTML = rows.map(p => `
    <tr>
      <td>${p.productName || 'Sin nombre'}</td>
      <td>${p.total_qty || 0}</td>
      <td>RD$ ${formatMoney(p.total_revenue)}</td>
    </tr>
  `).join('');
  toggleEmpty('top-products', rows.length === 0);
}

// Event Listeners
document.getElementById('product-form').addEventListener('submit', saveProduct);
document.getElementById('client-form').addEventListener('submit', saveClient);
document.getElementById('sale-form').addEventListener('submit', saveSale);
document.getElementById('payment-form').addEventListener('submit', savePayment);
document.getElementById('expense-form').addEventListener('submit', saveExpense);

const productSearch = document.getElementById('product-search');
if (productSearch) {
  productSearch.addEventListener('input', function (e) {
    const term = e.target.value.toLowerCase().trim();
    const filtered = products.filter(p => p.name.toLowerCase().includes(term));
    renderProducts(filtered);
  });
}

function toggleEmpty(prefix, isEmpty) {
  const table = document.getElementById(prefix + '-table');
  const empty = document.getElementById(prefix + '-empty');
  if (!table && !empty) return;
  if (isEmpty) {
    if (table) table.classList.add('d-none');
    if (empty) empty.classList.remove('d-none');
  } else {
    if (table) table.classList.remove('d-none');
    if (empty) empty.classList.add('d-none');
  }
}
