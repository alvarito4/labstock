/* =========================================================
   LabStock - inventario compartido (Supabase)
   ========================================================= */

// ====== CONFIGURACIÓN ======
const SUPABASE_URL = "https://htpuapxxczbtpfmvjomn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_1fljO7C6ruXWgk7FD2KhwA_0iiHC8Og";
const PUBLIC_URL = "https://alvarito4.github.io/labstock/";
// ===========================

const PROGRAMMER_CODE = "955664";
const FDS_BUCKET = "fds";
const NAV_FOR_VIEW = {
  home: "home", form: "home", scan: "scan",
  inventory: "inventory", detail: "inventory", shopping: "shopping",
  sections: "home",
};

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- Estado ---------- */
let state = {
  products: [],
  locations: ["Laboratorio 1", "Laboratorio 2"],
  categories: ["Reactivos", "Material de vidrio", "Consumibles", "Equipos"],
};
let ui = {
  view: "home",
  params: {},
  programmer: false,
  search: "",
  filter: "Todas",
  locFilter: "Todos",
  draft: null,
  error: "",
  scanner: null,
  scanMsg: "",
  loading: true,
  loadError: "",
};

/* ---------- Base de datos (Supabase) ---------- */
const toRow = (p) => ({
  id: p.id, code: p.code, name: p.name, category: p.category,
  location: p.location, stock: p.stock, min_stock: p.minStock,
  fds_url: p.fdsUrl || null, history: p.history || [],
});
const fromRow = (r) => ({
  id: r.id, code: r.code, name: r.name, category: r.category,
  location: r.location || state.locations[0], stock: r.stock, minStock: r.min_stock,
  fdsUrl: r.fds_url || null, history: r.history || [],
});

async function loadProducts() {
  const { data, error } = await sb.from("products").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  state.products = data.map(fromRow);
}

async function persist(p) {
  const { error } = await sb.from("products").upsert(toRow(p));
  if (error) {
    alert("No se pudo guardar: " + error.message);
    await loadProducts().catch(() => {});
    render();
    return false;
  }
  return true;
}

async function removeProduct(id) {
  const { error } = await sb.from("products").delete().eq("id", id);
  if (error) alert("No se pudo eliminar: " + error.message);
  sb.storage.from(FDS_BUCKET).remove([`${id}.pdf`]).catch(() => {});
}

async function uploadFds(p, file) {
  const path = `${p.id}.pdf`;
  const { error } = await sb.storage.from(FDS_BUCKET).upload(path, file, {
    upsert: true, contentType: "application/pdf",
  });
  if (error) throw error;
  const { data } = sb.storage.from(FDS_BUCKET).getPublicUrl(path);
  p.fdsUrl = `${data.publicUrl}?v=${Date.now()}`;
}

/* Refresca los datos para que todos vean lo mismo */
async function refresh() {
  if (ui.loading || ui.view === "form" || ui.view === "scan") return;
  if (document.activeElement && document.activeElement.tagName === "INPUT") return;
  try {
    await loadLists();
    await loadProducts();
    render();
  } catch (e) { /* sin conexión: seguimos con los datos actuales */ }
}

/* ---------- Utilidades ---------- */
const $ = (sel) => document.querySelector(sel);

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function findProduct(id) { return state.products.find((p) => p.id === id); }

function findByCode(code) {
  const clean = String(code).trim().toUpperCase();
  return state.products.find((p) => p.code === clean);
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function newCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "LBK-" + Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (state.products.some((p) => p.code === code));
  return code;
}

function productUrl(code) {
  const base = PUBLIC_URL || (location.origin + location.pathname);
  return `${base}?p=${encodeURIComponent(code)}`;
}

function needsRestock(p) { return p.stock === 0 || p.stock <= p.minStock; }

function statusBadge(p) {
  if (p.stock === 0) return `<span class="badge red">AGOTADO</span>`;
  if (p.stock <= p.minStock) return `<span class="badge amber">Bajo mínimo</span>`;
  return "";
}

function addHistory(p, delta, type) {
  if (!Array.isArray(p.history)) p.history = [];
  p.history.unshift({ date: new Date().toISOString(), type, delta, stock: p.stock });
  p.history = p.history.slice(0, 50);
}

