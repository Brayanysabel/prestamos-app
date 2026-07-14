// db.js - Capa de almacenamiento local (IndexedDB) para uso offline en PC y móvil.
// Se expone como window.DB para usar desde app.js (script clásico).
(function () {
  const DB_NAME = 'ventasapp';
  const DB_VERSION = 1;
  const STORES = ['products', 'clients', 'sales', 'sale_items', 'payments', 'expenses'];

  let _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        STORES.forEach((s) => {
          if (!db.objectStoreNames.contains(s)) {
            const os = db.createObjectStore(s, { keyPath: 'id' });
            if (s === 'sale_items') os.createIndex('saleId', 'saleId', { unique: false });
            if (s === 'sales') os.createIndex('saleDate', 'saleDate', { unique: false });
            if (s === 'payments') os.createIndex('saleId', 'saleId', { unique: false });
            if (s === 'products') os.createIndex('createdAt', 'createdAt', { unique: false });
            if (s === 'clients') os.createIndex('createdAt', 'createdAt', { unique: false });
            if (s === 'expenses') os.createIndex('date', 'date', { unique: false });
          }
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }

  function reqToPromise(request) {
    return new Promise((res, reject) => {
      request.onsuccess = () => res(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function store(name, mode) {
    const db = await openDB();
    return db.transaction(name, mode).objectStore(name);
  }

  async function getAll(name) {
    const os = await store(name, 'readonly');
    return reqToPromise(os.getAll());
  }
  async function getOne(name, id) {
    const os = await store(name, 'readonly');
    return reqToPromise(os.get(id));
  }
  async function add(name, item) {
    const os = await store(name, 'readwrite');
    return reqToPromise(os.add(item));
  }
  async function put(name, item) {
    const os = await store(name, 'readwrite');
    return reqToPromise(os.put(item));
  }
  async function del(name, id) {
    const os = await store(name, 'readwrite');
    return reqToPromise(os.delete(id));
  }

  function uid(prefix) {
    return prefix + '_' + Math.random().toString(36).substring(2, 9);
  }

  function todayMonthStart() {
    const today = new Date().toISOString().split('T')[0];
    return today.substring(0, 8) + '01';
  }

  // ---------- PRODUCTOS ----------
  async function listProducts() {
    const rows = await getAll('products');
    return rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }
  async function createProduct(data) {
    const id = uid('prod');
    const item = {
      id,
      name: data.name,
      description: data.description || '',
      category: data.category || '',
      stock: parseInt(data.stock, 10) || 0,
      costPrice: parseFloat(data.costPrice) || 0,
      salePrice: parseFloat(data.salePrice) || 0,
      supplier: data.supplier || '',
      createdAt: new Date().toISOString()
    };
    await add('products', item);
    return item;
  }
  async function updateProduct(id, data) {
    const current = await getOne('products', id);
    if (!current) throw new Error('Producto no encontrado');
    const updated = {
      ...current,
      name: data.name,
      description: data.description || '',
      category: data.category || '',
      stock: parseInt(data.stock, 10) || 0,
      costPrice: parseFloat(data.costPrice) || 0,
      salePrice: parseFloat(data.salePrice) || 0,
      supplier: data.supplier || ''
    };
    await put('products', updated);
    return updated;
  }
  async function removeProduct(id) {
    await del('products', id);
  }

  // ---------- CLIENTES ----------
  async function listClients() {
    const rows = await getAll('clients');
    return rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }
  async function createClient(data) {
    const id = uid('cli');
    const item = {
      id,
      name: data.name,
      phone: data.phone || '',
      email: data.email || '',
      address: data.address || '',
      notes: data.notes || '',
      createdAt: new Date().toISOString()
    };
    await add('clients', item);
    return item;
  }
  async function updateClient(id, data) {
    const current = await getOne('clients', id);
    if (!current) throw new Error('Cliente no encontrado');
    const updated = {
      ...current,
      name: data.name,
      phone: data.phone || '',
      email: data.email || '',
      address: data.address || '',
      notes: data.notes || ''
    };
    await put('clients', updated);
    return updated;
  }
  async function removeClient(id) {
    await del('clients', id);
  }

  // ---------- VENTAS ----------
  async function listSales() {
    const rows = await getAll('sales');
    return rows.sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || ''));
  }
  async function getSale(id) {
    const sale = await getOne('sales', id);
    if (!sale) throw new Error('Venta no encontrado');
    const items = (await getAll('sale_items')).filter((i) => i.saleId === id);
    return { ...sale, items };
  }
  async function createSale(data) {
    const id = uid('sale');
    const createdAt = new Date().toISOString();
    const sale = {
      id,
      clientId: data.clientId || null,
      clientName: data.clientName,
      saleDate: data.saleDate,
      subtotal: data.subtotal || 0,
      taxAmount: data.taxAmount || 0,
      totalAmount: data.totalAmount || 0,
      paymentMethod: data.paymentMethod,
      status: 'completed',
      createdAt
    };
    await add('sales', sale);

    const products = await getAll('products');
    const byId = {};
    products.forEach((p) => (byId[p.id] = p));

    for (const item of data.items) {
      await add('sale_items', {
        id: uid('item'),
        saleId: id,
        productId: item.productId || null,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: item.subtotal
      });
      if (item.productId && byId[item.productId]) {
        byId[item.productId].stock = Math.max(0, (byId[item.productId].stock || 0) - item.quantity);
        await put('products', byId[item.productId]);
      }
    }
    return sale;
  }
  async function removeSale(id) {
    const items = (await getAll('sale_items')).filter((i) => i.saleId === id);
    const products = await getAll('products');
    const byId = {};
    products.forEach((p) => (byId[p.id] = p));
    for (const item of items) {
      if (item.productId && byId[item.productId]) {
        byId[item.productId].stock = (byId[item.productId].stock || 0) + item.quantity;
        await put('products', byId[item.productId]);
      }
      await del('sale_items', item.id);
    }
    const payments = (await getAll('payments')).filter((p) => p.saleId === id);
    for (const p of payments) await del('payments', p.id);
    await del('sales', id);
  }

  // ---------- PAGOS ----------
  async function listPayments() {
    const rows = await getAll('payments');
    const sales = await getAll('sales');
    const byId = {};
    sales.forEach((s) => (byId[s.id] = s));
    return rows
      .map((p) => ({ ...p, clientName: p.saleId && byId[p.saleId] ? byId[p.saleId].clientName : null }))
      .sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || ''));
  }
  async function createPayment(data) {
    const id = uid('pay');
    const item = {
      id,
      saleId: data.saleId || null,
      amount: data.amount,
      paymentDate: data.paymentDate,
      paymentMethod: data.paymentMethod,
      notes: data.notes || ''
    };
    await add('payments', item);
    return item;
  }

  // ---------- GASTOS ----------
  async function listExpenses() {
    const rows = await getAll('expenses');
    return rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
  async function createExpense(data) {
    const id = uid('exp');
    const item = {
      id,
      date: data.date,
      description: data.description,
      amount: data.amount,
      category: data.category || ''
    };
    await add('expenses', item);
    return item;
  }
  async function updateExpense(id, data) {
    const current = await getOne('expenses', id);
    if (!current) throw new Error('Gasto no encontrado');
    const updated = { ...current, date: data.date, description: data.description, amount: data.amount, category: data.category || '' };
    await put('expenses', updated);
    return updated;
  }
  async function removeExpense(id) {
    await del('expenses', id);
  }

  // ---------- REPORTES ----------
  async function reportSummary() {
    const monthStart = todayMonthStart();
    const sales = (await getAll('sales')).filter((s) => s.saleDate >= monthStart);
    const expenses = (await getAll('expenses')).filter((e) => e.date >= monthStart);
    const totalSales = sales.reduce((a, s) => a + (parseFloat(s.totalAmount) || 0), 0);
    const totalExpenses = expenses.reduce((a, e) => a + (parseFloat(e.amount) || 0), 0);
    return {
      month_sales: totalSales,
      month_expenses: totalExpenses,
      month_profit: totalSales - totalExpenses,
      sales_count: sales.length
    };
  }
  async function reportTopProducts() {
    const monthStart = todayMonthStart();
    const sales = (await getAll('sales')).filter((s) => s.saleDate >= monthStart);
    const ids = sales.map((s) => s.id);
    const items = (await getAll('sale_items')).filter((i) => ids.includes(i.saleId));
    const map = {};
    items.forEach((i) => {
      if (!map[i.productName]) map[i.productName] = { productName: i.productName, total_qty: 0, total_revenue: 0 };
      map[i.productName].total_qty += i.quantity;
      map[i.productName].total_revenue += i.subtotal;
    });
    return Object.values(map).sort((a, b) => b.total_qty - a.total_qty).slice(0, 10);
  }

  window.DB = {
    listProducts, createProduct, updateProduct, removeProduct,
    listClients, createClient, updateClient, removeClient,
    listSales, getSale, createSale, removeSale,
    listPayments, createPayment,
    listExpenses, createExpense, updateExpense, removeExpense,
    reportSummary, reportTopProducts
  };
})();
