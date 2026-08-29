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
  tarifasHead: $("#dlgTarifas thead"),
  tarifasBody: $("#tarifasBody"),
  btnAgregarTarifa: $("#btnAgregarTarifa"),
  btnGuardarTarifas: $("#btnGuardarTarifas"),
  btnResetTarifas: $("#btnResetTarifas"),
  btnVerJornadas: $("#btnVerJornadas"),
  dlgJornadas: $("#dlgJornadas"),
  jornadasBody: $("#jornadasBody"),
  btnAgregarJornada: $("#btnAgregarJornada"),
  btnGuardarJornadas: $("#btnGuardarJornadas"),
};

let tarifasDefaults = structuredClone(CFG.DEFAULT_TARIFAS || {});
let tarifasDocentes = {};
let tarifasLoaded = false;
let jornadas = loadJornadas();
let jornadasLoaded = false;
let last = null; // { out, cats, totals, filtros, details }
let modoRango = "26_25"; // "26_25" | "1_fin"
let tarifaDocenteActivo = "";
let tarifasVista = "docente";

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
let firestoreRecalcTimer = null;

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

function classCountKey(obj, forceComposite = false) {
  const unique = norm(fieldFirst(obj, ["K", "k", "classUniqueId", "claseId", "claseKey"]));
  if (unique && !forceComposite) return unique;

  const docente = keyDocente(fieldFirst(obj, ["profesor", "Profesor", "docente", "Docente"]));
  const servicio = upper(fieldFirst(obj, ["servicio", "Servicio", "categoria", "Categoria"]));
  const fecha = norm(fieldFirst(obj, ["fecha", "Fecha", "fechaRaw", "FechaRaw"]));
  const hora = norm(fieldFirst(obj, ["hora", "Hora"]));
  return `${fecha}|${servicio}|${hora}|${docente}`;
}

function isMusifamiliarRecord(obj) {
  const fields = ["servicio", "Servicio", "categoria", "Categoria", "clasif", "clasificacion", "clasificación", "L", "l", "P", "p"];
  return fields.some((field) => {
    const value = upper(obj?.[field]);
    return value === "MF" || value.includes("MUSIFAMILIAR");
  });
}

