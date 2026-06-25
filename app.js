/* RIP · Cuenta de cobro (Docentes)
   Categorías = P
   Cantidad = SUMA(O)
   Agrupa por Docente(H) + Categoría(P)
   + Click en celda => abre detalle (Nombre D, Fecha E, Cantidad O)

   Hardened:
   - Docente: normaliza espacios invisibles/dobles y agrupa/filtra por clave estable
   - Fecha: parser tolerante (dd/mm, yyyy/mm, con hora, AM/PM, serial Sheets)
*/

const CFG = window.RIP_CONFIG;

const $ = (s) => document.querySelector(s);

const el = {
  estado: $("#estado"),
  dot: $("#statusDot"),

  mes: $("#mes"),
  btnModoRango: $("#btnModoRango"),
  desde: $("#desde"),
  hasta: $("#hasta"),

  dlgDetalle: $("#dlgDetalle"),
  detalleTitle: $("#detalleTitle"),
  detalleSub: $("#detalleSub"),
  detalleResumen: $("#detalleResumen"),
  detalleBody: $("#detalleBody"),
  detalleTotal: $("#detalleTotal"),

  docentesBox: $("#docentesBox"),
  docentesBtn: $("#docentesBtn"),
  docentesPanel: $("#docentesPanel"),
  docentesList: $("#docentesList"),
  docentesSearch: $("#docentesSearch"),
  docentesLabel: $("#docentesLabel"),
  docentesAll: $("#docentesAll"),
  docentesNone: $("#docentesNone"),

  btnCargar: $("#btnCargar"),
  btnExport: $("#btnExport"),
  btnSeguimiento: $("#btnSeguimiento"),
  btnFlujo: $("#btnFlujo"),

  dlgFlujo: $("#dlgFlujo"),
  flujoTitle: $("#flujoTitle"),
  flujoSub: $("#flujoSub"),
  flujoNote: $("#flujoNote"),
  flujoStatusBar: $("#flujoStatusBar"),
  flujoStatusTxt: $("#flujoStatusTxt"),
  flujoBody: $("#flujoBody"),
  flujoOpts: $("#flujoOpts"),
  flujoReemplazar: $("#flujoReemplazar"),
  flujoComprobar: $("#flujoComprobar"),
  flujoGuardar: $("#flujoGuardar"),

  kpiFilas: $("#kpiFilas"),
  kpiFiltradas: $("#kpiFiltradas"),
  kpiCantidad: $("#kpiCantidad"),
  kpiValor: $("#kpiValor"),

  tabla: $("#tabla"),
  thead: $("#tabla thead"),
  tbody: $("#tabla tbody"),
  tfoot: $("#tabla tfoot"),

  btnVerTarifas: $("#btnVerTarifas"),
  dlgTarifas: $("#dlgTarifas"),
  tarifasBody: $("#tarifasBody"),
  btnAgregarTarifa: $("#btnAgregarTarifa"),
  btnGuardarTarifas: $("#btnGuardarTarifas"),
  btnResetTarifas: $("#btnResetTarifas"),
};

let tarifas = loadTarifas();
let last = null; // { out, cats, totals, filtros, details }
let modoRango = "26_25"; // "26_25" | "1_fin"

/* ---------- UI status ---------- */

function setStatus(text, kind = "muted") {
  el.estado.textContent = text;
  el.dot.className = "dot";
  if (kind === "ok") el.dot.classList.add("ok");
  else if (kind === "warn") el.dot.classList.add("warn");
  else if (kind === "danger") el.dot.classList.add("danger");
}

/* ---------- Helpers (strings) ---------- */

// Normaliza: quita espacios invisibles, colapsa whitespace, trim.
// Evita docentes duplicados por NBSP o caracteres invisibles.
function norm(s) {
  return String(s ?? "")
    .replaceAll("\u00A0", " ")  // NBSP
    .replaceAll("\u200B", "")   // zero-width
    .replaceAll("\u200C", "")
    .replaceAll("\u200D", "")
    .replaceAll("\uFEFF", "")   // BOM
    .replace(/\s+/g, " ")
    .trim();
}

function upper(s) { return norm(s).toUpperCase(); }

