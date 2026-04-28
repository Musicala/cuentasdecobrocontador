// CONFIG RIP · Cuenta de cobro (Docentes)

window.RIP_CONFIG = {
  // TSV pegado y oculto (interno)
  TSV_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vREJFkqvhXwjBNPCQXTg4pHXUplygJU1ZZG6-xgOeAJ2ifnEMHmuoDJKwQIpxVfGfCrmfmNCS_8RHTc/pub?gid=1810443337&single=true&output=tsv",

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
