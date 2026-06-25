// CONFIG RIP · Cuenta de cobro (Docentes)

window.RIP_CONFIG = {

  FLUJO_CONFIG: {
    apiKey: "AIzaSyBnd0yBKhBcEyS5XX7BO6WqT9mRET1zJio",
    authDomain: "flujo-de-caja-musicala.firebaseapp.com",
    projectId: "flujo-de-caja-musicala",
    storageBucket: "flujo-de-caja-musicala.firebasestorage.app",
    messagingSenderId: "998009800481",
    appId: "1:998009800481:web:3d36e4b579417657ada060"
  },

  FLUJO_COLLECTION: "seguimiento_egresos",
  FIREBASE_CONFIG: {
    apiKey: "AIzaSyCaCizVkfWdx97LROV7PYQbFXLPMpxynBg",
    authDomain: "rip-musicala.firebaseapp.com",
    projectId: "rip-musicala",
    storageBucket: "rip-musicala.firebasestorage.app",
    messagingSenderId: "401885071105",
    appId: "1:401885071105:web:6bb9b6867d7d81fdec3d00"
  },

  // Coleccion donde quedó importado el TSV.
  // La app acepta documentos guardados como:
  // - { row: [...] } o { cells: [...] }
  // - campos por letra: { D, E, H, O, P }
  // - campos por nombre: { nombre, fecha, docente, cantidad, categoria }
  FIRESTORE_COLLECTION: "registro",

  // Columnas según tu regla:
  // E = Fecha
  // H = Docente
  // O = Cantidad (num, se SUMA)
  // P = Categoría (texto)
  IDX: {
    FECHA: 4,    // E
    DOCENTE: 7,  // H
    CANT: 14,    // O
    CAT: 15      // P
  },

  // Tarifas demo (por categoría P).
  // Clave: texto exacto de P, normalizado a MAYÚSCULAS.
  DEFAULT_TARIFAS: {
    "MH P": 40000,
    "MS P": 30000,
    "MS G": 30000,
    "MV P": 30000,
    "FSA": 56000,
    "SPACES": 0
  },

  LS_KEY_TARIFAS: "rip_tarifas_por_categoria_v1"
};