function formatDate(iso) {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

/* ---------- Navegación y render ---------- */
const views = {
  home: renderHome, scan: renderScan, inventory: renderInventory,
  shopping: renderShopping, detail: renderDetail, form: renderForm,
  sections: renderSections,
};

function render() {
  $("#view").innerHTML = views[ui.view]();
  document.querySelectorAll(".bottom-nav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.nav === NAV_FOR_VIEW[ui.view]));
  $("#prog-indicator").classList.toggle("hidden", !ui.programmer);
  if (ui.view === "detail") drawQR();
}

function navigate(view, params = {}) {
  stopScanner();
  ui.view = view;
  ui.params = params;
  ui.error = "";
  if (view !== "scan") ui.scanMsg = "";

  if (view === "form") {
    const p = params.id ? findProduct(params.id) : null;
    ui.draft = p
      ? {
          id: p.id, code: p.code, name: p.name, category: p.category,
          location: p.location || state.locations[0], stock: p.stock, minStock: p.minStock,
          fdsUrl: p.fdsUrl || null, fdsFile: null,
        }
      : {
          id: null, name: "", category: state.categories[0], location: state.locations[0],
          stock: 0, minStock: 0, fdsUrl: null, fdsFile: null,
        };
  }

  render();
  if (view === "scan") startScanner();
  window.scrollTo(0, 0);
}

/* ---------- Vistas ---------- */
function renderHome() {
  if (ui.loading) return `<p class="hint">Cargando inventario…</p>`;
  if (ui.loadError) return `<p class="error">${esc(ui.loadError)}</p>`;

  const total = state.products.length;
  const units = state.products.reduce((sum, p) => sum + p.stock, 0);
  const out = state.products.filter((p) => p.stock === 0).length;
  const recent = state.products
    .flatMap((p) => (p.history || []).map((h) => ({ ...h, name: p.name })))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  return `
    <section class="stats">
      <div class="stat"><b>${total}</b><span>Productos</span></div>
      <div class="stat"><b>${units}</b><span>Unidades</span></div>
      <div class="stat"><b>${out}</b><span>Agotados</span></div>
    </section>

    <button class="btn primary" data-go="form">⊕ Añadir producto</button>
    <button class="btn primary" data-go="scan">▣ Escanear un QR</button>

    ${out ? `<button class="alert" data-nav="shopping">● ${out} producto(s) agotado(s) · Ver lista de compra</button>` : ""}

    ${total === 0 ? `
      <div class="empty">
        <div class="flask">🧪</div>
        <p>Añade tu primer producto</p>
        <small>Cada producto recibe un código QR único que podrás escanear después.</small>
      </div>` : ""}

    ${recent.length ? `
      <h3>Movimiento reciente</h3>
      <ul class="moves">
        ${recent.map((h) => `
          <li>
            <div><strong>${esc(h.name)}</strong><small>${esc(h.type)} · ${formatDate(h.date)}</small></div>
            <span class="${h.delta < 0 ? "neg" : "pos"}">${h.delta > 0 ? "+" : ""}${h.delta}</span>
          </li>`).join("")}
      </ul>` : ""}

    ${renderProgrammer()}
  `;
}

function renderProgrammer() {
  if (ui.programmer) {
    return `
      <div class="card prog">
        <strong>✔ Modo programador activo</strong>
        <p>Puedes editar y eliminar productos desde su ficha.</p>
        <button class="btn outline" data-nav="sections" style="margin-top:8px">⚙ Gestionar secciones y categorías</button>
        <button class="link" data-action="lock">Cerrar sesión de programador</button>
      </div>`;
  }
  return `
    <div class="card prog">
      <strong>🔑 Acceso de programador</strong>
      <div class="row" style="margin-top:10px">
        <input id="prog-code" type="password" placeholder="Introduce el código">
        <button class="btn primary small" data-action="unlock">Desbloquear</button>
      </div>
      ${ui.error ? `<p class="error">${esc(ui.error)}</p>` : ""}
    </div>`;
}

function renderScan() {
  return `
    <h2>Escanear producto</h2>
    <div class="scanner-box"><div id="reader"></div></div>
    <p class="hint">${esc(ui.scanMsg || "Apunta la cámara al código QR del producto.")}</p>
    <button class="btn primary" data-action="retryCam">▣ Activar / reintentar cámara</button>
    <label class="btn outline" style="display:block;text-align:center;cursor:pointer;box-sizing:border-box">
      📷 Hacer foto del QR
      <input type="file" accept="image/*" capture="environment" data-file="qr" hidden>
    </label>
    <div id="qr-file" hidden></div>
    <div class="row">
      <input id="manual-code" placeholder="O escribe el código, ej. LBK-AKKDET">
      <button class="btn primary small" data-action="manualSearch">Buscar</button>
    </div>`;
}

function renderInventory() {
  return `
    <h2>Inventario</h2>
    <input id="search" type="search" placeholder="Buscar producto o código" value="${esc(ui.search)}">
    <div class="chips">
      ${["Todos", ...state.locations].map((l) => `
        <button class="chip ${ui.locFilter === l ? "on" : ""}" data-action="locFilter" data-value="${esc(l)}">${esc(l)}</button>`).join("")}
    </div>
    <div class="chips">
      ${["Todas", ...state.categories].map((f) => `
        <button class="chip ${ui.filter === f ? "on" : ""}" data-action="filter" data-value="${esc(f)}">${esc(f)}</button>`).join("")}
    </div>
    <div id="inv-list">${inventoryList()}</div>`;
}

function inventoryList() {
  const q = ui.search.trim().toLowerCase();
  const items = state.products.filter((p) =>
    (ui.filter === "Todas" || p.category === ui.filter) &&
    (ui.locFilter === "Todos" || p.location === ui.locFilter) &&
    (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)));

  if (!items.length) {
    return `<p class="hint">${state.products.length ? "Sin resultados" : "Todavía no hay productos."}</p>`;
  }
  return items.map((p) => `
    <button class="item" data-go="detail" data-id="${p.id}">
      <div>
        <strong>${esc(p.name)}</strong>
        <small>${esc(p.code)} · ${esc(p.location)} · ${esc(p.category)}</small>
      </div>
      <div class="right">${statusBadge(p)}<b>${p.stock}</b></div>
    </button>`).join("");
}

function renderShopping() {
  const items = state.products.filter(needsRestock);
  return `
    <h2>Lista de compra</h2>
    ${items.length ? items.map((p) => `
      <div class="item static">
        <div>
          <strong>${esc(p.name)}${statusBadge(p)}</strong>
          <small>${esc(p.location)} · Stock ${p.stock} · mínimo ${p.minStock}</small>
        </div>
        <button class="btn primary small" data-action="restock" data-id="${p.id}">Comprado</button>
      </div>`).join("") : `
      <div class="empty"><div class="flask">✅</div><p>Todo está en stock</p></div>`}`;
}

function renderDetail() {
  const p = findProduct(ui.params.id);
  if (!p) return renderInventory();

  const hist = (p.history || []).slice(0, 10);
  return `
    <button class="back" data-nav="inventory">‹ Volver</button>
    <h2>${esc(p.name)}</h2>
    <p class="hint">${esc(p.code)} · ${esc(p.location)} · ${esc(p.category)}${statusBadge(p)}</p>

    <div class="big"><b>${p.stock}</b><span>unidades en stock</span></div>

    <div class="row2">
      <button class="btn green" data-action="inc" data-id="${p.id}">+ Sumar uno</button>
      <button class="btn red" data-action="dec" data-id="${p.id}">− Restar uno</button>
    </div>

    ${p.fdsUrl
      ? `<a class="btn outline" href="${esc(p.fdsUrl)}" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none;box-sizing:border-box">📄 Ver ficha de seguridad (PDF)</a>`
      : `<p class="hint">Sin ficha de seguridad</p>`}

    <div class="qr-card">
      <div id="qr"></div>
      <small>${esc(p.code)}</small>
    </div>

    ${ui.programmer ? `
      <div class="row2">
        <button class="btn outline" data-go="form" data-id="${p.id}">Editar</button>
        <button class="btn outline danger" data-action="delete" data-id="${p.id}">Eliminar</button>
      </div>` : ""}

    <h3>Historial</h3>
    <ul class="moves">
      ${hist.length ? hist.map((h) => `
        <li>
          <div><small>${esc(h.type)} · ${formatDate(h.date)}</small></div>
          <span class="${h.delta < 0 ? "neg" : "pos"}">${h.delta > 0 ? "+" : ""}${h.delta}</span>
        </li>`).join("") : `<li><small>Sin movimientos</small></li>`}
    </ul>`;
}

function renderForm() {
  const d = ui.draft;
  const editing = Boolean(d.id);
  let fdsStatus = "Sin ficha de seguridad";
  if (d.fdsFile) fdsStatus = "Nuevo archivo: " + d.fdsFile.name;
  else if (d.fdsUrl) fdsStatus = "Ya tiene ficha. Sube otra para reemplazarla.";

  return `
    <button class="back" data-nav="home">‹ Volver</button>
    <h2>${editing ? "Editar producto" : "Nuevo producto"}</h2>
    <p class="hint">${editing ? `Código ${esc(d.code)}` : "Se generará un código QR único al guardar."}</p>

    <label>Nombre del producto *</label>
    <input data-draft="name" value="${esc(d.name)}" placeholder="Ej. Etanol 96%">

    <label>Ubicación</label>
    <div class="chips">
      ${state.locations.map((l) => `
        <button class="chip ${d.location === l ? "on" : ""}" data-action="draftLoc" data-value="${esc(l)}">${esc(l)}</button>`).join("")}
    </div>

    <label>Categoría</label>
    <div class="chips">
      ${state.categories.map((c) => `
        <button class="chip ${d.category === c ? "on" : ""}" data-action="draftCat" data-value="${esc(c)}">${esc(c)}</button>`).join("")}
    </div>

    ${stepper("stock", "Stock actual", d.stock)}
    ${stepper("minStock", "Stock mínimo", d.minStock)}

    <label>Ficha de datos de seguridad (PDF)</label>
    <input type="file" accept="application/pdf" data-file="fds">
    <p class="hint">${esc(fdsStatus)}</p>

    ${ui.error ? `<p class="error">${esc(ui.error)}</p>` : ""}
    <button class="btn primary" data-action="save">${editing ? "✓ Guardar cambios" : "✓ Añadir producto"}</button>`;
}

function stepper(field, label, value) {
  return `
    <label>${label}</label>
    <div class="stepper">
      <button data-action="step" data-field="${field}" data-value="-1">−</button>
      <input type="number" min="0" inputmode="numeric" data-draft="${field}" value="${value}">
      <button data-action="step" data-field="${field}" data-value="1">+</button>
    </div>`;
}

/* ---------- QR ---------- */
function drawQR() {
  const el = $("#qr");
  const p = findProduct(ui.params.id);
  if (!el || !p || !window.QRCode) return;
  el.innerHTML = "";
  new QRCode(el, { text: productUrl(p.code), width: 170, height: 170, correctLevel: QRCode.CorrectLevel.M });
}

/* ---------- Escáner ---------- */
function startScanner() {
  if (!window.Html5Qrcode) {
    ui.scanMsg = "No se pudo cargar el lector QR. Usa el campo manual.";
    return updateScanMsg();
  }
  ui.scanner = new Html5Qrcode("reader");
  ui.scanner
    .start({ facingMode: "environment" }, { fps: 10, qrbox: 230 },
      (text) => { stopScanner(); handleCode(text); },
      () => {})
    .catch((err) => {
      const motivo = err && err.name === "NotAllowedError"
        ? "Permiso de cámara denegado. Permítela en la configuración del navegador."
        : err && err.name === "NotFoundError"
          ? "No se encontró ninguna cámara en este dispositivo."
          : "No se pudo abrir la cámara (" + (err && err.name ? err.name : "error") + ").";
      ui.scanMsg = motivo + " Puedes usar 📷 Hacer foto del QR.";
      updateScanMsg();
    });
}

function stopScanner() {
  const s = ui.scanner;
  ui.scanner = null;
  if (s) s.stop().then(() => s.clear()).catch(() => {});
}

function updateScanMsg() {
  const el = document.querySelector(".hint");
  if (ui.view === "scan" && el) el.textContent = ui.scanMsg;
}

function codeFromText(text) {
  try {
    const p = new URL(String(text).trim()).searchParams.get("p");
    if (p) return p;
  } catch (e) { /* no es una URL: es un código */ }
  return String(text).trim();
}

function handleCode(text) {
  const code = codeFromText(text);
  if (!code) return;
  const p = findByCode(code);
  if (p) return navigate("detail", { id: p.id });
  ui.scanMsg = `No existe ningún producto con el código ${code}.`;
  navigate("scan");
}

function openFromUrl() {
  const code = new URLSearchParams(location.search).get("p");
  if (!code) return navigate("home");
  const p = findByCode(code);
  if (p) return navigate("detail", { id: p.id });
  navigate("home");
  ui.error = `No existe ningún producto con el código ${code}.`;
  render();
}

/* ---------- Secciones y categorías (configurables por el programador) ---------- */
const LISTS = {
  locations: { title: "Secciones", field: "location", singular: "sección", placeholder: "Ej. Material poco útil" },
  categories: { title: "Categorías", field: "category", singular: "categoría", placeholder: "Ej. Productos de limpieza" },
};

async function loadLists() {
  for (const key of Object.keys(LISTS)) {
    const { data, error } = await sb.from("settings").select("value").eq("key", key).maybeSingle();
    if (!error && data && Array.isArray(data.value) && data.value.length) state[key] = data.value;
  }
}

async function saveList(key) {
  const { error } = await sb.from("settings").upsert({ key, value: state[key] });
  if (error) {
    alert(`No se pudieron guardar las ${LISTS[key].title.toLowerCase()}: ` + error.message);
    return false;
  }
  return true;
}

async function renameItem(key, i, newName) {
  newName = newName.trim();
  const oldName = state[key][i];
  if (!newName || newName === oldName) return render();
  if (state[key].includes(newName)) return alert(`Ya existe esa ${LISTS[key].singular}.`);

  const field = LISTS[key].field;
  state[key][i] = newName;
  const affected = state.products.filter((p) => p[field] === oldName);
  affected.forEach((p) => { p[field] = newName; });
  if (key === "categories" && ui.filter === oldName) ui.filter = newName;
  if (key === "locations" && ui.locFilter === oldName) ui.locFilter = newName;

  if (!(await saveList(key))) return;
  await Promise.all(affected.map((p) => persist(p)));
  render();
}

async function addItem(key, name) {
  name = name.trim();
  if (!name) return;
  if (state[key].includes(name)) return alert(`Ya existe esa ${LISTS[key].singular}.`);
  state[key].push(name);
  await saveList(key);
  render();
}

async function deleteItem(key, i) {
  const name = state[key][i];
  const field = LISTS[key].field;
  const used = state.products.filter((p) => p[field] === name).length;
  if (used) return alert(`No se puede borrar "${name}": tiene ${used} producto(s). Cámbialos antes.`);
  if (state[key].length <= 1) return alert(`Debe quedar al menos una ${LISTS[key].singular}.`);
  if (!confirm(`¿Borrar "${name}"?`)) return;
  state[key].splice(i, 1);
  await saveList(key);
  render();
}

function renderListEditor(key) {
  const cfg = LISTS[key];
  return `
    <h3>${cfg.title}</h3>
    ${state[key].map((name, i) => `
      <div class="item static" style="gap:8px">
        <input data-item-input="${key}-${i}" value="${esc(name)}" style="flex:1;min-width:0;margin-bottom:0">
        <button class="btn primary small" data-action="renameItem" data-list="${key}" data-index="${i}">Guardar</button>
        <button class="btn outline danger small" data-action="delItem" data-list="${key}" data-index="${i}">Borrar</button>
      </div>`).join("")}
    <div class="row" style="margin-bottom:12px">
      <input id="new-${key}" placeholder="${cfg.placeholder}" style="margin-bottom:0">
      <button class="btn primary small" data-action="addItem" data-list="${key}">Añadir</button>
    </div>`;
}

function renderSections() {
  if (!ui.programmer) {
    ui.view = "home";
    return renderHome();
  }
  return `
    <button class="back" data-nav="home">‹ Volver</button>
    <h2>Secciones y categorías</h2>
    <p class="hint">Cambia nombres o añade nuevas. Los productos se actualizan solos.</p>
    ${renderListEditor("locations")}
    ${renderListEditor("categories")}`;
}

/* ---------- Acciones ---------- */
function changeStock(id, delta, type) {
  const p = findProduct(id);
  if (!p) return;
  const next = Math.max(0, p.stock + delta);
  const real = next - p.stock;
  if (!real) return;
  p.stock = next;
  addHistory(p, real, type);
  persist(p);
  render();
}

async function saveDraft() {
  const d = ui.draft;
  const name = d.name.trim();
  if (!name) {
    ui.error = "Escribe un nombre para el producto.";
    return render();
  }

  let p = d.id ? findProduct(d.id) : null;
  const isNew = !p;

  if (isNew) {
    p = {
      id: newId(), code: newCode(), name, category: d.category,
      location: d.location, stock: d.stock, minStock: d.minStock,
      fdsUrl: d.fdsUrl || null, history: [],
    };
    if (p.stock) addHistory(p, p.stock, "Alta");
    state.products.push(p);
  } else {
    const diff = d.stock - p.stock;
    p.name = name;
    p.category = d.category;
    p.location = d.location;
    p.minStock = d.minStock;
    if (diff) {
      p.stock = d.stock;
      addHistory(p, diff, "Ajuste");
    }
  }

  if (d.fdsFile) {
    try {
      await uploadFds(p, d.fdsFile);
    } catch (e) {
      if (isNew) state.products = state.products.filter((x) => x !== p);
      ui.error = "No se pudo subir el PDF: " + e.message;
      return render();
    }
  }

  if (!(await persist(p))) return;
  navigate("detail", { id: p.id });
}

function deleteProduct(id) {
  const p = findProduct(id);
  if (!p || !confirm(`¿Eliminar "${p.name}"?`)) return;
  state.products = state.products.filter((x) => x.id !== id);
  removeProduct(id);
  navigate("inventory");
}

function unlock() {
  const input = $("#prog-code");
  if (input && input.value === PROGRAMMER_CODE) {
    ui.programmer = true;
    ui.error = "";
  } else {
    ui.error = "Código incorrecto.";
  }
  render();
}

/* ---------- Eventos ---------- */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-nav],[data-go],[data-action]");
  if (!el) return;

  if (el.dataset.nav) return navigate(el.dataset.nav);
  if (el.dataset.go) return navigate(el.dataset.go, { id: el.dataset.id });

  const id = el.dataset.id;
  switch (el.dataset.action) {
    case "unlock": return unlock();
    case "lock": ui.programmer = false; return render();
    case "filter": ui.filter = el.dataset.value; return render();
    case "locFilter": ui.locFilter = el.dataset.value; return render();
    case "draftCat": ui.draft.category = el.dataset.value; return render();
    case "draftLoc": ui.draft.location = el.dataset.value; return render();
    case "step":
      ui.draft[el.dataset.field] = Math.max(0, ui.draft[el.dataset.field] + Number(el.dataset.value));
      return render();
    case "save": return saveDraft();
    case "inc": return changeStock(id, 1, "Entrada");
    case "dec": return changeStock(id, -1, "Salida");
    case "restock": {
      const p = findProduct(id);
      if (p) changeStock(id, Math.max(1, p.minStock - p.stock), "Compra");
      return;
    }
    case "delete": return deleteProduct(id);
    case "manualSearch": return handleCode($("#manual-code").value);
    case "retryCam": return navigate("scan");
    case "addItem": return addItem(el.dataset.list, $(`#new-${el.dataset.list}`).value);
    case "renameItem": {
      const i = Number(el.dataset.index);
      const input = document.querySelector(`[data-item-input="${el.dataset.list}-${i}"]`);
      return renameItem(el.dataset.list, i, input.value);
    }
    case "delItem": return deleteItem(el.dataset.list, Number(el.dataset.index));
  }
});

