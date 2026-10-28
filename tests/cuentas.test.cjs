const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function harness(data = {}) {
  const elements = new Map();
  const element = () => ({ value: '', disabled: false, hidden: false, innerHTML: '', addEventListener() {}, querySelector() { return element(); }, showModal() {} });
  const reads = [];
  const writes = [];
  const context = vm.createContext({
    document: { querySelector(s) { if (!elements.has(s)) elements.set(s, element()); return elements.get(s); }, createElement: element, body: { append() {} } },
    escapeHtml: String, keyDocente: s => s.toUpperCase(), CFG: {}, window: {},
    firebase: { firestore: { FieldValue: { serverTimestamp: () => "timestamp" } } },
    getMesAño: () => ({ año: 2026, mes: 10 }), ensureAuth: async () => { throw Error("No usar autenticación RIP"); },
    ensureFlujoAuth: async () => {},
    initFirebase: () => { throw Error("No usar Firestore RIP"); },
    initFlujoFirebase: () => ({ collection: c => ({ doc: id => ({ set: async value => { writes.push([c, id, value]); }, get: async () => { reads.push([c, id]); if (data.error) throw Error('sin permisos'); return { data: () => data[id] }; } }) }) })
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

test('guardar cuenta y carpeta escribe en Flujo sin acceder a RIP', async () => {
  const { context, writes, elements } = harness(); context.URL = URL;
  vm.runInContext("activeMonth = '2026-10'; activeTeacher = 'Ana';", context);
  context.document.querySelector('#cuentaTexto').value = 'Cuenta revisada';
  context.document.querySelector('#cuentaEnlace').value = 'https://drive.google.com/file/d/abc/view';
  await elements.get('#cuentaGuardar').onclick();
  elements.get('#driveMes').value = '2026-10';
  context.document.querySelector('#driveUrl').value = 'https://drive.google.com/drive/folders/octubre';
  await elements.get('#driveGuardar').onclick();
  assert.equal(writes.length, 2);
  assert.equal(writes[0][0], 'cuentas_docentes');
  assert.equal(writes[0][1], '2026-10_ANA');
  assert.equal(writes[0][2].observaciones, 'Cuenta revisada');
  assert.equal(writes[1][0], 'configuracion');
  assert.equal(writes[1][1], 'drive_cuentas_2026-10');
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
    uploadFile = async (file, folder, token) => { uploads.push({ name: file.name, folder, token }); return 'https://drive.google.com/file/d/uploaded/view'; };
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
