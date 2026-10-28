// Cuentas recibidas: texto revisado y enlaces compartidos por mes/docente.
const q = s => document.querySelector(s);
const html = s => escapeHtml(String(s ?? ''));
const period = () => { const { año, mes } = getMesAño(); return `${año}-${String(mes).padStart(2, '0')}`; };
const configRef = month => initFlujoFirebase().collection(CFG.FIRESTORE_CONFIG_COLLECTION || 'configuracion').doc(`drive_cuentas_${month}`);
const accountRef = (month, teacher) => initFlujoFirebase().collection('cuentas_docentes').doc(`${month}_${encodeURIComponent(keyDocente(teacher))}`);
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

const settings = document.createElement('dialog');
settings.className = 'dlg';
settings.innerHTML = `<form method="dialog" class="dlgCard"><div class="dlgHead"><div class="dlgTitle">Carpetas de los contadores</div><button class="x" aria-label="Cerrar">✕</button></div><label for="driveMes">Mes</label><input id="driveMes" type="month" required><label for="driveUrl">Enlace de la carpeta de Drive</label><input id="driveUrl" type="url" placeholder="https://drive.google.com/drive/folders/…"><p class="hint">Una sola carpeta por mes para todos los docentes. Los archivos de ese mes se suben juntos allí. Deja el enlace vacío para quitarlo.</p><p id="driveEstado" role="status"></p><button id="driveGuardar" class="primary" type="button">Guardar carpeta</button></form>`;
document.body.append(settings);
function driveUrl(value, folder = false) {
  if (!value.trim()) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || (folder && !/\/folders\/[\w-]+/.test(url.pathname))) throw new Error(folder ? 'Usa el enlace de una carpeta de Google Drive.' : 'Usa un enlace HTTPS de Google Drive.');
  return url.href;
}
function folderId(url) { return new URL(driveUrl(url, true)).pathname.match(/\/folders\/([\w-]+)/)[1]; }
const drafts = new Map();
let readingCount = 0;
let sending = false;
async function readAccount(file) {
    const extension = file.name.split(".").pop().toLowerCase();
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
    if (text.length > 40000) return '';
    return text.trim();
}
function renderAccount(row, month) {
  const key = pendingKey(month, row.docente);
  const data = drafts.get(key);
  if (!data) return '<span class="hint">Cargando cuenta…</span>';
  const pending = pendingFiles.get(key);
  const name = pending?.file.name || data.archivoNombre;
  return `<div class="flujoAccount" data-cuenta-key="${html(key)}">
    <label>Cuenta de cobro · ${html(row.docente)}
      <input type="file" accept=".pdf,.docx" data-cuenta-file ${sending || data.reading ? 'disabled' : ''}>
    </label>
    <p class="hint" role="status">${html(data.message || (name ? `Archivo: ${name}` : 'Adjunta la cuenta para enviar este docente.'))}</p>
    ${data.archivoUrl && !pending ? `<a href="${html(driveUrl(data.archivoUrl))}" target="_blank" rel="noopener noreferrer">Ver cuenta en Drive</a>` : ''}
    <details><summary>Revisar observaciones de la cuenta</summary>
      <textarea data-cuenta-text rows="5" maxlength="40000" ${sending || data.reading ? 'disabled' : ''} placeholder="Texto de la cuenta y observaciones">${html(data.observaciones || '')}</textarea>
    </details>
  </div>`;
}
function updateAccount(key) {
  const box = [...q('#flujoBody').querySelectorAll('[data-cuenta-key]')].find(node => node.dataset.cuentaKey === key);
  if (box) box.outerHTML = renderAccount({ docente: drafts.get(key).docente }, drafts.get(key).mes);
}
q('#flujoBody').addEventListener('input', event => {
  if (!event.target.matches('[data-cuenta-text]')) return;
  const key = event.target.closest('[data-cuenta-key]').dataset.cuentaKey;
  drafts.get(key).observaciones = event.target.value;
});
q('#flujoBody').addEventListener('change', async event => {
  if (!event.target.matches('[data-cuenta-file]') || sending) return;
  const file = event.target.files[0];
  if (!file) return;
  const key = event.target.closest('[data-cuenta-key]').dataset.cuentaKey;
  const draft = drafts.get(key);
  try {
    if (file.size > 15 * 1024 * 1024) throw new Error('El máximo es 15 MB.');
    if (!/\.(pdf|docx)$/i.test(file.name)) throw new Error('Selecciona PDF o Word .docx.');
    await pendingReady;
    if (pendingError) throw pendingError;
    readingCount++; draft.reading = true; draft.message = 'Leyendo cuenta…'; updateAccount(key);
    // Primero conservar el archivo; un escaneo también se puede adjuntar.
    await pendingWrite(key, { file });
    draft.archivoNombre = file.name; draft.archivoUrl = ''; draft.archivoPendiente = true;
    try {
      draft.observaciones = await readAccount(file);
      draft.message = draft.observaciones ? `${file.name} listo. Revisa las observaciones; se subirá al guardar en Flujo.` : `${file.name} adjunto. No se detectó texto; escribe las observaciones manualmente.`;
    } catch (err) {
      draft.observaciones = '';
      draft.message = `${file.name} adjunto. No se pudo leer: ${err.message}. Puedes escribir las observaciones manualmente.`;
    }
  } catch (err) { draft.message = err.message; }
  finally {
    if (draft.reading) readingCount--;
    draft.reading = false; updateAccount(key);
  }
});
async function driveToken() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive');
  initFlujoFirebase();
  const login = await firebase.auth(flujoApp).signInWithPopup(provider);
  const token = login.credential?.accessToken;
  if (!token) throw new Error('Google no entregó acceso a Drive.');
  return token;
}
async function uploadFile(file, folder, token, displayName = file.name) {
  const mime = file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const session = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Upload-Content-Type': mime },
    body: JSON.stringify({ name: displayName, parents: [folderId(folder)] })
  });
  if (!session.ok) { const error = await session.json(); throw new Error(error.error?.message || 'Drive rechazó la subida. Revisa los permisos.'); }
  const location = session.headers.get('Location');
  if (!location) throw new Error('Drive no entregó una sesión de subida.');
  const response = await fetch(location, { method: 'PUT', headers: { 'Content-Type': mime }, body: file });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'No se pudo completar la subida.');
  return data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`;
}
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
  renderCuenta: renderAccount,
  setEnviando(value) {
    sending = value;
    q('#flujoBody').querySelectorAll('input, textarea').forEach(input => { input.disabled = value; });
  },
  async cargar(year, month, rows) {
    await pendingReady;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const folder = (await configRef(key).get()).data()?.url;
    const description = q('#flujoCarpeta');
    if (folder) description.innerHTML = `Todos los docentes se subirán a la misma <a href="${html(driveUrl(folder, true))}" target="_blank" rel="noopener noreferrer">carpeta de ${html(key)}</a>.`;
    else description.textContent = `Falta la carpeta compartida de ${key}. Configúrala en Ajustes de Drive.`;
    await Promise.all(rows.map(async row => {
      const id = pendingKey(key, row.docente);
      if (!drafts.has(id)) {
        const data = (await accountRef(key, row.docente).get()).data() || {};
        drafts.set(id, { ...data, docente: row.docente, mes: key });
      }
    }));
  },
  async prepararEnvio(year, month, rows, progress = () => {}) {
    if (readingCount) throw new Error('Espera a que termine la lectura de las cuentas antes de enviar.');
    if (!pendingLoaded) throw new Error('Espera un momento mientras cargan los adjuntos y vuelve a enviar.');
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const queued = rows.filter(row => pendingFiles.has(pendingKey(key, row.docente)));
    // Iniciar autorización desde el clic de Guardar en Flujo, antes de leer Firestore.
    const token = queued.some(row => !pendingFiles.get(pendingKey(key, row.docente)).url) ? await driveToken() : null;
    await ensureFlujoAuth();
    const accounts = await Promise.all(rows.map(async row => ({ row, data: drafts.get(pendingKey(key, row.docente)) || (await accountRef(key, row.docente).get()).data() || {} })));
    for (const { row, data } of accounts) {
      const pending = pendingFiles.get(pendingKey(key, row.docente));
      if (data.archivoPendiente && !pending) throw new Error(`Vuelve a adjuntar el archivo de ${row.docente} en este navegador antes de enviar.`);
      if (!pending && !data.archivoUrl) throw new Error(`Adjunta la cuenta de cobro de ${row.docente} antes de enviar.`);
      if (String(data.observaciones || '').length > 40000) throw new Error(`Las observaciones de ${row.docente} superan 40.000 caracteres.`);
    }
    let folder;
    if (queued.length) {
      folder = (await configRef(key).get()).data()?.url;
      if (!folder) throw new Error(`Falta la carpeta de Drive para ${key}. Agrégala en Ajustes de Drive.`);
      driveUrl(folder, true);
    }
    for (const { row, data } of accounts) {
      const id = pendingKey(key, row.docente);
      const pending = pendingFiles.get(id);
      if (!pending) {
        await accountRef(key, row.docente).set({ observaciones: data.observaciones || '', actualizadoEn: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        continue;
      }
      progress(`Subiendo cuenta de ${row.docente} a Drive…`);
      if (!pending.url) {
        pending.url = await uploadFile(pending.file, folder, token, `${key} - ${row.docente} - ${pending.file.name}`);
        // Conservar el resultado antes de guardar en Firestore para reintentar sin duplicar.
        await pendingWrite(id, pending);
      }
      await accountRef(key, row.docente).set({ docente: row.docente, mes: key, observaciones: data.observaciones || '', archivoUrl: pending.url, archivoNombre: pending.file.name, archivoPendiente: false, actualizadoEn: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      Object.assign(data, { archivoUrl: pending.url, archivoNombre: pending.file.name, archivoPendiente: false, message: 'Cuenta subida a Drive.' });
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
