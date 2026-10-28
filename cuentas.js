// Cuentas recibidas: texto revisado y enlaces compartidos por mes/docente.
const q = s => document.querySelector(s);
const html = s => escapeHtml(String(s ?? ''));
const period = () => { const { año, mes } = getMesAño(); return `${año}-${String(mes).padStart(2, '0')}`; };
const configRef = month => initFlujoFirebase().collection(CFG.FIRESTORE_CONFIG_COLLECTION || 'configuracion').doc(`drive_cuentas_${month}`);
const accountRef = (month, teacher) => initFlujoFirebase().collection('cuentas_docentes').doc(`${month}_${encodeURIComponent(keyDocente(teacher))}`);
let activeMonth, activeTeacher, selectedFile, uploaded, busy = false;
// Los archivos pendientes sobreviven a una recarga y se suben al enviar a Flujo.
const pendingFiles = new Map();
const pendingKey = (month, teacher) => `${month}_${keyDocente(teacher)}`;
let pendingLoaded = false;
let pendingError = null;
const pendingDb = new Promise((resolve, reject) => {
  if (!globalThis.indexedDB) { reject(new Error('Este navegador no permite conservar los archivos adjuntos.')); return; }
  const request = indexedDB.open('musicala-cuentas-pendientes', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('archivos');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function pendingWrite(key, value) {
  const db = await pendingDb;
  await new Promise((resolve, reject) => {
    const tx = db.transaction('archivos', 'readwrite');
    if (value) tx.objectStore('archivos').put(value, key);
    else tx.objectStore('archivos').delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('No se pudo conservar el adjunto.'));
  });
  if (value) pendingFiles.set(key, value); else pendingFiles.delete(key);
}
const pendingReady = pendingDb.then(db => new Promise((resolve, reject) => {
  const request = db.transaction('archivos').objectStore('archivos').openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor) { pendingFiles.set(cursor.key, cursor.value); cursor.continue(); }
    else resolve();
  };
  request.onerror = () => reject(request.error);
})).then(() => { pendingLoaded = true; }).catch(error => { pendingError = error; pendingLoaded = true; });

