# Cuentas recibidas

1. En Ajustes de Drive elegir cada mes y guardar el enlace de su carpeta. Es una sola carpeta por mes, compartida por todos los docentes.
2. Cargar y calcular el mes; pulsar Flujo de Caja.
3. En la misma ventana marcar los docentes a enviar y adjuntar la cuenta PDF o Word .docx de cada uno. El selector lee el texto automáticamente y conserva el archivo en este navegador. Revisar o editar las observaciones en la fila del docente. No existe un paso separado de Cuentas recibidas ni un botón de guardar adjuntos.
4. Pulsar Guardar en Flujo. Se pide autorización de Google si corresponde, se suben los archivos a la carpeta común del mes y se guardan los egresos con observaciones y enlaces. Es obligatorio contar con un adjunto o un soporte ya subido por cada docente seleccionado. Si falta carpeta, falta cuenta o falla Drive, no se inicia la escritura de egresos. Para registros existentes usar Reemplazar. Los importes siguen saliendo del cálculo del RIP; el documento no modifica el valor automáticamente.

Las observaciones, los enlaces de los soportes y las carpetas mensuales se guardan en Firestore de flujo-de-caja-musicala. La autenticación de Drive también usa ese proyecto (la app Firebase llamada flujo). RIP conserva clases, tarifas y jornadas.

## Configuración para producción

- Servir por HTTP/HTTPS (el lector utiliza módulos de JavaScript).
- En el proyecto Google Cloud de flujo-de-caja-musicala habilitar Google Drive API y configurar el consentimiento OAuth del proveedor Google con https://www.googleapis.com/auth/drive. Se solicita al pulsar Guardar en Flujo porque la carpeta se configura por URL y no mediante Google Picker. Es un alcance restringido; revisar requisitos de verificación o configuración interna del dominio. El token solo se usa en memoria para la petición.
- La cuenta elegida debe tener permiso de escritura en la carpeta del mes. La app conserva los permisos existentes de Drive.
- Las reglas de Firestore del proyecto flujo-de-caja-musicala deben permitir al equipo autorizado leer/escribir configuracion/drive_cuentas_YYYY-MM y cuentas_docentes/{mes_docente}. Aplicar las mismas restricciones de equipo que a los egresos; no abrir las reglas públicamente. No se incluyen reglas nuevas porque no están disponibles las reglas actuales.
- Verificar que la app que muestra Flujo de Caja presenta el campo observaciones. Este repositorio contiene únicamente el emisor, no la interfaz receptora.
- PDF.js 4.10.38 y Mammoth 1.11.0 se cargan desde jsDelivr; Firebase conserva los SDK existentes. Se requiere conexión para lectores y servicios.

Límites: 15 MB por archivo, 100 páginas PDF, 40.000 caracteres de observaciones. Sin OCR ni lectura de .doc antiguo. Se guarda una cuenta vigente por docente/mes; guardar de nuevo reemplaza sus observaciones y vínculo. Un nuevo archivo se sube sin borrar el anterior de Drive. Si una subida funciona pero falla un paso posterior, el enlace se conserva para que al reintentar no se vuelva a subir el mismo archivo. Los archivos pendientes se conservan en este navegador; si se borra el almacenamiento o se cambia de dispositivo, hay que adjuntarlos de nuevo. Al completar la preparación del envío se elimina la copia local.

## Validación

node --check app.js
node --check cuentas.js
node --test tests/cuentas.test.cjs

Las pruebas cubren validación de enlaces, separación por mes/docente, escritura en Flujo, subida durante el envío, carpeta faltante, archivo pendiente en otro navegador, error de Drive y reintento sin duplicados. La conexión real OAuth/Drive/Firestore requiere probar en el despliegue con una cuenta autorizada; no se realizaron escrituras reales durante el desarrollo.

Referencias: https://developers.google.com/workspace/drive/api/guides/manage-uploads y https://developers.google.com/workspace/drive/api/guides/api-specific-auth

Si se alcanzaron a guardar cuentas o carpetas con la versión anterior en rip-musicala, esos datos no se migran automáticamente: volver a guardar las observaciones y los enlaces en la versión nueva. Los archivos ya subidos permanecen en Drive y se puede pegar su enlace sin volver a subirlos.