// Clave estable para agrupar/filtrar docentes.
// Incluye quitar tildes para evitar "José" vs "Jose".
function keyDocente(s) {
  const t = upper(s);
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------- Datos ---------- */

let firebaseApp = null;
let firestoreDb = null;
let firestoreUnsubscribe = null;
let firestoreDocsById = new Map();
let firestoreInitialLoad = null;
let firestoreLoaded = false;
let firestoreQueryKey = "";
let autoLoadStarted = false;

function initFirebase() {
  if (!window.firebase) {
    throw new Error("Firebase SDK no cargo. Revisa tu conexion a internet.");
  }
  if (!firebaseApp) {
    firebaseApp = firebase.apps?.length ? firebase.app() : firebase.initializeApp(CFG.FIREBASE_CONFIG);
    firestoreDb = firebase.firestore();
  }
  return firestoreDb;
}

function clearCalculatedView() {
  el.thead.innerHTML = "";
  el.tbody.innerHTML = "";
  el.tfoot.innerHTML = "";

  el.kpiFilas.textContent = "0";
  el.kpiFiltradas.textContent = "0";
  el.kpiCantidad.textContent = "0";
  el.kpiValor.textContent = money(0);
}

function fieldFirst(obj, names) {
  for (const name of names) {
    if (obj?.[name] !== undefined && obj?.[name] !== null) return obj[name];
  }
  return "";
}

function firestoreValueToCell(value) {
  if (value?.toDate && typeof value.toDate === "function") return value.toDate();
  if (value && typeof value === "object" && Number.isFinite(value.seconds)) {
    return new Date(value.seconds * 1000);
  }
  return value;
}

function firestoreQty(obj) {
  const explicitQty = fieldFirst(obj, ["O", "o", "cantidad", "Cantidad", "cant", "Cant"]);
  if (explicitQty !== "") return explicitQty;

  const movimiento = fieldFirst(obj, ["movimiento", "Movimiento"]);
  const n = Number(movimiento);
  if (Number.isFinite(n) && n !== 0) return Math.abs(n);

  return 1;
}

const USELESS_CLASIF = /^(NO\s*CLASIF|SIN\s*CATEG|SIN\s*CLASIF|NO\s*CATEG)/;

function serviceBaseCategory(obj) {
  const clasifRaw = upper(norm(fieldFirst(obj, ["L", "l", "clasificacion", "clasificación", "clasifFinal", "clasif"])));
  const servicioRaw = upper(norm(fieldFirst(obj, ["servicio", "Servicio", "categoria", "Categoria", "F", "f"])));
  const key = (!clasifRaw || USELESS_CLASIF.test(clasifRaw)) ? servicioRaw : clasifRaw;

  if (!key) return "";
  if (key === "TV") return "TV";
  if (key.startsWith("MV:")) return "MV P";
  if (key.startsWith("MH:")) return "MH P";
  if (key.startsWith("MS:")) return "MS P";
  if (key.startsWith("ME:") || key.includes("MUSICALA ESPACIOS")) return "MS P";
  if (key.includes("MUSICALA VIRTUAL") || key.startsWith("MV")) return /\bMV\s*G\b|GRUP/.test(key) ? "MV G" : "MV P";
  if (key.includes("MUSICALA HOGAR") || key.startsWith("MH")) return /\bMH\s*G\b|GRUP/.test(key) ? "MH G" : "MH P";
  if (key.includes("MUSICALA SEDE") || key.startsWith("MS")) return /\bMS\s*G\b|GRUP/.test(key) ? "MS G" : "MS P";
  if (key.includes("SPACES")) return "SPACES";
  if (key.includes("TALLER")) return "TALLER";
  if (key.includes("ENSAMBLE") || key.includes("ENSEMBLE")) return "ENSAMBLE";
  return key;
}

function finalCategory(obj, participantCount = 1) {
  const tipo = upper(fieldFirst(obj, ["O", "o", "tipo", "Tipo"]));
  const servicio = norm(fieldFirst(obj, ["F", "f", "servicio", "Servicio", "categoria", "Categoria"]));
  const servicioKey = upper(servicio);

  if (tipo === "PAGO") {
    if (servicioKey.includes("MUSICALA VIRTUAL") || servicioKey.startsWith("MV")) return servicioKey.includes(" G") ? "MV G" : "MV P";
    if (servicioKey.includes("MUSICALA HOGAR") || servicioKey.startsWith("MH")) return servicioKey.includes(" G") ? "MH G" : "MH P";
    if (servicioKey.includes("MUSICALA SEDE") || servicioKey.startsWith("MS")) return servicioKey.includes(" G") ? "MS G" : "MS P";
    if (servicioKey.includes("SPACES")) return "SPACES";
    if (servicioKey.includes("TALLER")) return participantCount > 1 ? "MS G" : "MS P";
    if (servicioKey.includes("ENSAMBLE") || servicioKey.includes("ENSEMBLE")) return participantCount > 1 ? "MS G" : "MS P";
    return "PAGO";
  }

  const clasif = upper(fieldFirst(obj, ["J", "j", "clasif", "clasificacion", "clasificación"]));
  if (clasif === "MULTA") return "MULTA";

  const base = serviceBaseCategory(obj);
  if (base === "MV G" || base === "MV P") return participantCount > 1 ? "MV G" : "MV P";
  if (base === "MH G" || base === "MH P") return participantCount > 1 ? "MH G" : "MH P";
  if (base === "MS G" || base === "MS P") return participantCount > 1 ? "MS G" : "MS P";
  if (base === "TALLER" || base === "ENSAMBLE") return participantCount > 1 ? "MS G" : "MS P";
  if (base === "TV") return "MS G";
  return base || "SIN_CATEGORIA";
}

function classCountKey(obj) {
  const unique = norm(fieldFirst(obj, ["K", "k", "classUniqueId", "claseId", "claseKey"]));
  if (unique) return unique;

  const docente = keyDocente(fieldFirst(obj, ["profesor", "Profesor", "docente", "Docente"]));
  const servicio = upper(fieldFirst(obj, ["servicio", "Servicio", "categoria", "Categoria"]));
  const fecha = norm(fieldFirst(obj, ["fecha", "Fecha", "fechaRaw", "FechaRaw"]));
  const hora = norm(fieldFirst(obj, ["hora", "Hora"]));
  return `${fecha}|${servicio}|${hora}|${docente}`;
}

function participantCountsByClass(docs) {
  const counts = new Map();
  for (const obj of docs) {
    const key = classCountKey(obj);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function isGroupCategory(cat) {
  return ["MH G", "MS G", "MV G"].includes(upper(cat));
}

function firestoreDocToRow(obj, participantCount = 1, qtyOverride = null) {
  const rawRow = obj.row || obj.cells || obj.valores || obj.values || obj.data;
  if (Array.isArray(rawRow)) return rawRow.map(firestoreValueToCell);

  const cat = finalCategory(obj, participantCount);
  const row = [];
  row[3] = firestoreValueToCell(fieldFirst(obj, ["D", "d", "nombre", "Nombre", "estudiante", "Estudiante"]));
  row[CFG.IDX.FECHA] = firestoreValueToCell(fieldFirst(obj, ["E", "e", "fecha", "Fecha", "fechaRaw", "FechaRaw"]));
  row[CFG.IDX.DOCENTE] = firestoreValueToCell(fieldFirst(obj, ["H", "h", "docente", "Docente", "profesor", "Profesor"]));
  row[CFG.IDX.CANT] = firestoreValueToCell(qtyOverride ?? firestoreQty(obj));
  row[CFG.IDX.CAT] = firestoreValueToCell(cat);
  return row;
}

async function ensureAuth() {
  initFirebase();
  const auth = firebase.auth();
  await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
  if (auth.currentUser) return auth.currentUser;

  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await auth.signInWithPopup(provider);
  return result.user;
}

function watchAuthAndAutoload() {
  initFirebase();
  firebase.auth().onAuthStateChanged((user) => {
    if (user) {
      if (autoLoadStarted) return;
      autoLoadStarted = true;
      setStatus(`Sesión iniciada: ${user.email || "Google"}. Cargando...`, "warn");
      cargarYCalcular();
      return;
    }

    autoLoadStarted = false;
    stopFirestoreListener();
    clearCalculatedView();
    setStatus("Inicia sesión con Cargar & Calcular.", "muted");
  });
}

function firestoreYearsForFilters(filtros) {
  const years = new Set();
  if (filtros?.desde) years.add(filtros.desde.getFullYear());
  if (filtros?.hasta) years.add(filtros.hasta.getFullYear());
  return Array.from(years).sort();
}

function stopFirestoreListener() {
  if (firestoreUnsubscribe) firestoreUnsubscribe();
  firestoreUnsubscribe = null;
  firestoreDocsById = new Map();
  firestoreInitialLoad = null;
  firestoreLoaded = false;
}

async function startFirestoreListener(filtros = null) {
  await ensureAuth();
  const db = initFirebase();
  const collectionName = CFG.FIRESTORE_COLLECTION || "rip";
  const years = firestoreYearsForFilters(filtros);
  const queryKey = `${collectionName}|years:${years.join(",") || "all"}`;

  if (firestoreInitialLoad && firestoreQueryKey === queryKey) return firestoreInitialLoad;
  if (firestoreQueryKey && firestoreQueryKey !== queryKey) stopFirestoreListener();

  firestoreQueryKey = queryKey;
  let ref = db.collection(collectionName);
  if (years.length === 1) {
    ref = ref.where("year", "==", years[0]);
  } else if (years.length > 1) {
    ref = ref.where("year", "in", years);
  }

  if (firestoreInitialLoad) return firestoreInitialLoad;

  firestoreInitialLoad = new Promise((resolve, reject) => {
    firestoreUnsubscribe = ref.onSnapshot((snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "removed") {
          firestoreDocsById.delete(change.doc.id);
        } else {
          firestoreDocsById.set(change.doc.id, change.doc.data() || {});
        }
      });

      firestoreLoaded = true;
      resolve();

      if (last) {
        calcularConDatos(getFirestoreRows(), { silent: true });
      }
    }, (err) => {
      firestoreInitialLoad = null;
      reject(err);
    });
  });

  return firestoreInitialLoad;
}