function participantCountsByClass(docs) {
  const counts = new Map();
  for (const obj of docs) {
    const key = classCountKey(obj, isMusifamiliarRecord(obj));
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function isGroupCategory(cat) {
  return ["MH G", "MS G", "MV G"].includes(upper(cat));
}

// Musifamiliar se liquida como una clase grupal: varios alumnos del mismo
// docente, servicio, fecha y hora representan una sola clase.
function isGroupLikeCategory(cat) {
  const key = upper(cat);
  return isGroupCategory(key) || key === "MF" || key.includes("MUSIFAMILIAR");
}

function firestoreDocToRow(obj, participantCount = 1, qtyOverride = null) {
  const rawRow = obj.row || obj.cells || obj.valores || obj.values || obj.data;
  // Los documentos antiguos pueden conservar la fila completa en `row`, pero
  // guardar la hora en un campo aparte. No se puede devolver temprano porque
  // se perdería esa hora y una jornada por franja absorbería todas las clases
  // del día.
  if (Array.isArray(rawRow)) {
    const row = rawRow.map(firestoreValueToCell);
    const hora = fieldFirst(obj, ["hora", "Hora", "horaInicio", "horaClase", "inicio", "startTime"]);
    if (hora !== "") row._hora = firestoreValueToCell(hora);
    return row;
  }

  const cat = finalCategory(obj, participantCount);
  const row = [];
  row[3] = firestoreValueToCell(fieldFirst(obj, ["D", "d", "nombre", "Nombre", "estudiante", "Estudiante"]));
  row[CFG.IDX.FECHA] = firestoreValueToCell(fieldFirst(obj, ["E", "e", "fecha", "Fecha", "fechaRaw", "FechaRaw"]));
  // Algunos documentos guardan la fecha y la hora en campos independientes.
  // Conservamos la hora fuera de las columnas visibles para poder aplicar
  // correctamente las jornadas por franja horaria.
  row._hora = firestoreValueToCell(fieldFirst(obj, ["hora", "Hora", "horaInicio", "horaClase", "inicio", "startTime"]));
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
  if (firestoreRecalcTimer) clearTimeout(firestoreRecalcTimer);
  firestoreUnsubscribe = null;
  firestoreRecalcTimer = null;
  firestoreDocsById = new Map();
  firestoreInitialLoad = null;
  firestoreLoaded = false;
}

function scheduleFirestoreRecalc() {
  if (!last) return;
  if (firestoreRecalcTimer) clearTimeout(firestoreRecalcTimer);
  firestoreRecalcTimer = setTimeout(() => {
    firestoreRecalcTimer = null;
    calcularConDatos(getFirestoreRows(), { silent: true, skipFlujoRefresh: true });
  }, 600);
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
      const changes = snap.docChanges();
      if (!changes.length && firestoreLoaded) {
        resolve();
        return;
      }

      changes.forEach((change) => {
        if (change.type === "removed") {
          firestoreDocsById.delete(change.doc.id);
        } else {
          firestoreDocsById.set(change.doc.id, change.doc.data() || {});
        }
      });

      firestoreLoaded = true;
      resolve();

      if (last) {
        scheduleFirestoreRecalc();
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
    const key = classCountKey(obj, isMusifamiliarRecord(obj));
    const participantCount = counts.get(key) || 1;
    const cat = finalCategory(obj, participantCount);
    let qty = firestoreQty(obj);

    if (isGroupLikeCategory(cat)) {
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

/* ---------- Tarifas compartidas por docente ---------- */

function defaultTarifas() {
  return structuredClone(tarifasDefaults || CFG.DEFAULT_TARIFAS || {});
}

function normalizeTarifasDefaults(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : CFG.DEFAULT_TARIFAS || {};
  const out = {};
  for (const [cat, value] of Object.entries(source)) {
    const catKey = upper(cat);
    if (!catKey) continue;
    out[catKey] = Number(value || 0);
  }
  return out;
}

function normalizeTarifasDocentes(raw) {
  const out = {};
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  for (const [k, item] of Object.entries(source)) {
    const docente = norm(item?.docente || "");
    const ratesRaw = item?.rates || {};
    const rates = {};
    for (const [cat, value] of Object.entries(ratesRaw)) {
      const catKey = upper(cat);
      if (!catKey) continue;
      rates[catKey] = Number(value || 0);
    }
    if (docente) out[k] = { docente, rates };
  }
  return out;
}

function tarifaDocRef() {
  const db = initFirebase();
  return db
    .collection(CFG.FIRESTORE_CONFIG_COLLECTION || "configuracion")
    .doc(CFG.FIRESTORE_TARIFAS_DOC || "tarifas_docentes");
}

async function loadSharedTarifas() {
  await ensureAuth();
  const snap = await tarifaDocRef().get();
  const data = snap.exists ? snap.data() || {} : {};
  tarifasDefaults = normalizeTarifasDefaults(data.defaults || CFG.DEFAULT_TARIFAS);
  tarifasDocentes = normalizeTarifasDocentes(data.docentes);
  tarifasLoaded = true;
}

async function saveSharedTarifas() {
  await ensureAuth();
  await tarifaDocRef().set({
    defaults: tarifasDefaults,
    docentes: tarifasDocentes,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

function tarifasForDocente(docente) {
  const kdoc = keyDocente(docente);
  return {
    ...defaultTarifas(),
    ...(tarifasDocentes[kdoc]?.rates || {}),
  };
}

function tarifaFor(docente, cat) {
  return Number(tarifasForDocente(docente)[upper(cat)] ?? 0);
}

function categoriasTarifasDisponibles(extraCats = []) {
  return Array.from(new Set([
    ...Object.keys(defaultTarifas()).map(upper),
    ...extraCats.map(upper),
  ])).filter(Boolean).sort((a, b) => a.localeCompare(b, "es"));
}

/* ---------- Jornadas ---------- */

function loadJornadas() {
  const raw = localStorage.getItem(CFG.LS_KEY_JORNADAS);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveJornadas() {
  localStorage.setItem(CFG.LS_KEY_JORNADAS, JSON.stringify(jornadas));
}

function jornadaDocRef() {
  const db = initFirebase();
  return db.collection(CFG.FIRESTORE_CONFIG_COLLECTION || "configuracion")
    .doc(CFG.FIRESTORE_JORNADAS_DOC || "jornadas_docentes");
}

async function saveSharedJornadas() {
  await ensureAuth();
  await jornadaDocRef().set({
    jornadas,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  saveJornadas();
  jornadasLoaded = true;
}

async function loadSharedJornadas() {
  await ensureAuth();
  const snap = await jornadaDocRef().get();
  const remote = snap.exists && Array.isArray(snap.data()?.jornadas) ? snap.data().jornadas : null;
  if (remote) {
    jornadas = remote;
    saveJornadas();
  } else if (jornadas.length) {
    // Migra las jornadas creadas antes de que existiera el guardado compartido.
    await saveSharedJornadas();
  }
  jornadasLoaded = true;
}

function minutesFromTime(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getHours() * 60 + v.getMinutes();
  const t = norm(v)
    .replace(/\b(a\.?\s*m\.?)\b/gi, "AM")
    .replace(/\b(p\.?\s*m\.?)\b/gi, "PM");
  if (!t) return null;
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return null;
  let hh = Number(m[1]);
  const mm = Number(m[2] || 0);
  const meridiem = (m[3] || "").toUpperCase();
  if (meridiem === "PM" && hh < 12) hh += 12;
  if (meridiem === "AM" && hh === 12) hh = 0;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function parseRowDate(row) {
  const date = parseDateFlexible(row?.[CFG.IDX.FECHA]);
  if (!date) return null;

  const time = minutesFromTime(row?._hora);
  if (time === null) return date;

  // La hora explícita del registro es la fuente correcta cuando viene en una
  // columna separada de la fecha.
  date.setHours(Math.floor(time / 60), time % 60, 0, 0);
  return date;
}

function minutesFromDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  const minutes = d.getHours() * 60 + d.getMinutes();
  return minutes === 0 ? null : minutes;
}

function jornadaLabel(j) {
  const hours = j.desde || j.hasta ? ` ${j.desde || "00:00"}-${j.hasta || "23:59"}` : "";
  const periodo = j.fechaHasta ? `${j.fecha} a ${j.fechaHasta}` : j.fecha;
  return `${periodo}${hours}`;
}

function jornadaMatches(j, kdoc, fecha) {
  if (!j || keyDocente(j.docente) !== kdoc) return false;
  const dia = ymd(fecha);
  const fechaHasta = j.fechaHasta || j.fecha;
  if (dia < j.fecha || dia > fechaHasta) return false;

  const desde = minutesFromTime(j.desde);
  const hasta = minutesFromTime(j.hasta);
  if (desde === null && hasta === null) return true;

  const current = minutesFromDate(fecha);
  // Una clase sin hora conocida no puede pertenecer con seguridad a una
  // jornada por horario. Así no se incluyen por error las clases posteriores.
  if (current === null) return false;
  if (desde !== null && current < desde) return false;
  // La jornada termina al comenzar la hora indicada. Por ejemplo, 09:00–12:00
  // cubre clases desde las 09:00 hasta antes de las 12:00; una clase que inicia
  // exactamente a las 12:00 se liquida con su tarifa habitual.
  if (hasta !== null && current >= hasta) return false;
  return true;
}

function findJornada(kdoc, fecha) {
  return jornadas.find(j => jornadaMatches(j, kdoc, fecha)) || null;
}

function jornadaKeyFor(kdoc, j) {
  return `${kdoc}||${j.fecha}||${j.fechaHasta || ""}||${j.desde || ""}||${j.hasta || ""}||${j.valor}`;
}

async function openJornadas() {
  if (!jornadasLoaded) {
    setStatus("Cargando jornadas compartidas...", "warn");
    await loadSharedJornadas();
  }
  renderJornadasRows();
  el.dlgJornadas.showModal();
}

function renderJornadasRows() {
  if (!el.jornadasBody) return;
  if (!jornadas.length) {
    el.jornadasBody.innerHTML = "";
    addJornadaRow();
    return;
  }
  el.jornadasBody.innerHTML = jornadas.map(j => jornadaRowHtml(j)).join("");
}

function getLinkedClassesForJornada(jornada) {
  if (!jornada?.docente || !jornada?.fecha || !firestoreDocsById.size) return [];
  const linked = new Map();

  getFirestoreRows().forEach((row) => {
    const fecha = parseRowDate(row);
    const docente = keyDocente(norm(row[CFG.IDX.DOCENTE]));
    if (!fecha || !jornadaMatches(jornada, docente, fecha)) return;

    const category = upper(row[CFG.IDX.CAT]) || "SIN CATEGORÍA";
    const minute = minutesFromDate(fecha);
    // Una clase grupal puede tener varias filas (un estudiante por fila): se
    // muestra como una sola clase y se conservan todos los estudiantes.
    const key = `${ymd(fecha)}|${minute ?? "sin-hora"}|${category}`;
    if (!linked.has(key)) {
      linked.set(key, {
        fecha,
        categoria: category,
        estudiantes: new Set(),
      });
    }
    const nombre = norm(row[3]);
    if (nombre) linked.get(key).estudiantes.add(nombre);
  });

  return [...linked.values()].sort((a, b) => a.fecha - b.fecha);
}

function jornadaLinkedClassesHtml(jornada) {
  if (!jornada?.docente || !jornada?.fecha) return '<span class="jornadaLinkedHint">Completa docente y fecha.</span>';
  if (!firestoreDocsById.size) return '<span class="jornadaLinkedHint">Carga las clases para verlas.</span>';

  const classes = getLinkedClassesForJornada(jornada);
  if (!classes.length) return '<span class="jornadaLinkedHint">Sin clases vinculadas.</span>';

  const entries = classes.map((item) => {
    const day = item.fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
    const minute = minutesFromDate(item.fecha);
    const hour = minute === null ? 'Sin hora' : `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const students = [...item.estudiantes].join(', ') || 'Sin estudiante';
    return `<li><strong>${escapeHtml(`${day} · ${hour}`)}</strong> · ${escapeHtml(item.categoria)}<br><span>${escapeHtml(students)}</span></li>`;
  }).join('');

  return `<details class="jornadaLinked"><summary>${classes.length} clase${classes.length === 1 ? '' : 's'}</summary><ul>${entries}</ul></details>`;
}

function jornadaRowHtml(j = {}) {
  const current = norm(j.docente || "");
  const names = Array.from(new Set([current, ...docentesAll])).filter(Boolean);
  const options = [
    `<option value="">Docente</option>`,
    ...names.map(d => `<option value="${escapeHtml(d)}" ${keyDocente(d) === keyDocente(current) ? "selected" : ""}>${escapeHtml(d)}</option>`)
  ].join("");
  return `
    <tr>
      <td><select class="rateInput jornadaDocente">${options}</select></td>
      <td><input class="rateInput jornadaFecha" type="date" value="${escapeHtml(j.fecha || "")}" aria-label="Fecha inicial"></td>
      <td><input class="rateInput jornadaValor" type="text" value="${Number(j.valor || 0)}" inputmode="numeric" placeholder="Ej. 120000" aria-label="Valor en pesos colombianos"></td>
      <td class="jornadaPeriodo"><label class="jornadaMultidiaLabel"><input class="jornadaMultidia" type="checkbox" ${j.fechaHasta ? "checked" : ""}> Más de un día</label><input class="rateInput jornadaFechaHasta" type="date" value="${escapeHtml(j.fechaHasta || "")}" aria-label="Fecha final" ${j.fechaHasta ? "" : "disabled"}></td>
      <td><input class="rateInput jornadaDesde" type="time" value="${escapeHtml(j.desde || "")}"></td>
      <td><input class="rateInput jornadaHasta" type="time" value="${escapeHtml(j.hasta || "")}"></td>
      <td><input class="rateInput jornadaNota" type="text" value="${escapeHtml(j.nota || "")}" placeholder="4h, 8h..."></td>
      <td class="jornadaLinkedCell">${jornadaLinkedClassesHtml(j)}</td>
      <td><button class="rateDel jornadaDel" type="button" title="Eliminar">X</button></td>
    </tr>
  `;
}

function addJornadaRow(j = {}) {
  if (!el.jornadasBody) return;
  const tr = document.createElement("tr");
  tr.innerHTML = jornadaRowHtml(j).trim().replace(/^<tr>|<\/tr>$/g, "");
  el.jornadasBody.appendChild(tr);
}

async function saveJornadasFromUI() {
  try {
    const fixed = [];
    const rows = Array.from(el.jornadasBody.querySelectorAll("tr"));
    for (const row of rows) {
      const docente = norm(row.querySelector(".jornadaDocente")?.value || "");
      const fecha = norm(row.querySelector(".jornadaFecha")?.value || "");
      const esMultidia = Boolean(row.querySelector(".jornadaMultidia")?.checked);
      const fechaHasta = esMultidia ? norm(row.querySelector(".jornadaFechaHasta")?.value || "") : "";
      const desde = norm(row.querySelector(".jornadaDesde")?.value || "");
      const hasta = norm(row.querySelector(".jornadaHasta")?.value || "");
      const valorInput = row.querySelector(".jornadaValor");
      const valor = parseRateValue(valorInput?.value || "0");
      const nota = norm(row.querySelector(".jornadaNota")?.value || "");
      if (!docente && !fecha && !fechaHasta && !valor) continue;
      if (!docente || !fecha || !valor) {
        const missing = !docente ? row.querySelector(".jornadaDocente") : !fecha ? row.querySelector(".jornadaFecha") : valorInput;
        missing?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        missing?.focus();
        throw new Error("Cada jornada necesita docente, fecha y valor. Escribe el valor en la columna Valor (COP).");
      }
      if (esMultidia && !fechaHasta) throw new Error("Las jornadas de más de un día necesitan fecha final.");
      if (fechaHasta && fechaHasta < fecha) throw new Error("La fecha final no puede ser anterior a la fecha inicial.");
      fixed.push({ docente, fecha, fechaHasta, desde, hasta, valor, nota });
    }
    jornadas = fixed;
    await saveSharedJornadas();
    if (el.dlgJornadas?.open) renderJornadasRows();
    setStatus("Jornadas guardadas en Firebase.", "ok");
    return true;
  } catch (e) {
    console.error("No se pudieron guardar las jornadas en Firebase:", e);
    setStatus("No se pudieron guardar las jornadas: " + (e.message || e), "danger");
    return false;
  }
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
    const nombreBase = norm(x.nombre) || "(Sin nombre)";
    const nombre = x.jornada ? `${nombreBase} · ${x.jornada} · ${money(x.valor || 0)}` : nombreBase;
    const linkedClasses = (x.clases || []).map((clase) => {
      const minute = minutesFromDate(clase.fecha);
      const hour = minute === null ? "Sin hora" : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      const students = clase.estudiantes.join(", ") || "Sin estudiante";
      return `<li><strong>${escapeHtml(`${ymd(clase.fecha)} · ${hour}`)}</strong> · ${escapeHtml(clase.categoria)}<br><span>${escapeHtml(students)}</span></li>`;
    }).join("");
    const linkedHtml = linkedClasses
      ? `<details class="detalleJornadaClases"><summary>${x.clases.length} clase${x.clases.length === 1 ? "" : "s"} vinculada${x.clases.length === 1 ? "" : "s"}</summary><ul>${linkedClasses}</ul></details>`
      : "";
    return `<tr>
      <td>${escapeHtml(nombre)}${linkedHtml}</td>
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
  const skipFlujoRefresh = Boolean(options.skipFlujoRefresh);
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
    const appliedJornadas = new Set();

    // Para filtrar docentes por clave
    const selectedKeys = docentesSelected ? new Set(Array.from(docentesSelected).map(keyDocente)) : null;

    for (const r of data) {
      const docenteDisplay = norm(r[CFG.IDX.DOCENTE]);
      if (!docenteDisplay) { dropNoDoc++; continue; }

      const kdoc = keyDocente(docenteDisplay);
      if (selectedKeys && !selectedKeys.has(kdoc)) continue;

      const fecha = parseRowDate(r);
      if (!fecha) { dropBadDate++; continue; }

      if (filtros.desde && fecha < filtros.desde) { dropOutRange++; continue; }
      if (filtros.hasta && fecha > filtros.hasta) { dropOutRange++; continue; }

      // Nombre (D) = Ã­ndice 3
      const nombre = norm(r[3]);

      const jornada = findJornada(kdoc, fecha);
      const cat = jornada ? "JORNADA" : (upper(r[CFG.IDX.CAT]) || "SIN_CATEGORIA");
      const qty = jornada ? 0 : parseNumberFlexible(r[CFG.IDX.CANT]);

      filteredCount++;
      catsSet.add(cat);

      // detalle
      const keyDetail = kdoc + "||" + cat;
      if (!details.has(keyDetail)) details.set(keyDetail, []);
      if (!jornada) details.get(keyDetail).push({ nombre, fecha, qty });

      if (!byDoc.has(kdoc)) byDoc.set(kdoc, { docente: docenteDisplay, cats: {}, totalQty: 0, value: 0, fixedValue: 0 });
      const row = byDoc.get(kdoc);

      // preferimos el display mÃ¡s completo/largo
      if (docenteDisplay.length > row.docente.length) row.docente = docenteDisplay;

      if (jornada) {
        const jornadaKey = jornadaKeyFor(kdoc, jornada);
        let jornadaDetail = details.get(keyDetail).find((item) => item.jornadaKey === jornadaKey);
        if (!jornadaDetail) {
          jornadaDetail = {
            nombre: jornada.nota || "Jornada",
            fecha,
            qty: 1,
            valor: Number(jornada.valor || 0),
            jornada: jornadaLabel(jornada),
            jornadaKey,
            clases: [],
          };
          details.get(keyDetail).push(jornadaDetail);
        }

        // Agrupa las filas de una clase grupal y deja en el detalle todos los
        // estudiantes que pertenecen a esa misma sesión.
        const category = upper(r[CFG.IDX.CAT]) || "SIN CATEGORÍA";
        const classKey = `${ymd(fecha)}|${minutesFromDate(fecha) ?? "sin-hora"}|${category}`;
        let linkedClass = jornadaDetail.clases.find((item) => item.key === classKey);
        if (!linkedClass) {
          linkedClass = { key: classKey, fecha, categoria: category, estudiantes: [] };
          jornadaDetail.clases.push(linkedClass);
        }
        if (nombre && !linkedClass.estudiantes.includes(nombre)) linkedClass.estudiantes.push(nombre);

        if (!appliedJornadas.has(jornadaKey)) {
          appliedJornadas.add(jornadaKey);
          row.cats.JORNADA = (row.cats.JORNADA || 0) + 1;
          row.totalQty += 1;
          row.fixedValue += Number(jornada.valor || 0);
        }
      } else {
        row.cats[cat] = (row.cats[cat] || 0) + qty;
        row.totalQty += qty;
      }
    }

    for (const jornada of jornadas) {
      const docenteDisplay = norm(jornada.docente);
      const kdoc = keyDocente(docenteDisplay);
      if (!docenteDisplay) continue;
      if (selectedKeys && !selectedKeys.has(kdoc)) continue;

      const fecha = parseDateFlexible(jornada.fecha);
      const fechaHasta = parseDateFlexible(jornada.fechaHasta || jornada.fecha);
      if (!fecha || !fechaHasta) continue;
      // El período se incluye si tiene al menos un día dentro del filtro actual.
      if (filtros.desde && fechaHasta < filtros.desde) continue;
      if (filtros.hasta && fecha > filtros.hasta) continue;

      const jornadaKey = jornadaKeyFor(kdoc, jornada);
      if (appliedJornadas.has(jornadaKey)) continue;

      appliedJornadas.add(jornadaKey);
      catsSet.add("JORNADA");

      const keyDetail = kdoc + "||JORNADA";
      if (!details.has(keyDetail)) details.set(keyDetail, []);
      details.get(keyDetail).push({
        nombre: jornada.nota || "Jornada",
        fecha,
        qty: 1,
        valor: Number(jornada.valor || 0),
        jornada: jornadaLabel(jornada),
      });

      if (!byDoc.has(kdoc)) byDoc.set(kdoc, { docente: docenteDisplay, cats: {}, totalQty: 0, value: 0, fixedValue: 0 });
      const row = byDoc.get(kdoc);
      if (docenteDisplay.length > row.docente.length) row.docente = docenteDisplay;
      row.cats.JORNADA = (row.cats.JORNADA || 0) + 1;
      row.totalQty += 1;
      row.fixedValue += Number(jornada.valor || 0);
    }

    el.kpiFiltradas.textContent = String(filteredCount);

    const cats = Array.from(catsSet).sort((a, b) => a.localeCompare(b, "es"));

    // valor por docente
    for (const row of byDoc.values()) {
      let v = 0;
      for (const cat of cats) {
        const q = row.cats[cat] || 0;
        const rate = tarifaFor(row.docente, cat);
        v += q * (isNaN(rate) ? 0 : rate);
      }
      row.value = v + Number(row.fixedValue || 0);
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
    if (!skipFlujoRefresh) loadFlujoUploaded();
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
    if (!tarifasLoaded) {
      setStatus("Cargando tarifas compartidas...", "warn");
      await loadSharedTarifas();
    }
    if (!jornadasLoaded) {
      setStatus("Cargando jornadas compartidas...", "warn");
      await loadSharedJornadas();
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

async function openTarifas() {
  if (!tarifasLoaded) {
    setStatus("Cargando tarifas compartidas...", "warn");
    await loadSharedTarifas();
  }
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
  renderTarifasViewTabs();
  if (el.btnAgregarTarifa) {
    el.btnAgregarTarifa.hidden = tarifasVista !== "defaults";
    el.btnAgregarTarifa.textContent = "+ Agregar categoria";
  }
  if (tarifasVista === "defaults") {
    renderTarifasDefaultsRows();
    return;
  }

  const cats = categoriasTarifasDisponibles(last?.cats || []);
  const docentes = tarifasDocentesList();

  if (!tarifaDocenteActivo || !docentes.some(d => keyDocente(d) === keyDocente(tarifaDocenteActivo))) {
    tarifaDocenteActivo = docentes[0] || "";
  }

  renderTarifasDocentePicker(docentes);

  if (el.tarifasHead) {
    el.tarifasHead.innerHTML = "<tr><th>Categoria</th><th>Valor para este docente</th></tr>";
  }

  if (!tarifaDocenteActivo) {
    el.tarifasBody.innerHTML = `<tr><td colspan="2">Carga datos para ver docentes.</td></tr>`;
    return;
  }

  el.tarifasBody.innerHTML = cats.map(cat => tarifaRowHtml(tarifaDocenteActivo, cat)).join("");
}

function renderTarifasViewTabs() {
  if (!el.dlgTarifas) return;
  let tabs = el.dlgTarifas.querySelector(".tarifasTabs");
  if (!tabs) {
    const wrap = el.dlgTarifas.querySelector(".ratesWrap");
    tabs = document.createElement("div");
    tabs.className = "tarifasTabs";
    tabs.innerHTML = `
      <button class="tarifaTab" type="button" data-view="docente">Por docente</button>
      <button class="tarifaTab" type="button" data-view="defaults">Predeterminadas</button>
    `;
    wrap?.before(tabs);
    tabs.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".tarifaTab");
      if (!btn) return;
      tarifasVista = btn.getAttribute("data-view") || "docente";
      renderTarifasRows();
    });
  }

  tabs.querySelectorAll(".tarifaTab").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-view") === tarifasVista);
  });
}

function renderTarifasDefaultsRows() {
  const picker = el.dlgTarifas?.querySelector(".tarifaDocentePicker");
  if (picker) picker.hidden = true;

  const cats = categoriasTarifasDisponibles(last?.cats || []);
  if (el.tarifasHead) {
    el.tarifasHead.innerHTML = "<tr><th>Categoria predeterminada</th><th>Valor</th><th></th></tr>";
  }
  el.tarifasBody.innerHTML = cats.map(cat => defaultTarifaRowHtml(cat)).join("");
}

function defaultTarifaRowHtml(cat = "") {
  const defaults = defaultTarifas();
  return `
    <tr>
      <td><input class="rateInput defaultCat" type="text" value="${escapeHtml(cat)}" placeholder="Categoria"></td>
      <td><input class="rateInput defaultValue" type="text" value="${Number(defaults[cat] || 0)}" inputmode="numeric" placeholder="0"></td>
      <td><button class="rateDel defaultDel" type="button" title="Eliminar">X</button></td>
    </tr>
  `;
}

function tarifasDocentesList() {
  return Array.from(new Set([
    ...docentesAll,
    ...Object.values(tarifasDocentes).map(x => x.docente),
  ])).filter(Boolean).sort((a, b) => a.localeCompare(b, "es"));
}

function renderTarifasDocentePicker(docentes) {
  if (!el.dlgTarifas) return;
  let box = el.dlgTarifas.querySelector(".tarifaDocentePicker");
  if (!box) {
    const wrap = el.dlgTarifas.querySelector(".ratesWrap");
    box = document.createElement("div");
    box.className = "tarifaDocentePicker";
    box.innerHTML = `
      <label>Docente</label>
      <select id="tarifaDocenteSelect"></select>
    `;
    wrap?.before(box);
    box.querySelector("select").addEventListener("change", (ev) => {
      tarifaDocenteActivo = ev.target.value;
      renderTarifasRows();
    });
  }

  box.hidden = false;
  const select = box.querySelector("select");
  select.innerHTML = docentes.map(d => `
    <option value="${escapeHtml(d)}" ${keyDocente(d) === keyDocente(tarifaDocenteActivo) ? "selected" : ""}>${escapeHtml(d)}</option>
  `).join("");
}

function tarifaRowHtml(docente = "", cat = "") {
  const rates = tarifasForDocente(docente);
  return `
    <tr>
      <td><strong>${escapeHtml(cat)}</strong></td>
      <td>
        <input class="rateInput rateValue" type="text" value="${Number(rates[cat] || 0)}" inputmode="numeric" data-cat="${escapeHtml(cat)}" placeholder="0">
      </td>
    </tr>
  `;
}

function addTarifaRow() {
  if (tarifasVista !== "defaults" || !el.tarifasBody) return;
  const tr = document.createElement("tr");
  tr.innerHTML = defaultTarifaRowHtml("").trim().replace(/^<tr>|<\/tr>$/g, "");
  el.tarifasBody.appendChild(tr);
}

function parseRateValue(v) {
  const t = norm(v).replaceAll(".", "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

async function saveTarifasFromUI() {
  try {
    if (!el.tarifasBody) throw new Error("La interfaz de tarifas no está disponible en esta versión.");
    if (tarifasVista === "defaults") {
      const defaults = {};
      el.tarifasBody.querySelectorAll("tr").forEach((row) => {
        const cat = upper(row.querySelector(".defaultCat")?.value || "");
        if (!cat) return;
        defaults[cat] = parseRateValue(row.querySelector(".defaultValue")?.value || "0");
      });
      if (!Object.keys(defaults).length) throw new Error("Debes dejar al menos una tarifa predeterminada.");
      tarifasDefaults = defaults;
      await saveSharedTarifas();
      setStatus("Tarifas predeterminadas guardadas para todos.", "ok");
      return;
    }

    const docente = norm(tarifaDocenteActivo);
    if (!docente) throw new Error("Selecciona un docente.");

    const rates = {};
    el.tarifasBody.querySelectorAll(".rateValue").forEach((input) => {
      const cat = upper(input.getAttribute("data-cat") || "");
      if (!cat) return;
      rates[cat] = parseRateValue(input.value || "0");
    });

    tarifasDocentes[keyDocente(docente)] = { docente, rates };
    await saveSharedTarifas();
    setStatus(`Tarifas guardadas para ${docente}.`, "ok");
  } catch (e) {
    setStatus("Tarifas inválidas: " + (e.message || e), "danger");
  }
}
/* ---------- Flujo de Caja ---------- */

let flujoApp      = null;
let flujoDb       = null;
let flujoUploaded = new Set(); // keyDocente de los ya subidos para el mes activo

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

function watchFlujoAuth() {
  try {
    initFlujoFirebase();
    firebase.auth(flujoApp).onAuthStateChanged((user) => {
      if (user) loadFlujoUploaded();
    });
  } catch (_) { /* silencioso si Firebase no cargó aún */ }
}

async function loadFlujoUploaded() {
  try {
    if (!flujoApp) return;
    const auth = firebase.auth(flujoApp);
    if (!auth.currentUser) return;
    if (!last?.out?.length) return;
    const { año, mes } = getMesAño();
    const db = initFlujoFirebase();
    const snaps = await Promise.all(
      last.out.map(r => db.collection(CFG.FLUJO_COLLECTION).doc(flujoDocId(año, mes, r.docente)).get())
    );
    flujoUploaded = new Set();
    snaps.forEach((snap, i) => {
      if (snap.exists) flujoUploaded.add(keyDocente(last.out[i].docente));
    });
    updateFlujoMarkers();
  } catch (_) { /* silencioso */ }
}

function updateFlujoMarkers() {
  el.tbody.querySelectorAll("tr").forEach(tr => {
    const td = tr.querySelector("td:first-child");
    if (!td) return;
    const strong = td.querySelector("strong");
    if (!strong) return;
    td.querySelector(".flujoMark")?.remove();
    if (flujoUploaded.has(keyDocente(strong.textContent))) {
      const mark = document.createElement("span");
      mark.className = "flujoMark";
      mark.title = "Subido a Flujo de Caja este mes";
      mark.textContent = "✓";
      strong.prepend(mark);
    }
  });
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
    await loadFlujoUploaded();

  } catch (err) {
    flujoSetStatus("Error al guardar: " + (err.message || err), "err");
  } finally {
    el.flujoGuardar.disabled   = false;
    el.flujoComprobar.disabled = false;
  }
}

/* ---------- Eventos ---------- */

function setup() {
  const tarifasTitle = el.dlgTarifas?.querySelector(".dlgTitle");
  const tarifasSub = el.dlgTarifas?.querySelector(".dlgSub");
  const tarifasHint = el.dlgTarifas?.querySelector(".dlgHint");
  const tarifasTable = el.dlgTarifas?.querySelector(".ratesTable");
  if (tarifasTitle) tarifasTitle.textContent = "Tarifas por docente";
  if (tarifasSub) tarifasSub.textContent = "Cada docente usa tarifas predeterminadas, pero puedes ajustar valores propios.";
  if (tarifasHint) tarifasHint.textContent = "Las casillas se llenan con la tarifa predeterminada. Cambia solo los valores que sean distintos para ese docente.";
  if (tarifasTable) tarifasTable.classList.add("tarifasDocentesTable");
  if (el.btnAgregarTarifa) el.btnAgregarTarifa.hidden = true;
  if (el.btnResetTarifas) el.btnResetTarifas.textContent = "Reset predeterminado";

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
  if (el.btnVerJornadas) el.btnVerJornadas.addEventListener("click", openJornadas);

  if (el.btnAgregarTarifa) {
    el.btnAgregarTarifa.addEventListener("click", () => addTarifaRow());
  }

  if (el.tarifasBody) {
    el.tarifasBody.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".defaultDel");
      if (!btn) return;
      const tr = btn.closest("tr");
      if (!tr) return;
      tr.remove();
      if (!el.tarifasBody.querySelector("tr")) addTarifaRow();
    });
  }

  if (el.btnAgregarJornada) {
    el.btnAgregarJornada.addEventListener("click", () => addJornadaRow());
  }

  if (el.jornadasBody) {
    el.jornadasBody.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".jornadaDel");
      if (!btn) return;
      const tr = btn.closest("tr");
      if (!tr) return;
      tr.remove();
      if (!el.jornadasBody.querySelector("tr")) addJornadaRow();
    });
    el.jornadasBody.addEventListener("change", (ev) => {
      const check = ev.target.closest(".jornadaMultidia");
      if (!check) return;
      const fechaHasta = check.closest("tr")?.querySelector(".jornadaFechaHasta");
      if (!fechaHasta) return;
      fechaHasta.disabled = !check.checked;
      if (check.checked) fechaHasta.focus();
    });
  }

  if (el.btnGuardarJornadas) el.btnGuardarJornadas.addEventListener("click", async (ev) => {
    ev.preventDefault();
    el.btnGuardarJornadas.disabled = true;
    const saved = await saveJornadasFromUI();
    el.btnGuardarJornadas.disabled = false;
    if (saved) recalcularSiHayDatos();
  });

  if (el.btnGuardarTarifas) el.btnGuardarTarifas.addEventListener("click", async () => {
    await saveTarifasFromUI();
    recalcularSiHayDatos();
  });

  if (el.btnResetTarifas) el.btnResetTarifas.addEventListener("click", async () => {
    tarifasDefaults = normalizeTarifasDefaults(CFG.DEFAULT_TARIFAS);
    tarifasDocentes = {};
    await saveSharedTarifas();
    tarifasLoaded = true;
    setStatus("Tarifas reseteadas a las predeterminadas de la app.", "warn");
    if (el.dlgTarifas.open) renderTarifasRows();
    recalcularSiHayDatos();
  });

  watchAuthAndAutoload();
  watchFlujoAuth();
}
try {
  setup();
} catch (err) {
  console.error("Error en setup:", err);
  setStatus("Error de interfaz. Recarga con Ctrl+F5.", "danger");
}

