const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function harness(data = {}) {
  const elements = new Map();
  const element = () => ({ value: '', disabled: false, hidden: false, innerHTML: '', listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; }, querySelectorAll() { return []; }, querySelector() { return element(); }, showModal() {} });
  const reads = [];
  const writes = [];
  const context = vm.createContext({
    document: { querySelector(s) { if (!elements.has(s)) elements.set(s, element()); return elements.get(s); }, createElement: element, body: { append() {} } },
    escapeHtml: String, keyDocente: s => s.toUpperCase(), CFG: {}, window: {},
    firebase: { firestore: { FieldValue: { serverTimestamp: () => "timestamp" } } },
    getMesAño: () => ({ año: 2026, mes: 10 }), ensureAuth: async () => { throw Error("No usar autenticación RIP"); },
    ensureFlujoAuth: async () => {},
    initFirebase: () => { throw Error("No usar Firestore RIP"); },
    initFlujoFirebase: () => ({ collection: c => ({ doc: id => ({ set: async (value, options) => { writes.push([c, id, value]); data[id] = options?.merge ? { ...data[id], ...value } : value; }, get: async () => { reads.push([c, id]); if (data.error) throw Error('sin permisos'); return { data: () => data[id] }; } }) }) })
  });
  vm.runInContext(fs.readFileSync('cuentas.js', 'utf8'), context);
  return { context, reads, writes, elements };
}
test('valida carpetas y bloquea enlaces externos o inseguros', () => {
  const { context } = harness(); context.URL = URL;
  assert.equal(vm.runInContext("folderId('https://drive.google.com/drive/u/0/folders/abc_123?usp=sharing')", context), 'abc_123');
  for (const value of ['javascript:alert(1)', 'https://drive.google.com.evil.org/drive/folders/abc', 'http://drive.google.com/drive/folders/abc', 'https://drive.google.com/file/d/abc/view']) {
    context.input = value; assert.throws(() => vm.runInContext('driveUrl(input, true)', context));
  }
});
test('envía observaciones y archivo solo del mes y docente solicitados', async () => {
  const { context, reads } = harness({ '2026-10_ANA': { observaciones: 'Horas revisadas', archivoUrl: 'https://drive.google.com/file/d/abc/view', archivoNombre: 'cuenta.pdf' }, '2026-09_ANA': { observaciones: 'MES ANTERIOR' } });
  context.URL = URL;
  const result = await context.window.cuentasCobro.observaciones(2026, 10, [{ id: 'ana', docente: 'Ana' }, { id: 'luis', docente: 'Luis' }]);
  assert.equal(result.ana.observaciones, 'Horas revisadas\n\nCuenta de cobro: https://drive.google.com/file/d/abc/view');
  assert.equal(result.ana.cuentaCobroArchivo, 'cuenta.pdf');
  assert.equal(result.luis.observaciones, '');
  assert.deepEqual(reads, [['cuentas_docentes', '2026-10_ANA'], ['cuentas_docentes', '2026-10_LUIS']]);
});
test('un error de lectura impide enviar sin las observaciones', async () => {
  const { context } = harness({ error: true }); context.URL = URL;
  await assert.rejects(context.window.cuentasCobro.observaciones(2026, 10, [{ id: 'ana', docente: 'Ana' }]), /sin permisos/);
});

test('guardar carpeta escribe en Flujo sin acceder a RIP', async () => {
  const { context, writes, elements } = harness(); context.URL = URL;
  elements.get('#driveMes').value = '2026-10';
  context.document.querySelector('#driveUrl').value = 'https://drive.google.com/drive/folders/octubre';
  await elements.get('#driveGuardar').onclick();
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], 'configuracion');
  assert.equal(writes[0][1], 'drive_cuentas_2026-10');
});