function getFirestoreRows() {
  const docs = Array.from(firestoreDocsById.values());
  const counts = participantCountsByClass(docs);
  const countedGroupClasses = new Set();

  return docs.map((obj) => {
    const key = classCountKey(obj);
    const participantCount = counts.get(key) || 1;
    const cat = finalCategory(obj, participantCount);
    let qty = firestoreQty(obj);

    if (isGroupCategory(cat)) {
      if (countedGroupClasses.has(key)) qty = 0;
      else {
        countedGroupClasses.add(key);
        qty = 1;
      }
    }

    return firestoreDocToRow(obj, participantCount, qty);
  });
}

/* ---------- Fecha ultra-tolerante ---------- */

function dateFromSerial(n) {
  // 25569 = días entre 1899-12-30 y 1970-01-01
  const ms = (Number(n) - 25569) * 86400 * 1000;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d;
}

function parseDateFlexible(s) {
  if (s instanceof Date) return isNaN(s.getTime()) ? null : s;
  const t0 = norm(s);
  if (!t0) return null;

  // 1) Serial numérico (Sheets/Excel)
  if (/^\d+(\.\d+)?$/.test(t0)) {
    const serial = Number(t0);
    // si es un año tipo 2026 no es serial, lo ignoramos aquí
    if (serial > 20000 && serial < 90000) {
      const d = dateFromSerial(serial);
      if (d) return d;
    }
  }

  // 2) Normaliza AM/PM estilo Sheets: "6:30 p. m."
  let t = t0
    .replace(/\b(a\.?\s*m\.?)\b/gi, "AM")
    .replace(/\b(p\.?\s*m\.?)\b/gi, "PM");

  // 3) Si tiene / o -, NO usamos Date() primero.
  // Primero intentamos dd/mm/yyyy y yyyy/mm/dd (con hora opcional).
  // Esto evita el bug MM/DD del navegador.

  // dd/mm/yyyy o dd-mm-yyyy con hora opcional
  let m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (m) {
    let dd = Number(m[1]);
    let mm = Number(m[2]);
    let yy = Number(m[3]);

    if (yy < 100) yy = 2000 + yy;

    let hh = m[4] ? Number(m[4]) : 0;
    let mi = m[5] ? Number(m[5]) : 0;
    let ss = m[6] ? Number(m[6]) : 0;
    const ap = (m[7] || "").toUpperCase();

    if (ap === "PM" && hh < 12) hh += 12;
    if (ap === "AM" && hh === 12) hh = 0;

    const d = new Date(yy, mm - 1, dd, hh, mi, ss);
    return isNaN(d.getTime()) ? null : d;
  }

  // yyyy/mm/dd o yyyy-mm-dd con hora opcional
  m = t.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (m) {
    const yy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);

    let hh = m[4] ? Number(m[4]) : 0;
    let mi = m[5] ? Number(m[5]) : 0;
    let ss = m[6] ? Number(m[6]) : 0;
    const ap = (m[7] || "").toUpperCase();

    if (ap === "PM" && hh < 12) hh += 12;
    if (ap === "AM" && hh === 12) hh = 0;

    const d = new Date(yy, mm - 1, dd, hh, mi, ss);
    return isNaN(d.getTime()) ? null : d;
  }

  // 4) Último recurso: Date() nativo (ISO y similares)
  const dNative = new Date(t);
  return isNaN(dNative.getTime()) ? null : dNative;
}

