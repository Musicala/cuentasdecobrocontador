/* RIP Â· Cuenta de cobro (Docentes)
   CategorÃ­as = P
   Cantidad = SUMA(O)
   Agrupa por Docente(H) + CategorÃ­a(P)
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
// Incluye quitar tildes para evitar "JosÃ©" vs "Jose".
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

/* ---------- TSV ---------- */

function parseTSV(tsv) {
  const lines = tsv.replace(/\r/g, "").split("\n").filter(l => l !== "");
  return lines.map(l => l.split("\t"));
}

/* ---------- Fecha ultra-tolerante ---------- */

function dateFromSerial(n) {
  // 25569 = dÃ­as entre 1899-12-30 y 1970-01-01
  const ms = (Number(n) - 25569) * 86400 * 1000;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d;
}

function parseDateFlexible(s) {
  const t0 = norm(s);
  if (!t0) return null;

  // 1) Serial numÃ©rico (Sheets/Excel)
  if (/^\d+(\.\d+)?$/.test(t0)) {
    const serial = Number(t0);
    // si es un aÃ±o tipo 2026 no es serial, lo ignoramos aquÃ­
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

  // 4) Ãšltimo recurso: Date() nativo (ISO y similares)
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
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("Tarifas invÃ¡lidas");
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
  const desde = new Date(yy, mm - 2, 26);
  const hasta = new Date(yy, mm - 1, 25);
  el.desde.value = ymd(desde);
  el.hasta.value = ymd(hasta);
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

  el.detalleTitle.textContent = `${docenteDisplay} Â· ${cat}`;
  el.detalleSub.textContent = `Rango: ${last.filtros.desdeStr || "inicio"} â†’ ${last.filtros.hastaStr || "hoy"}`;

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
  el.detalleResumen.innerHTML = `<b>${rows.length}</b> registros Â· <b>Total Î£O:</b> ${formatQty(total)}`;

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

async function cargarYCalcular() {
  try {
    setStatus("Cargando RIPâ€¦", "warn");

    const details = new Map();
    // key: kdoc||cat => array de { nombre, fecha: Date, qty: number }

    // DiagnÃ³stico por si vuelve el misterio
    let dropNoDoc = 0;
    let dropBadDate = 0;
    let dropOutRange = 0;

    const res = await fetch(CFG.TSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo leer el TSV (HTTP " + res.status + ")");
    const tsv = await res.text();

    const rows = parseTSV(tsv);
    if (rows.length < 2) throw new Error("TSV vacÃ­o o sin data.");

    el.kpiFilas.textContent = String(rows.length - 1);
    const data = rows.slice(1);

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

    setStatus("Listo âœ…", "ok");
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

/* ---------- Tarifas UI ---------- */

function openTarifas() {
  renderTarifasRows();
  el.dlgTarifas.showModal();
}

function renderTarifasRows() {
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
    const fixed = {};
    const rows = Array.from(el.tarifasBody.querySelectorAll("tr"));
    for (const row of rows) {
      const cat = upper(row.querySelector(".rateCat")?.value || "");
      if (!cat) continue;
      fixed[cat] = parseRateValue(row.querySelector(".rateValue")?.value || "0");
    }

    if (!Object.keys(fixed).length) throw new Error("Debes ingresar al menos una categoria.");

    tarifas = fixed;
    saveTarifas();
    setStatus("Tarifas guardadas âœ…", "ok");
  } catch (e) {
    setStatus("Tarifas invÃ¡lidas: " + (e.message || e), "danger");
  }
}
/* ---------- Eventos ---------- */

function setup() {
  // defaults: mes actual
  const now = new Date();
  el.mes.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  applyMonthToRange();

  setStatus("Sin cargar", "muted");

  el.mes.addEventListener("change", () => applyMonthToRange());

  el.docentesBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    if (el.docentesPanel.hidden) openDocentesPanel();
    else closeDocentesPanel();
  });

  document.addEventListener("click", (ev) => {
    if (!el.docentesBox.contains(ev.target)) closeDocentesPanel();
  });

  el.docentesSearch.addEventListener("input", () => renderDocentesList(el.docentesSearch.value));

  el.docentesAll.addEventListener("click", () => {
    docentesSelected = null;
    renderDocentesList(el.docentesSearch.value);
  });

  el.docentesNone.addEventListener("click", () => {
    docentesSelected = new Set();
    renderDocentesList(el.docentesSearch.value);
  });

  el.docentesList.addEventListener("change", () => syncSelectedFromCheckboxes());

  el.btnCargar.addEventListener("click", () => {
    applyMonthToRange();
    cargarYCalcular();
  });

  el.btnExport.addEventListener("click", exportCSV);

  // Click en celda => detalle
  el.tabla.addEventListener("click", (ev) => {
    const td = ev.target.closest("td.clickable");
    if (!td || !last) return;
    const docente = td.getAttribute("data-doc") || "";
    const cat = td.getAttribute("data-cat") || "";
    if (!docente || !cat) return;
    openDetalle(docente, cat);
  });

  el.btnVerTarifas.addEventListener("click", openTarifas);

  el.btnAgregarTarifa.addEventListener("click", () => addTarifaRow());

  el.tarifasBody.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".rateDel");
    if (!btn) return;
    const tr = btn.closest("tr");
    if (!tr) return;
    tr.remove();
    if (!el.tarifasBody.querySelector("tr")) addTarifaRow();
  });

  el.btnGuardarTarifas.addEventListener("click", () => {
    saveTarifasFromUI();
    if (last) cargarYCalcular();
  });

  el.btnResetTarifas.addEventListener("click", () => {
    tarifas = structuredClone(CFG.DEFAULT_TARIFAS);
    saveTarifas();
    setStatus("Tarifas reseteadas (demo).", "warn");
    if (el.dlgTarifas.open) renderTarifasRows();
    if (last) cargarYCalcular();
  });
}

setup();