const dialog = document.createElement('dialog');
dialog.className = 'dlg';
dialog.innerHTML = `<form method="dialog" class="dlgCard cuentasCard">
<div class="dlgHead"><div><div class="dlgTitle">Cuentas de cobro recibidas</div><p id="cuentaPeriodo"></p></div><button class="x" aria-label="Cerrar">✕</button></div>
<label for="cuentaDocente">Docente</label><select id="cuentaDocente"></select>
<p><a id="cuentaCarpeta" target="_blank" rel="noopener noreferrer" hidden>Abrir carpeta del mes</a></p>
<label for="cuentaArchivo">Leer cuenta (PDF con texto o Word .docx, máximo 15 MB)</label><input id="cuentaArchivo" type="file" accept=".pdf,.docx">
<p class="hint">Revisa el texto antes de guardarlo. Si es un escaneo o un Word .doc antiguo, transcribe el contenido o conviértelo a .docx. El archivo se subirá automáticamente al enviar el docente a Flujo de Caja. Adjuntar el archivo no cambia el total calculado.</p>
<label for="cuentaTexto">Observaciones para Flujo de Caja</label><textarea id="cuentaTexto" rows="12" maxlength="40000" placeholder="Texto de la cuenta y observaciones revisadas"></textarea>
<label for="cuentaEnlace">Enlace del archivo en Drive (opcional si lo subiste manualmente)</label><input id="cuentaEnlace" type="url" placeholder="https://drive.google.com/file/d/…/view">
<p id="cuentaEstado" role="status" aria-live="polite"></p>
<div class="dlgBtns"><button id="cuentaGuardar" class="primary" type="button">Guardar cuenta para enviar</button><button value="cancel" class="ghost">Cerrar</button></div></form>`;
document.body.append(dialog);
const settings = document.createElement('dialog');
settings.className = 'dlg';
settings.innerHTML = `<form method="dialog" class="dlgCard"><div class="dlgHead"><div class="dlgTitle">Carpetas de los contadores</div><button class="x" aria-label="Cerrar">✕</button></div><label for="driveMes">Mes</label><input id="driveMes" type="month" required><label for="driveUrl">Enlace de la carpeta de Drive</label><input id="driveUrl" type="url" placeholder="https://drive.google.com/drive/folders/…"><p class="hint">Se guarda un enlace independiente por mes, compartido con el equipo. Deja el enlace vacío para quitarlo.</p><p id="driveEstado" role="status"></p><button id="driveGuardar" class="primary" type="button">Guardar carpeta</button></form>`;
document.body.append(settings);
function driveUrl(value, folder = false) {
  if (!value.trim()) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || (folder && !/\/folders\/[\w-]+/.test(url.pathname))) throw new Error(folder ? 'Usa el enlace de una carpeta de Google Drive.' : 'Usa un enlace HTTPS de Google Drive.');
  return url.href;
}
function folderId(url) { return new URL(driveUrl(url, true)).pathname.match(/\/folders\/([\w-]+)/)[1]; }
function status(message) { q('#cuentaEstado').textContent = message; }
function lock(value) {
  busy = value;
  for (const id of ['cuentaDocente', 'cuentaArchivo', 'cuentaTexto', 'cuentaEnlace', 'cuentaGuardar']) q(`#${id}`).disabled = value;
}
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
dialog.querySelector('form').addEventListener('submit', event => { if (busy) event.preventDefault(); });
async function loadAccount() {
  lock(true);
  activeTeacher = q('#cuentaDocente').value;
  selectedFile = null; uploaded = null;
  q('#cuentaArchivo').value = ''; q('#cuentaTexto').value = ''; q('#cuentaEnlace').value = '';
  status('Cargando…');
  try {
    const snap = await accountRef(activeMonth, activeTeacher).get();
    const data = snap.data() || {};
    q('#cuentaTexto').value = data.observaciones || '';
    q('#cuentaEnlace').value = data.archivoUrl || '';
    await pendingReady;
    const pending = pendingFiles.get(pendingKey(activeMonth, activeTeacher));
    selectedFile = pending?.file || null;
    uploaded = data.archivoNombre ? { name: data.archivoNombre } : null;
    status(pending ? `Adjunto listo: ${pending.file.name}. Se subirá al enviar a Flujo de Caja.` : data.archivoPendiente ? 'El archivo pendiente está en otro navegador. Vuelve a adjuntarlo aquí antes de enviar.' : 'Adjunta la cuenta y revisa el texto. El envío a Flujo de Caja también subirá el archivo.');
    q('#cuentaGuardar').disabled = false;
  } catch (err) { status(`No se pudo cargar: ${err.message}`); lock(false); q('#cuentaGuardar').disabled = true; return; }
  lock(false);
}
q('#btnCuentas').onclick = async () => {
  if (!last?.out?.length) { setStatus('Primero carga y calcula para elegir un docente.', 'warn'); return; }
  activeMonth = period();
  q('#cuentaPeriodo').textContent = `Mes: ${activeMonth}`;
  q('#cuentaDocente').innerHTML = last.out.map(r => `<option value="${html(r.docente)}">${html(r.docente)}</option>`).join('');
  q('#cuentaCarpeta').hidden = true;
  dialog.showModal(); lock(true);
  try {
    await ensureFlujoAuth();
    const data = (await configRef(activeMonth).get()).data();
    if (data?.url) { q('#cuentaCarpeta').href = driveUrl(data.url, true); q('#cuentaCarpeta').hidden = false; }
    await loadAccount();
  } catch (err) { status(err.message); lock(false); q('#cuentaGuardar').disabled = true; }
};
q('#cuentaDocente').onchange = loadAccount;
q('#cuentaArchivo').onchange = async () => {
  const file = q('#cuentaArchivo').files[0];
  if (!file) return;
  lock(true); selectedFile = null; status('Leyendo documento…');
  try {
    if (file.size > 15 * 1024 * 1024) throw new Error('El máximo es 15 MB.');
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx'].includes(extension)) throw new Error('Selecciona PDF o Word .docx.');
    const buffer = await file.arrayBuffer();
    let text;
    if (extension === 'docx') {
      if (!window.mammoth) throw new Error('No cargó el lector Word. Revisa la conexión.');
      text = (await window.mammoth.extractRawText({ arrayBuffer: buffer })).value;
    } else {
      const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
      const pdf = await pdfjs.getDocument({ data: buffer, isEvalSupported: false }).promise;
      try {
        if (pdf.numPages > 100) throw new Error('El máximo es 100 páginas.');
        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          pages.push(content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join(''));
        }
        text = pages.join('\n\n');
      } finally { await pdf.destroy(); }
    }
    if (text.length > 40000) throw new Error('El texto supera 40.000 caracteres. Resume o transcribe las observaciones manualmente.');
    selectedFile = file; uploaded = null; q('#cuentaEnlace').value = '';
    q('#cuentaTexto').value = text.trim();
    status(text.trim() ? 'Lectura lista. Revisa el texto y guarda la cuenta. El archivo se subirá al enviar a Flujo de Caja.' : 'No se detectó texto. Transcribe las observaciones y guarda la cuenta; el archivo se subirá al enviar.');
  } catch (err) { status(`No se pudo leer: ${err.message}. Las observaciones anteriores se conservaron.`); }
  finally { lock(false); }
};
async function driveToken() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive');
  initFlujoFirebase();
  const login = await firebase.auth(flujoApp).signInWithPopup(provider);
  const token = login.credential?.accessToken;
  if (!token) throw new Error('Google no entregó acceso a Drive.');
  return token;
}
async function uploadFile(file, folder, token) {
  const mime = file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const session = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Upload-Content-Type': mime },
    body: JSON.stringify({ name: file.name, parents: [folderId(folder)] })
  });
  if (!session.ok) { const error = await session.json(); throw new Error(error.error?.message || 'Drive rechazó la subida. Revisa los permisos.'); }
  const location = session.headers.get('Location');
  if (!location) throw new Error('Drive no entregó una sesión de subida.');
  const response = await fetch(location, { method: 'PUT', headers: { 'Content-Type': mime }, body: file });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'No se pudo completar la subida.');
  return data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`;
}
q('#cuentaGuardar').onclick = async () => {
  lock(true);
  try {
    const url = driveUrl(q('#cuentaEnlace').value);
    const text = q('#cuentaTexto').value.trim();
    if (text.length > 40000) throw new Error('Máximo 40.000 caracteres.');
    await pendingReady;
    const key = pendingKey(activeMonth, activeTeacher);
    if (selectedFile) {
      if (pendingError) throw pendingError;
      const previous = pendingFiles.get(key);
      if (previous?.file !== selectedFile) await pendingWrite(key, { file: selectedFile });
    }
    const pending = pendingFiles.get(key);
    await accountRef(activeMonth, activeTeacher).set({ docente: activeTeacher, mes: activeMonth, observaciones: text, archivoUrl: pending ? '' : url, archivoNombre: pending?.file.name || uploaded?.name || '', archivoPendiente: !!pending, actualizadoEn: firebase.firestore.FieldValue.serverTimestamp() });
    status(pending ? `Cuenta guardada con ${pending.file.name}. Al enviar a Flujo de Caja se subirá a la carpeta del mes. El adjunto está conservado en este navegador hasta enviarlo.` : 'Observaciones guardadas para el envío a Flujo de Caja.');
  } catch (err) { status(`No se guardó: ${err.message}`); }
  finally { lock(false); }
};
let settingsRequest = 0;
async function loadSettings() {
  const request = ++settingsRequest, month = q('#driveMes').value;
  q('#driveGuardar').disabled = true; q('#driveUrl').value = ''; q('#driveEstado').textContent = 'Cargando…';
  try {
    await ensureFlujoAuth(); const snap = await configRef(month).get();
    if (request !== settingsRequest) return;
    q('#driveUrl').value = snap.data()?.url || ''; q('#driveEstado').textContent = ''; q('#driveGuardar').disabled = false;
  } catch (err) { if (request === settingsRequest) q('#driveEstado').textContent = err.message; }
}
q('#btnAjustesDrive').onclick = () => { q('#driveMes').value = period(); settings.showModal(); loadSettings(); };
q('#driveMes').onchange = () => { if (q('#driveMes').value) loadSettings(); else q('#driveGuardar').disabled = true; };
q('#driveGuardar').onclick = async () => {
  const month = q('#driveMes').value;
  q('#driveGuardar').disabled = true; q('#driveMes').disabled = true;
  try {
    const url = driveUrl(q('#driveUrl').value, true);
    await configRef(month).set({ url, actualizadoEn: firebase.firestore.FieldValue.serverTimestamp() });
    q('#driveEstado').textContent = `Carpeta guardada para ${month}.`;
  } catch (err) { q('#driveEstado').textContent = `No se guardó: ${err.message}`; }
  finally { q('#driveGuardar').disabled = false; q('#driveMes').disabled = false; }
};
window.cuentasCobro = {
  async prepararEnvio(year, month, rows, progress = () => {}) {
    if (!pendingLoaded) throw new Error('Espera un momento mientras cargan los adjuntos y vuelve a enviar.');
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const queued = rows.filter(row => pendingFiles.has(pendingKey(key, row.docente)));
    // Iniciar autorización desde el clic de Guardar en Flujo, antes de leer Firestore.
    const token = queued.some(row => !pendingFiles.get(pendingKey(key, row.docente)).url) ? await driveToken() : null;
    await ensureFlujoAuth();
    const accounts = await Promise.all(rows.map(async row => ({ row, data: (await accountRef(key, row.docente).get()).data() || {} })));
    for (const { row, data } of accounts) {
      if (data.archivoPendiente && !pendingFiles.has(pendingKey(key, row.docente))) throw new Error(`Vuelve a adjuntar el archivo de ${row.docente} en este navegador antes de enviar.`);
    }
    let folder;
    if (queued.length) {
      folder = (await configRef(key).get()).data()?.url;
      if (!folder) throw new Error(`Falta la carpeta de Drive para ${key}. Agrégala en Ajustes de Drive.`);
      driveUrl(folder, true);
    }
    for (const row of queued) {
      const id = pendingKey(key, row.docente);
      const pending = pendingFiles.get(id);
      progress(`Subiendo cuenta de ${row.docente} a Drive…`);
      if (!pending.url) {
        pending.url = await uploadFile(pending.file, folder, token);
        // Conservar el resultado antes de guardar en Firestore para reintentar sin duplicar.
        await pendingWrite(id, pending);
      }
      await accountRef(key, row.docente).set({ archivoUrl: pending.url, archivoNombre: pending.file.name, archivoPendiente: false, actualizadoEn: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await pendingWrite(id, null);
    }
    return this.observaciones(year, month, rows);
  },
  async observaciones(year, month, rows) {
    await ensureFlujoAuth();
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const entries = await Promise.all(rows.map(async row => {
      const data = (await accountRef(key, row.docente).get()).data() || {};
      const url = driveUrl(data.archivoUrl || '');
      return [row.id, { observaciones: [data.observaciones || '', url ? `Cuenta de cobro: ${url}` : ''].filter(Boolean).join('\n\n'), cuentaCobroUrl: url, cuentaCobroArchivo: data.archivoNombre || '' }];
    }));
    return Object.fromEntries(entries);
  }
};
