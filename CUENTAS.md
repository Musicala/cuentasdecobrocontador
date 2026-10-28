# Cuentas recibidas

1. Cargar y calcular el mes. En Ajustes de Drive seleccionar el mes y guardar el enlace de la carpeta de los contadores.
2. En Cuentas recibidas seleccionar el docente y un PDF con texto o Word .docx. Revisar y editar el texto extraído.
3. Subir el archivo a Drive o subirlo manualmente desde Abrir carpeta del mes y pegar su enlace. Guardar observaciones.
4. Enviar a Flujo de Caja. Cada registro recibe observaciones, cuentaCobroUrl y cuentaCobroArchivo. Para registros existentes usar Reemplazar. Los importes siguen saliendo del cálculo del RIP; el documento no modifica el valor automáticamente.

Las observaciones, los enlaces de los soportes y las carpetas mensuales se guardan en Firestore de flujo-de-caja-musicala. La autenticación de Drive también usa ese proyecto (la app Firebase llamada flujo). RIP conserva clases, tarifas y jornadas.

## Configuración para producción

- Servir por HTTP/HTTPS (el lector utiliza módulos de JavaScript).
- En el proyecto Google Cloud de flujo-de-caja-musicala habilitar Google Drive API y configurar el consentimiento OAuth del proveedor Google con https://www.googleapis.com/auth/drive. Se solicita al pulsar Subir archivo porque la carpeta se configura por URL y no mediante Google Picker. Es un alcance restringido; revisar requisitos de verificación o configuración interna del dominio. El token solo se usa en memoria para la petición.
- La cuenta elegida debe tener permiso de escritura en la carpeta del mes. La app conserva los permisos existentes de Drive.
- Las reglas de Firestore del proyecto flujo-de-caja-musicala deben permitir al equipo autorizado leer/escribir configuracion/drive_cuentas_YYYY-MM y cuentas_docentes/{mes_docente}. Aplicar las mismas restricciones de equipo que a los egresos; no abrir las reglas públicamente. No se incluyen reglas nuevas porque no están disponibles las reglas actuales.
- Verificar que la app que muestra Flujo de Caja presenta el campo observaciones. Este repositorio contiene únicamente el emisor, no la interfaz receptora.
- PDF.js 4.10.38 y Mammoth 1.11.0 se cargan desde jsDelivr; Firebase conserva los SDK existentes. Se requiere conexión para lectores y servicios.

Límites: 15 MB por archivo, 100 páginas PDF, 40.000 caracteres de observaciones. Sin OCR ni lectura de .doc antiguo. Se guarda una cuenta vigente por docente/mes; guardar de nuevo reemplaza sus observaciones y vínculo. Un nuevo archivo se sube sin borrar el anterior de Drive. Si la subida funciona pero falla guardar observaciones, conservar el enlace que aparece y reintentar Guardar; no volver a subir.

## Validación

node --check app.js
node --check cuentas.js
node --test tests/cuentas.test.cjs

Las pruebas cubren validación de enlaces, separación por mes/docente y bloqueo del envío si falla la lectura de observaciones. La conexión real OAuth/Drive/Firestore requiere probar en el despliegue con una cuenta autorizada; no se realizaron escrituras reales durante el desarrollo.

Referencias: https://developers.google.com/workspace/drive/api/guides/manage-uploads y https://developers.google.com/workspace/drive/api/guides/api-specific-auth

Si se alcanzaron a guardar cuentas o carpetas con la versión anterior en rip-musicala, esos datos no se migran automáticamente: volver a guardar las observaciones y los enlaces en la versión nueva. Los archivos ya subidos permanecen en Drive y se puede pegar su enlace sin volver a subirlos.