document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "search") {
    ui.search = t.value;
    const list = $("#inv-list");
    if (list) list.innerHTML = inventoryList();
    return;
  }
  if (t.dataset.draft && ui.draft) {
    const f = t.dataset.draft;
    ui.draft[f] = f === "name" ? t.value : Math.max(0, parseInt(t.value, 10) || 0);
  }
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.file === "fds" && ui.draft) {
    const file = t.files[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      ui.draft.fdsFile = null;
      ui.error = "El archivo debe ser un PDF.";
    } else {
      ui.draft.fdsFile = file;
      ui.error = "";
    }
    render();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (e.target.id === "manual-code") handleCode(e.target.value);
  if (e.target.id === "prog-code") unlock();
});

document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

/* ---------- Leer QR desde una foto ---------- */
document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.dataset.file !== "qr") return;
  const file = t.files[0];
  t.value = "";
  if (!file) return;
  if (!window.Html5Qrcode) {
    ui.scanMsg = "No se pudo cargar el lector QR.";
    return updateScanMsg();
  }
  ui.scanMsg = "Leyendo la foto…";
  updateScanMsg();
  try {
    const reader = new Html5Qrcode("qr-file");
    const text = await reader.scanFile(file, false);
    handleCode(text);
  } catch (err) {
    ui.scanMsg = "No se encontró ningún QR en la foto. Acércate más y vuelve a intentarlo.";
    updateScanMsg();
  }
});

/* ---------- Arranque ---------- */
async function init() {
  try {
    await loadLists();
    await loadProducts();
  } catch (e) {
    ui.loadError = "No se pudo conectar con la base de datos. Revisa SUPABASE_URL y SUPABASE_ANON_KEY en app.js.";
  }
  ui.loading = false;
  openFromUrl();
  setInterval(refresh, 15000);
}

init();