/* ---------- Formatters ---------- */

function ymd(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
}

function parseNumberFlexible(v) {
  const t = norm(v);
  if (!t) return 0;
  const cleaned = t.replace(/\s+/g, "").replace(",", ".");
  const num = Number(cleaned);
  return isNaN(num) ? 0 : num;
}

function formatQty(x) {
  const n = Number(x || 0);
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString("es-CO", { maximumFractionDigits: 2 });
}

/* ---------- Tarifas ---------- */

function loadTarifas() {
  const raw = localStorage.getItem(CFG.LS_KEY_TARIFAS);
  if (!raw) return structuredClone(CFG.DEFAULT_TARIFAS);
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("Tarifas inválidas");
    return obj;
  } catch {
    return structuredClone(CFG.DEFAULT_TARIFAS);
  }
}

function saveTarifas() {
  localStorage.setItem(CFG.LS_KEY_TARIFAS, JSON.stringify(tarifas));
}

/* ---------- Multi select docentes ---------- */

let docentesAll = [];        // display names
let docentesSelected = null; // Set de display names o null=Todos

function labelDocentes() {
  if (!docentesSelected) return "Todos";
  const n = docentesSelected.size;
  if (n === 0) return "Ninguno";
  if (n === 1) return Array.from(docentesSelected)[0];
  return `${n} seleccionados`;
}

function renderDocentesList(filterText = "") {
  const q = keyDocente(filterText);
  const items = docentesAll.filter(d => keyDocente(d).includes(q));

  el.docentesList.innerHTML = items.map(d => {
    const checked = !docentesSelected ? true : docentesSelected.has(d);
    return `
      <label class="item">
        <input type="checkbox" ${checked ? "checked" : ""}>
        <span>${escapeHtml(d)}</span>
      </label>
    `;
  }).join("");

  el.docentesLabel.textContent = labelDocentes();
}

function syncSelectedFromCheckboxes() {
  if (!docentesSelected) docentesSelected = new Set(docentesAll);

  const checks = Array.from(el.docentesList.querySelectorAll("input[type=checkbox]"));
  for (const c of checks) {
    const name = c.parentElement.querySelector("span").textContent;
    if (c.checked) docentesSelected.add(name);
    else docentesSelected.delete(name);
  }

  if (docentesSelected.size === docentesAll.length) docentesSelected = null;
  el.docentesLabel.textContent = labelDocentes();
}

function openDocentesPanel() {
  el.docentesPanel.hidden = false;
  el.docentesSearch.value = "";
  renderDocentesList("");
  el.docentesSearch.focus();
}

function closeDocentesPanel() {
  el.docentesPanel.hidden = true;
}

/* ---------- Filtros fechas ---------- */

function applyMonthToRange() {
  const m = el.mes.value;
  if (!m) return;
  const [yy, mm] = m.split("-").map(Number);
  if (!yy || !mm) return;
  let desde;
  let hasta;
  if (modoRango === "1_fin") {
    desde = new Date(yy, mm - 1, 1);
    hasta = new Date(yy, mm, 0);
  } else {
    desde = new Date(yy, mm - 2, 26);
    hasta = new Date(yy, mm - 1, 25);
  }
  el.desde.value = ymd(desde);
  el.hasta.value = ymd(hasta);
}

function monthNameEs(monthNumber1to12) {
  const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  return months[Math.max(1, Math.min(12, monthNumber1to12)) - 1];
}

