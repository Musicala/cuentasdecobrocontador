const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function app() {
 const context = vm.createContext({ window: { RIP_CONFIG: { IDX: { FECHA: 4, DOCENTE: 7, CANT: 14, CAT: 15 }, DEFAULT_TARIFAS: {} } }, document: { querySelector: () => ({}) }, localStorage: { getItem: () => null }, structuredClone });
 const source = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
 vm.runInContext(source.slice(0, source.lastIndexOf('try {\n  setup();')), context);
 return context;
}
for (const family of ['MS', 'MH', 'MV']) {
 test(`${family}: grupal de un integrante se cobra personalizada; dos siguen grupal`, () => {
  const c = app(); c.record = { clasificacion: `${family} G` };
  assert.equal(vm.runInContext('finalCategory(record, 1)', c), `${family} P`);
  assert.equal(vm.runInContext('finalCategory(record, 2)', c), `${family} G`);
  c.record = { clasificacion: `${family} P` };
  assert.equal(vm.runInContext('finalCategory(record, 2)', c), `${family} P`);
 });
}
test('aplica a pagos, talleres y filas antiguas', () => {
 const c = app();
 for (const record of [{ tipo: 'PAGO', servicio: 'MS G' }, { servicio: 'Taller Musicala Sede' }, { row: Object.assign([], { 15: 'MS G' }) }]) {
  c.record = record;
  assert.equal(vm.runInContext('finalCategory(record, 1)', c), 'MS P');
  assert.equal(vm.runInContext('finalCategory(record, 2)', c), 'MS G');
 }
});
test('clasifica según integrantes de cada sesión y cuenta la grupal una sola vez', () => {
 const c = app();
 vm.runInContext(`firestoreDocsById = new Map([
 ['a', { claseId: 'individual', docente: 'Ana', estudiante: 'Uno', clasificacion: 'MS G', cantidad: 1 }],
 ['b', { claseId: 'grupo', docente: 'Ana', estudiante: 'Dos', clasificacion: 'MS G', cantidad: 1 }],
 ['c', { claseId: 'grupo', docente: 'Ana', estudiante: 'Tres', clasificacion: 'MS G', cantidad: 1 }]
 ]);`, c);
 const rows = vm.runInContext('getFirestoreRows()', c);
 assert.deepEqual(Array.from(rows, r => r[15]), ['MS P', 'MS G', 'MS G']);
 assert.deepEqual(Array.from(rows, r => r[14]), [1, 1, 0]);
});