function queueHarness(data, queued = {}) {
  const h = harness(data); h.context.URL = URL;
  h.context.queued = queued;
  h.context.uploads = [];
  h.context.authorizations = 0;
  vm.runInContext(`
    pendingLoaded = true;
    for (const [key, value] of Object.entries(queued)) pendingFiles.set(key, value);
    pendingWrite = async (key, value) => { if (value) pendingFiles.set(key, value); else pendingFiles.delete(key); };
    driveToken = async () => { authorizations++; return 'token'; };
    uploadFile = async (file, folder, token, displayName) => { uploads.push({ name: file.name, folder, token, displayName }); return 'https://drive.google.com/file/d/uploaded/view'; };
  `, h.context);
  return h;
}
test('envío sube solo el docente solicitado a la carpeta de su mes', async () => {
  const h = queueHarness({ 'drive_cuentas_2026-10': { url: 'https://drive.google.com/drive/folders/octubre' }, '2026-10_ANA': { archivoPendiente: true } }, { '2026-10_ANA': { file: { name: 'ana.pdf' } }, '2026-09_ANA': { file: { name: 'anterior.pdf' } }, '2026-10_LUIS': { file: { name: 'luis.pdf' } } });
  await h.context.window.cuentasCobro.prepararEnvio(2026, 10, [{ docente: 'Ana', id: 'ana' }]);
  assert.equal(h.context.uploads.length, 1);
  assert.equal(h.context.uploads[0].name, 'ana.pdf');
  assert.equal(h.context.uploads[0].folder, 'https://drive.google.com/drive/folders/octubre');
  assert.equal(h.writes[0][2].archivoPendiente, false);
  assert.equal(h.writes[0][2].archivoUrl, 'https://drive.google.com/file/d/uploaded/view');
});
test('sin carpeta del mes se bloquea el envío antes de subir', async () => {
  const h = queueHarness({}, { '2026-10_ANA': { file: { name: 'ana.pdf' } } });
  await assert.rejects(h.context.window.cuentasCobro.prepararEnvio(2026, 10, [{ docente: 'Ana' }]), /Falta la carpeta/);
  assert.equal(h.context.uploads.length, 0);
  assert.equal(h.writes.length, 0);
});
test('adjunto marcado como pendiente en otro navegador bloquea el envío', async () => {
  const h = queueHarness({ '2026-10_ANA': { archivoPendiente: true } });
  await assert.rejects(h.context.window.cuentasCobro.prepararEnvio(2026, 10, [{ docente: 'Ana' }]), /Vuelve a adjuntar/);
  assert.equal(h.writes.length, 0);
});
test('si falla Drive, no guarda el soporte como subido', async () => {
  const h = queueHarness({ 'drive_cuentas_2026-10': { url: 'https://drive.google.com/drive/folders/octubre' } }, { '2026-10_ANA': { file: { name: 'ana.pdf' } } });
  vm.runInContext("uploadFile = async () => { throw Error('Drive sin permisos'); };", h.context);
  await assert.rejects(h.context.window.cuentasCobro.prepararEnvio(2026, 10, [{ docente: 'Ana' }]), /Drive sin permisos/);
  assert.equal(h.writes.length, 0);
  assert.equal(vm.runInContext("pendingFiles.has('2026-10_ANA')", h.context), true);
});
test('reintento conserva la URL y no duplica una subida ya completada', async () => {
  const h = queueHarness({ 'drive_cuentas_2026-10': { url: 'https://drive.google.com/drive/folders/octubre' } }, { '2026-10_ANA': { file: { name: 'ana.pdf' }, url: 'https://drive.google.com/file/d/existing/view' } });
  await h.context.window.cuentasCobro.prepararEnvio(2026, 10, [{ docente: 'Ana', id: 'ana' }]);
  assert.equal(h.context.uploads.length, 0);
  assert.equal(h.context.authorizations, 0);
  assert.equal(h.writes[0][2].archivoUrl, 'https://drive.google.com/file/d/existing/view');
});

test('dos docentes se suben a una misma carpeta y llevan sus propias observaciones', async () => {
  const h = queueHarness({ 'drive_cuentas_2026-10': { url: 'https://drive.google.com/drive/folders/octubre' } }, { '2026-10_ANA': { file: { name: 'ana.pdf' } }, '2026-10_LUIS': { file: { name: 'luis.pdf' } } });
  vm.runInContext("drafts.set('2026-10_ANA', { observaciones: 'Cuenta Ana' }); drafts.set('2026-10_LUIS', { observaciones: 'Cuenta Luis' });", h.context);
  const result = await h.context.window.cuentasCobro.prepararEnvio(2026, 10, [{ docente: 'Ana', id: 'ana' }, { docente: 'Luis', id: 'luis' }]);
  assert.equal(h.context.uploads.length, 2);
  assert.equal(h.context.uploads[0].folder, h.context.uploads[1].folder);
  assert.equal(h.context.uploads[0].displayName, '2026-10 - Ana - ana.pdf');
  assert.equal(h.context.uploads[1].displayName, '2026-10 - Luis - luis.pdf');
  assert.match(result.ana.observaciones, /^Cuenta Ana/);
  assert.match(result.luis.observaciones, /^Cuenta Luis/);
});
test('el envío exige adjuntar la cuenta del docente', async () => {
  const h = queueHarness({});
  await assert.rejects(h.context.window.cuentasCobro.prepararEnvio(2026, 10, [{ docente: 'Ana' }]), /Adjunta la cuenta/);
  assert.equal(h.writes.length, 0);
});
test('el selector de archivos vive dentro de Flujo y lee Word sin guardar aparte', async () => {
  const h = queueHarness({});
  await vm.runInContext('pendingReady', h.context);
  vm.runInContext('pendingError = null;', h.context);
  h.context.window.mammoth = { extractRawText: async () => ({ value: 'Servicios del docente' }) };
  h.context.file = { name: 'ana.docx', size: 100, arrayBuffer: async () => new ArrayBuffer(1) };
  vm.runInContext("drafts.set('2026-10_ANA', { docente: 'Ana', mes: '2026-10' });", h.context);
  const event = { target: { matches: () => true, files: [h.context.file], closest: () => ({ dataset: { cuentaKey: '2026-10_ANA' } }) } };
  await h.elements.get('#flujoBody').listeners.change(event);
  assert.equal(vm.runInContext("drafts.get('2026-10_ANA').observaciones", h.context), 'Servicios del docente');
  assert.equal(vm.runInContext("pendingFiles.get('2026-10_ANA').file.name", h.context), 'ana.docx');
  const markup = h.context.window.cuentasCobro.renderCuenta({ docente: 'Ana' }, '2026-10');
  assert.match(markup, /data-cuenta-file/);
  assert.match(markup, /Servicios del docente/);
  assert.doesNotMatch(fs.readFileSync('index.html', 'utf8'), /id="btnCuentas"/);
});
