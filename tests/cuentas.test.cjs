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