function fmtDateDMY(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function refreshModoRangoBtn() {
  if (!el.btnModoRango) return;
  el.btnModoRango.textContent = modoRango === "1_fin" ? "Modo: 1 -> fin de mes" : "Modo: 26 -> 25";
}

function getFilters() {
  const desdeStr = el.desde.value;
  const hastaStr = el.hasta.value;

  const desde = desdeStr ? new Date(desdeStr + "T00:00:00") : null;
  const hasta = hastaStr ? new Date(hastaStr + "T23:59:59") : null;

  return { desdeStr, hastaStr, desde, hasta };
}

/* ---------- Detalle modal ---------- */

function openDetalle(docenteDisplay, cat) {
  if (!last?.details) return;

  const kdoc = keyDocente(docenteDisplay);
  const key = kdoc + "||" + cat;
  const rows = (last.details.get(key) || []).slice();

  rows.sort((a, b) => a.fecha - b.fecha);

  el.detalleTitle.textContent = `${docenteDisplay} · ${cat}`;
  el.detalleSub.textContent = `Rango: ${last.filtros.desdeStr || "inicio"} → ${last.filtros.hastaStr || "hoy"}`;

  let total = 0;

  el.detalleBody.innerHTML = rows.map(x => {
    total += x.qty;
    const f = ymd(x.fecha);
    const nombre = norm(x.nombre) || "(Sin nombre)";
    return `<tr>
      <td>${escapeHtml(nombre)}</td>
      <td>${f}</td>
      <td style="text-align:right;">${formatQty(x.qty)}</td>
    </tr>`;
  }).join("");

  el.detalleTotal.textContent = formatQty(total);
  el.detalleResumen.innerHTML = `<b>${rows.length}</b> registros · <b>Total ΣO:</b> ${formatQty(total)}`;

  el.dlgDetalle.showModal();
}

/* ---------- Render tabla ---------- */

function renderTable(out, cats, totals) {
  const cols = ["Docente", ...cats, "Total cantidad", "Valor cuenta de cobro"];
  el.thead.innerHTML = "<tr>" + cols.map(c => `<th>${escapeHtml(c)}</th>`).join("") + "</tr>";

  el.tbody.innerHTML = out.map(r => {
    const cells = [];
    cells.push(`<td><strong>${escapeHtml(r.docente)}</strong></td>`);

    for (const cat of cats) {
      const v = r.cats[cat] || 0;
      const shown = formatQty(v);

      if (v !== 0) {
        cells.push(`<td class="clickable" data-doc="${escapeHtml(r.docente)}" data-cat="${escapeHtml(cat)}">${shown}</td>`);
      } else {
        cells.push(`<td>${shown}</td>`);
      }
    }

    cells.push(`<td><strong>${formatQty(r.totalQty)}</strong></td>`);
    cells.push(`<td><strong>${money(r.value)}</strong></td>`);
    return "<tr>" + cells.join("") + "</tr>";
  }).join("");

  const foot = [];
  foot.push(`<td><strong>Total</strong></td>`);
  for (const cat of cats) foot.push(`<td><strong>${formatQty(totals.byCat[cat] || 0)}</strong></td>`);
  foot.push(`<td><strong>${formatQty(totals.totalQty)}</strong></td>`);
  foot.push(`<td><strong>${money(totals.totalValue)}</strong></td>`);
  el.tfoot.innerHTML = "<tr>" + foot.join("") + "</tr>";
}

/* ---------- Export ---------- */

function exportCSV() {
  if (!last) return;
  const { out, cats, filtros } = last;

  const header = ["Docente", ...cats, "TotalCantidad", "ValorCuentaCobro"];
  const lines = [header.join(",")];

  for (const r of out) {
    const row = [];
    row.push(`"${r.docente.replaceAll('"', '""')}"`);
    for (const cat of cats) row.push(String(r.cats[cat] || 0));
    row.push(String(r.totalQty));
    row.push(String(r.value));
    lines.push(row.join(","));
  }

  const name = `rip_cuenta_cobro_${(filtros.desdeStr || "inicio")}_a_${(filtros.hastaStr || "hoy")}.csv`;
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Core ---------- */

function calcularConDatos(data, options = {}) {
  const silent = Boolean(options.silent);
  try {
    if (!silent) setStatus("Calculando datos cargados...", "warn");

    const details = new Map();
    // key: kdoc||cat => array de { nombre, fecha: Date, qty: number }

    // DiagnÃ³stico por si vuelve el misterio
    let dropNoDoc = 0;
    let dropBadDate = 0;
    let dropOutRange = 0;

    if (!data.length) throw new Error("La colección de Firebase está vacía.");

    el.kpiFilas.textContent = String(data.length);

    // docentes list (H) deduplicada por clave normalizada
    const seen = new Map(); // kdoc -> display
    for (const r of data) {
      const display = norm(r[CFG.IDX.DOCENTE]);
      if (!display) continue;
      const k = keyDocente(display);
      if (!seen.has(k)) seen.set(k, display);
    }
    docentesAll = Array.from(seen.values()).sort((a, b) => a.localeCompare(b, "es"));

    // normaliza selecciÃ³n existente
    if (docentesSelected && docentesSelected.size) {
      const selectedKeys = new Set(Array.from(docentesSelected).map(keyDocente));
      const rebuilt = new Set();
      for (const d of docentesAll) {
        if (selectedKeys.has(keyDocente(d))) rebuilt.add(d);
      }
      docentesSelected = rebuilt;
      if (docentesSelected.size === docentesAll.length) docentesSelected = null;
    }

    renderDocentesList("");

    const filtros = getFilters();

    let filteredCount = 0;
    const byDoc = new Map(); // kdoc -> row
    const catsSet = new Set();

    // Para filtrar docentes por clave
    const selectedKeys = docentesSelected ? new Set(Array.from(docentesSelected).map(keyDocente)) : null;

    for (const r of data) {
      const docenteDisplay = norm(r[CFG.IDX.DOCENTE]);
      if (!docenteDisplay) { dropNoDoc++; continue; }

      const kdoc = keyDocente(docenteDisplay);
      if (selectedKeys && !selectedKeys.has(kdoc)) continue;

      const fecha = parseDateFlexible(r[CFG.IDX.FECHA]);
      if (!fecha) { dropBadDate++; continue; }

      if (filtros.desde && fecha < filtros.desde) { dropOutRange++; continue; }
      if (filtros.hasta && fecha > filtros.hasta) { dropOutRange++; continue; }

      // Nombre (D) = Ã­ndice 3
      const nombre = norm(r[3]);

      const cat = upper(r[CFG.IDX.CAT]) || "SIN_CATEGORIA";
      const qty = parseNumberFlexible(r[CFG.IDX.CANT]);

      filteredCount++;
      catsSet.add(cat);

      // detalle
      const keyDetail = kdoc + "||" + cat;
      if (!details.has(keyDetail)) details.set(keyDetail, []);
      details.get(keyDetail).push({ nombre, fecha, qty });

      if (!byDoc.has(kdoc)) byDoc.set(kdoc, { docente: docenteDisplay, cats: {}, totalQty: 0, value: 0 });
      const row = byDoc.get(kdoc);

      // preferimos el display mÃ¡s completo/largo
      if (docenteDisplay.length > row.docente.length) row.docente = docenteDisplay;

      row.cats[cat] = (row.cats[cat] || 0) + qty;
      row.totalQty += qty;
    }

    el.kpiFiltradas.textContent = String(filteredCount);

    const cats = Array.from(catsSet).sort((a, b) => a.localeCompare(b, "es"));

    // valor por docente
    for (const row of byDoc.values()) {
      let v = 0;
      for (const cat of cats) {
        const q = row.cats[cat] || 0;
        const rate = Number(tarifas[cat] ?? 0);
        v += q * (isNaN(rate) ? 0 : rate);
      }
      row.value = v;
    }

    const out = Array.from(byDoc.values()).sort((a, b) => a.docente.localeCompare(b.docente, "es"));

    const totals = { byCat: {}, totalQty: 0, totalValue: 0 };
    for (const row of out) {
      totals.totalQty += row.totalQty;
      totals.totalValue += row.value;
      for (const cat of cats) {
        totals.byCat[cat] = (totals.byCat[cat] || 0) + (row.cats[cat] || 0);
      }
    }

    el.kpiCantidad.textContent = formatQty(totals.totalQty);
    el.kpiValor.textContent = money(totals.totalValue);

    renderTable(out, cats, totals);

    last = { out, cats, totals, filtros, details };

    console.table({ dropNoDoc, dropBadDate, dropOutRange });

    setStatus(silent ? "Actualizado desde Firebase." : "Listo ✅", "ok");
  } catch (err) {
    console.error(err);
    setStatus("Error: " + (err.message || err), "danger");

    el.thead.innerHTML = "";
    el.tbody.innerHTML = "";
    el.tfoot.innerHTML = "";

    el.kpiFilas.textContent = "0";
    el.kpiFiltradas.textContent = "0";
    el.kpiCantidad.textContent = "0";
    el.kpiValor.textContent = money(0);
  }
}

async function cargarYCalcular() {
  try {
    const filtros = getFilters();
    const years = firestoreYearsForFilters(filtros);
    const collectionName = CFG.FIRESTORE_COLLECTION || "rip";
    const queryKey = `${collectionName}|years:${years.join(",") || "all"}`;

    if (!firestoreLoaded || firestoreQueryKey !== queryKey) {
      setStatus("Conectando con Firebase...", "warn");
      await startFirestoreListener(filtros);
    }
    calcularConDatos(getFirestoreRows());
  } catch (err) {
    console.error(err);
    setStatus("Error: " + (err.message || err), "danger");

    el.thead.innerHTML = "";
    el.tbody.innerHTML = "";
    el.tfoot.innerHTML = "";

    el.kpiFilas.textContent = "0";
    el.kpiFiltradas.textContent = "0";
    el.kpiCantidad.textContent = "0";
    el.kpiValor.textContent = money(0);
  }
}

function recalcularSiHayDatos() {
  if (!firestoreLoaded) return;
  const filtros = getFilters();
  const years = firestoreYearsForFilters(filtros);
  const collectionName = CFG.FIRESTORE_COLLECTION || "rip";
  const queryKey = `${collectionName}|years:${years.join(",") || "all"}`;
  if (firestoreQueryKey !== queryKey) {
    cargarYCalcular();
    return;
  }
  calcularConDatos(getFirestoreRows());
}

/* ---------- Tarifas UI ---------- */

function openTarifas() {
  if (el.tarifasBody) renderTarifasRows();
  el.dlgTarifas.showModal();
}

async function enviarSeguimientoPagos() {
  if (!last?.out?.length) {
    setStatus("Primero carga y calcula.", "warn");
    return;
  }

  const m = el.mes?.value || "";
  let year;
  let month;
  if (m && /^\d{4}-\d{2}$/.test(m)) {
    [year, month] = m.split("-").map(Number);
  } else {
    const d = new Date();
    year = d.getFullYear();
    month = d.getMonth() + 1;
  }

  const mesNombre = monthNameEs(month);
  const fechaPago = new Date(year, month, 1); // 1 del mes siguiente al mes elegido
  const diaSugerido = fmtDateDMY(fechaPago);

  const lines = last.out.map((r) => {
    const nombre = r.docente || "";
    const categoria = "Cuenta de cobro";
    const subcategoria = "Docentes";
    const valor = Math.round(Number(r.value || 0));
    return [
      nombre,        // A Nombre
      categoria,     // B Categoria
      subcategoria,  // C Subcategoria
      valor,         // D Valor Cuenta de cobro
      mesNombre,     // E Mes
      diaSugerido,   // F Dia sugerido
      "",            // G (formula en sheet)
      "",            // H (formula en sheet)
      ""             // I (formula en sheet)
    ].join("\t");
  });

  const tsv = lines.join("\n");

  try {
    await navigator.clipboard.writeText(tsv);
    setStatus(`Seguimiento listo: ${lines.length} filas copiadas.`, "ok");
  } catch {
    const blob = new Blob([tsv], { type: "text/tab-separated-values;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `seguimiento_pagos_${year}_${String(month).padStart(2, "0")}.tsv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("No pude copiar al portapapeles. Descargué TSV.", "warn");
  }
}

function renderTarifasRows() {
  if (!el.tarifasBody) return;
  const rows = Object.entries(tarifas)
    .sort((a, b) => a[0].localeCompare(b[0], "es"));

  if (!rows.length) {
    addTarifaRow();
    return;
  }

  el.tarifasBody.innerHTML = rows.map(([cat, value]) => `
    <tr>
      <td><input class="rateInput rateCat" type="text" value="${escapeHtml(cat)}" placeholder="Categoria"></td>
      <td><input class="rateInput rateValue" type="text" value="${Number(value || 0)}" inputmode="numeric" placeholder="0"></td>
      <td><button class="rateDel" type="button" title="Eliminar">X</button></td>
    </tr>
  `).join("");
}

function addTarifaRow(cat = "", value = 0) {
  if (!el.tarifasBody) return;
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input class="rateInput rateCat" type="text" value="${escapeHtml(cat)}" placeholder="Categoria"></td>
    <td><input class="rateInput rateValue" type="text" value="${Number(value || 0)}" inputmode="numeric" placeholder="0"></td>
    <td><button class="rateDel" type="button" title="Eliminar">X</button></td>
  `;
  el.tarifasBody.appendChild(tr);
}

function parseRateValue(v) {
  const t = norm(v).replaceAll(".", "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function saveTarifasFromUI() {
  try {
    if (!el.tarifasBody) throw new Error("La interfaz de tarifas no está disponible en esta versión.");
    const fixed = {};
    const rows = Array.from(el.tarifasBody.querySelectorAll("tr"));
    for (const row of rows) {
      const cat = upper(row.querySelector(".rateCat")?.value || "");
      if (!cat) continue;
      fixed[cat] = parseRateValue(row.querySelector(".rateValue")?.value || "0");
    }

    if (!Object.keys(fixed).length) throw new Error("Debes ingresar al menos una categoría.");

    tarifas = fixed;
    saveTarifas();
    setStatus("Tarifas guardadas ✅", "ok");
  } catch (e) {
    setStatus("Tarifas inválidas: " + (e.message || e), "danger");
  }
}
/* ---------- Flujo de Caja ---------- */

let flujoApp = null;
let flujoDb  = null;

function initFlujoFirebase() {
  if (!window.firebase) throw new Error("Firebase SDK no cargó.");
  if (!flujoApp) {
    const existing = (firebase.apps || []).find(a => a.name === "flujo");
    flujoApp = existing || firebase.initializeApp(CFG.FLUJO_CONFIG, "flujo");
    flujoDb  = firebase.firestore(flujoApp);
  }
  return flujoDb;
}

async function ensureFlujoAuth() {
  initFlujoFirebase();
  const auth = firebase.auth(flujoApp);
  await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
  if (auth.currentUser) return auth.currentUser;
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await auth.signInWithPopup(provider);
  return result.user;
}

function flujoDocId(año, mes, docente) {
  return `${año}-${String(mes).padStart(2, "0")}-${keyDocente(docente)}`;
}

function getMesAño() {
  const m = el.mes?.value || "";
  if (m && /^\d{4}-\d{2}$/.test(m)) {
    const [año, mes] = m.split("-").map(Number);
    return { año, mes };
  }
  const d = new Date();
  return { año: d.getFullYear(), mes: d.getMonth() + 1 };
}

function flujoSetStatus(txt, kind = "warn") {
  el.flujoStatusBar.hidden = false;
  el.flujoStatusBar.className = `flujoStatusBar ${kind}`;
  el.flujoStatusTxt.textContent = txt;
}

function flujoRenderRows(rows) {
  el.flujoBody.innerHTML = rows.map(r => `
    <tr>
      <td><strong>${escapeHtml(r.docente)}</strong></td>
      <td style="text-align:right;">${money(r.valor)}</td>
      <td style="text-align:center;"><span class="badge ${r.badge}">${escapeHtml(r.estado)}</span></td>
    </tr>
  `).join("");
}

async function abrirDialogFlujo() {
  if (!last?.out?.length) {
    setStatus("Primero carga y calcula.", "warn");
    return;
  }

  const { año, mes } = getMesAño();
  el.flujoTitle.textContent = `Enviar a Flujo de Caja · ${monthNameEs(mes)} ${año}`;
  el.flujoSub.textContent   = `Prestación de servicios · Docentes`;
  el.flujoStatusBar.hidden  = true;
  el.flujoOpts.hidden       = true;
  el.flujoGuardar.disabled  = true;
  el.flujoReemplazar.checked = false;

  const rows = last.out.map(r => ({
    docente: r.docente,
    valor:   Math.round(Number(r.value || 0)),
    badge:   "checking",
    estado:  "Comprobando…",
    id:      flujoDocId(año, mes, r.docente),
  }));

  flujoRenderRows(rows);
  el.dlgFlujo.showModal();

  // auto-comprobar al abrir
  await comprobarFlujoRows(rows, año, mes);
}

async function comprobarFlujoRows(rows, año, mes) {
  flujoSetStatus("Conectando con Flujo de Caja…", "warn");
  try {
    await ensureFlujoAuth();
    const db = initFlujoFirebase();
    const col = CFG.FLUJO_COLLECTION;

    const snapshots = await Promise.all(
      rows.map(r => db.collection(col).doc(r.id).get())
    );

    let nuevos = 0, existen = 0;
    snapshots.forEach((snap, i) => {
      if (snap.exists) {
        rows[i].badge  = "existe";
        rows[i].estado = "Ya existe";
        existen++;
      } else {
        rows[i].badge  = "nuevo";
        rows[i].estado = "Nuevo";
        nuevos++;
      }
    });

    flujoRenderRows(rows);
    el.flujoOpts.hidden    = false;
    el.flujoGuardar.disabled = false;

    if (existen === 0) {
      flujoSetStatus(`✅ ${nuevos} registros nuevos listos para guardar.`, "ok");
    } else if (nuevos === 0) {
      flujoSetStatus(`⚠️ Todos los ${existen} registros ya existen. Activa "Reemplazar" si quieres actualizar.`, "warn");
    } else {
      flujoSetStatus(`${nuevos} nuevos · ${existen} ya existen (activa "Reemplazar" para actualizarlos).`, "warn");
    }

    // guardar rows en closure para uso posterior
    el.flujoGuardar._rows = rows;
    el.flujoGuardar._año  = año;
    el.flujoGuardar._mes  = mes;

  } catch (err) {
    flujoSetStatus("Error al comprobar: " + (err.message || err), "err");
  }
}

async function guardarEnFlujo() {
  const rows      = el.flujoGuardar._rows;
  const año       = el.flujoGuardar._año;
  const mes       = el.flujoGuardar._mes;
  const reemplazar = el.flujoReemplazar.checked;

  if (!rows?.length) return;

  const toSave = rows.filter(r => r.badge === "nuevo" || (reemplazar && r.badge === "existe"));
  if (!toSave.length) {
    flujoSetStatus("Nada que guardar. Activa 'Reemplazar' si quieres sobrescribir los existentes.", "warn");
    return;
  }

  el.flujoGuardar.disabled   = true;
  el.flujoComprobar.disabled = true;
  flujoSetStatus(`Guardando ${toSave.length} registros…`, "warn");

  try {
    const db  = initFlujoFirebase();
    const col = CFG.FLUJO_COLLECTION;
    const mesNombre = monthNameEs(mes);
    const rango = last?.filtros
      ? `${last.filtros.desdeStr || ""} → ${last.filtros.hastaStr || ""}`
      : "";

    const ts = firebase.firestore.FieldValue.serverTimestamp();

    await Promise.all(toSave.map(r =>
      db.collection(col).doc(r.id).set({
        tipo:        "prestacion_docente",
        docente:     r.docente,
        valor:       r.valor,
        mes,
        año,
        mesNombre,
        rango,
        estado:      "pendiente",
        creadoEn:    ts,
      })
    ));

    // actualizar badges
    toSave.forEach(r => {
      const row = rows.find(x => x.id === r.id);
      if (row) { row.badge = "guardado"; row.estado = "Guardado ✅"; }
    });
    flujoRenderRows(rows);
    flujoSetStatus(`✅ ${toSave.length} registros guardados como pendientes de pago.`, "ok");

  } catch (err) {
    flujoSetStatus("Error al guardar: " + (err.message || err), "err");
  } finally {
    el.flujoGuardar.disabled   = false;
    el.flujoComprobar.disabled = false;
  }
}

/* ---------- Eventos ---------- */

function setup() {
  // defaults: mes actual
  const now = new Date();
  el.mes.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  refreshModoRangoBtn();
  applyMonthToRange();

  setStatus("Sin cargar", "muted");

  if (el.mes) el.mes.addEventListener("change", () => {
    applyMonthToRange();
    recalcularSiHayDatos();
  });
  if (el.desde) el.desde.addEventListener("change", recalcularSiHayDatos);
  if (el.hasta) el.hasta.addEventListener("change", recalcularSiHayDatos);
  if (el.btnModoRango) {
    el.btnModoRango.addEventListener("click", () => {
      modoRango = modoRango === "26_25" ? "1_fin" : "26_25";
      refreshModoRangoBtn();
      applyMonthToRange();
      recalcularSiHayDatos();
    });
  }

  if (el.docentesBtn) el.docentesBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    if (el.docentesPanel.hidden) openDocentesPanel();
    else closeDocentesPanel();
  });

  document.addEventListener("click", (ev) => {
    if (!el.docentesBox.contains(ev.target)) closeDocentesPanel();
  });

  if (el.docentesSearch) el.docentesSearch.addEventListener("input", () => renderDocentesList(el.docentesSearch.value));

  if (el.docentesAll) el.docentesAll.addEventListener("click", () => {
    docentesSelected = null;
    renderDocentesList(el.docentesSearch.value);
    recalcularSiHayDatos();
  });

  if (el.docentesNone) el.docentesNone.addEventListener("click", () => {
    docentesSelected = new Set();
    renderDocentesList(el.docentesSearch.value);
    recalcularSiHayDatos();
  });

  if (el.docentesList) el.docentesList.addEventListener("change", () => {
    syncSelectedFromCheckboxes();
    recalcularSiHayDatos();
  });

  if (el.btnCargar) el.btnCargar.addEventListener("click", () => {
    applyMonthToRange();
    cargarYCalcular();
  });

  if (el.btnExport) el.btnExport.addEventListener("click", exportCSV);
  if (el.btnSeguimiento) el.btnSeguimiento.addEventListener("click", enviarSeguimientoPagos);
  if (el.btnFlujo) el.btnFlujo.addEventListener("click", abrirDialogFlujo);
  if (el.flujoComprobar) el.flujoComprobar.addEventListener("click", () => {
    const rows = el.flujoGuardar._rows;
    const { año, mes } = getMesAño();
    if (rows) comprobarFlujoRows(rows, año, mes);
  });
  if (el.flujoGuardar) el.flujoGuardar.addEventListener("click", guardarEnFlujo);

  // Click en celda => detalle
  if (el.tabla) el.tabla.addEventListener("click", (ev) => {
    const td = ev.target.closest("td.clickable");
    if (!td || !last) return;
    const docente = td.getAttribute("data-doc") || "";
    const cat = td.getAttribute("data-cat") || "";
    if (!docente || !cat) return;
    openDetalle(docente, cat);
  });

  if (el.btnVerTarifas) el.btnVerTarifas.addEventListener("click", openTarifas);

  if (el.btnAgregarTarifa) {
    el.btnAgregarTarifa.addEventListener("click", () => addTarifaRow());
  }

  if (el.tarifasBody) {
    el.tarifasBody.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".rateDel");
      if (!btn) return;
      const tr = btn.closest("tr");
      if (!tr) return;
      tr.remove();
      if (!el.tarifasBody.querySelector("tr")) addTarifaRow();
    });
  }

  if (el.btnGuardarTarifas) el.btnGuardarTarifas.addEventListener("click", () => {
    saveTarifasFromUI();
    recalcularSiHayDatos();
  });

  if (el.btnResetTarifas) el.btnResetTarifas.addEventListener("click", () => {
    tarifas = structuredClone(CFG.DEFAULT_TARIFAS);
    saveTarifas();
    setStatus("Tarifas reseteadas (demo).", "warn");
    if (el.dlgTarifas.open) renderTarifasRows();
    recalcularSiHayDatos();
  });

  watchAuthAndAutoload();
}
try {
  setup();
} catch (err) {
  console.error("Error en setup:", err);
  setStatus("Error de interfaz. Recarga con Ctrl+F5.", "danger");
}

