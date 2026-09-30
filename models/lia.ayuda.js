// models/lia.ayuda.js
// ============================================================
// Guía de uso de I attend para Lia (dudas técnicas del organizador).
//
// Se armó revisando el código de iattend-vite (pantallas, botones y textos
// reales de src/locales/es.json) a partir de las preguntas que los
// organizadores le hicieron a Lia en ai_conversations. Antes Lia inventaba la
// interfaz ("sección Seating", "botón Importar, generalmente arriba") o decía
// que algo "estará disponible muy pronto" cuando sí existía.
//
// Si cambia una pantalla o un botón en iattend-vite, hay que actualizar esto.
// Los destinos de los atajos son una lista cerrada: iattend-vite
// (src/pages/Lia/LiaBlocks.jsx, DESTINOS) sabe a qué ruta lleva cada uno.
// ============================================================

// clave → a qué lleva el botón (iattend-vite resuelve la ruta)
const DESTINOS = {
  invitados:          'Invitados (Seguimiento)',
  por_invitar:        'Invitados → Por invitar',
  esperando:          'Invitados → Esperando respuesta',
  confirmados:        'Invitados → Confirmados',
  no_asistiran:       'Invitados → No asistirán',
  nuevo_invitado:     'Formulario de invitado nuevo',
  importar_excel:     'Importar invitados desde Excel',
  mesas:              'Mapa de mesas',
  editor:             'Editor de la invitación',
  side_events:        'Side events',
  photo_wall:         'Photo Wall',
  save_the_date:      'Save the Date',
  dashboard:          'Inicio del evento (dashboard)',
  mis_invitaciones:   'Mis invitaciones',
  nuevo_evento:       'Crear un evento nuevo (checkout)',
}

const GUIA = `
GUÍA DE USO DE I ATTEND (fuente única para dudas de "cómo hago…" o "dónde está…"):
Los nombres entre comillas son los textos reales de la app. Si algo no está en esta guía, no lo inventes: di que no lo tienes claro y ofrece soporte.

INVITADOS (/dashboard/guests) — destino: invitados
- La pantalla tiene pasos arriba: "Seguimiento" (resumen), "Paso 1 · Por invitar", "Paso 2 · Esperando respuesta", "Paso 3 · Confirmados" y "Aparte · No asistirán". Siempre abre en Seguimiento. Destinos: por_invitar, esperando, confirmados, no_asistiran.
- Agregar un invitado: paso "Por invitar" → botón "Nuevo invitado" → "Individual". Se llena Nombre, Contacto (lada +52 por defecto), Etiqueta, Prioridad, Categoría, Lado y Notas; los acompañantes se suman con los botones +/− de "Acompañantes" (sus datos son opcionales). Se guarda con "Agregar". Destino: nuevo_invitado.
- Subir un Excel: paso "Por invitar" → "Nuevo invitado" → tarjeta "Arrastra tu Excel aquí". Acepta .xlsx y .xls; no hace falta plantilla, Lia acomoda las columnas. Luego "Revisar" (se puede corregir cada fila) → "Confirmar importación". Agrega invitados, no reemplaza la lista. La tarjeta de Excel es del plan PRO. Destino: importar_excel.
- Borrar invitados: solo uno por uno (abrir el invitado → "Eliminar"; si tiene acompañantes se borran con él). NO existe borrar toda la lista de golpe, y volver a importar el mismo Excel duplica a los invitados.
- Filtros: botón "Filtros" (Etiqueta, Mesa, Prioridad, Categoría, Lado). Filtros rápidos: "Sin entregar" en Esperando y "Sin mesa" en Confirmados.
- Menú "⋯" (Más herramientas): "Descargables" (descargar la lista en Excel), "Mapa de mesas", "Evento público / Evento privado" y "Lector de pases".
- Etiquetas: en el formulario del invitado, campo "Etiqueta" → "Nueva etiqueta". Prioridades: A "Tiene que estar sí o sí", B "Muy importante", C "Deseable", D "Opcional".

LINK DE LA INVITACIÓN Y CÓDIGO DEL INVITADO
- Cada invitado tiene un código (contraseña) de 6 caracteres que se crea solo. Está en su tarjeta, junto al nombre ("Copiar contraseña").
- El "link mágico" ("Copiar link mágico" / "Copiar link" en la tarjeta) ya trae el código y entra directo.
- Si alguien abre el link general de la invitación y el evento es privado, la página pide un código: es el código de ese invitado. "Código incorrecto" = ese código no es de ningún invitado.
- Un solo link general para todos, sin cargar invitados: Invitados → menú "⋯" → "Evento público" → "Continuar". Con el evento público el link general no pide código. (Sin invitados cargados no hay confirmaciones por invitado.)
- El link marca error (página no encontrada): el link está mal copiado o incompleto, o la invitación no se ha publicado. Publica desde el editor ("Publicar") y vuelve a copiar el link. Si sigue fallando, es caso de soporte.
- "Completa la información pendiente de tu invitación antes de compartir el link": faltan datos de la invitación (nombre, anfitriones, link o teléfono). Si no sabes cuál, es caso de soporte.

ENVIAR INVITACIONES POR WHATSAPP (plan PRO)
- Se envían una por una: paso "Por invitar" → botón "Enviar invitación" en la tarjeta del invitado. Cada envío cuesta 1 crédito. Si la invitación tiene otros idiomas, se elige en cuál se manda.
- Requisitos: número de México (+52; "Solo puedes hacer envíos nacionales"), créditos disponibles, portada con título y la información de la invitación completa.
- NO es posible hoy seleccionar varios invitados y enviarles en lote.
- NO es posible escribir un mensaje personalizado para el WhatsApp: se usa una plantilla fija aprobada por Meta con el título, la fecha, el nombre del invitado y el botón con su link.
- Sin WhatsApp: el botón ✓ "Marcar como invitado" lo pasa a "Esperando respuesta" sin enviar nada, y tú le mandas su link mágico por tu cuenta.
- Si un envío falló: en "Esperando respuesta" aparece "Reintentar" (no cobra crédito). Para mensajes que no llegan está "Problemas al enviar", que explica las restricciones de WhatsApp.
- Recordatorios: botón "Recordar" en "Esperando respuesta". Requiere haber definido la fecha límite, número +52, 1 crédito, y máximo uno al día por invitado. Solo para invitados a los que se les envió por la plataforma.
- Respuestas de los invitados: "Buzón de mensajes"; tienes 24 horas para contestar desde que el invitado escribió.
- Fecha límite para confirmar: aviso "Define la fecha límite para confirmar" → "Definir fecha", o "Cambiar" en la línea "Fecha límite para confirmar", dentro de Invitados.

MESAS — destino: mesas
- Se abren en un panel: Invitados → menú "⋯" → "Mapa de mesas" (o en Confirmados: "Asignar mesas" / "Ver acomodo"), o desde el dashboard en la tarjeta "Acomodo de mesas".
- La primera vez un asistente pregunta cuántas mesas tiene el salón y las crea.
- Dentro: "Mapa" o "Lista de mesas"; "Agregar" → "Nueva mesa" (redonda, cuadrada, rectangular) o "Elementos del salón" (pista de baile, entrada, baños, barra, DJ). Tocar una mesa permite cambiar nombre, forma, sillas y bloquearla; en la lista: "Renombrar", "Vaciar", "Eliminar mesa", "Transferir".
- Solo se puede sentar a invitados confirmados. No se pueden eliminar asientos ocupados.

EDITOR DE LA INVITACIÓN (/dashboard/build) — destino: editor
- Secciones: "Generales", "Portada", "Bienvenida", "Personas", "Cita", "Itinerario", "Dresscode", "Regalos", "Destinos", "Avisos" y "Galería". Cada sección se puede activar o desactivar ("Módulo activo").
- Los cambios se ven en la invitación pública hasta que presionas "Publicar".
- Tipos de letra: se eligen en "Generales" (uno para títulos y otro para el cuerpo) y aplican a toda la invitación. NO se puede poner una letra distinta en una sola sección (por ejemplo solo en Personas/padres) ni dos cuerpos con letras diferentes.
- Mensaje de bienvenida: sección "Bienvenida", campos "Título" y "Descripción". Sí se puede cambiar.
- Padres y personas importantes: sección "Personas" → "Nueva persona".
- Idiomas: en el editor, en computadora, botón de idiomas de la barra de herramientas → elegir el idioma. El primer idioma extra es gratis y los siguientes cuestan 100 créditos cada uno; se traduce solo. Un idioma agregado no se puede borrar, solo deshabilitar para los invitados; "Volver a traducir" rehace la traducción (y pierde los cambios manuales). Al enviar por WhatsApp se elige en qué idioma va.
- Datos del evento (link personalizado, tipo de evento, WhatsApp, nombres de los anfitriones): si falta alguno aparece "Información pendiente" en el encabezado para completarlo. No hay una pantalla única de "configuración del evento": la fecha y el título van en "Portada", los estilos en "Generales" y la fecha límite en Invitados.
- Pases totales: en el encabezado, "Pases" → "Editar pases". Solo ocupan pase los invitados con invitación enviada y los confirmados.

SIDE EVENTS (/dashboard/side) — destino: side_events
- Crear: "Nuevo side event" → "Abrir evento" → pestaña "Diseño" (Fondo, Color del tema, Título, Fecha y hora, Lugar, Notas) → "Guardar" (no se guarda solo).
- Quitar el clima: Diseño → "Lugar" → apagar "Mostrar el clima" → "Guardar". El clima solo aparece si la dirección tiene ciudad.
- Comentario o indicaciones extra: sección "Notas" (texto entre *asteriscos* sale en negritas). Si la página se queda en blanco al escribir, es caso de soporte.
- Invitados del side event: pestaña "Envío" → "Agregar" (copiar de la lista principal, uno por uno o Excel).
- Compartir: el ✓ lo marca como invitado y "Copiar link" da su link personal. NO es posible hoy mandar side events por WhatsApp desde la app.
- NO es posible borrar un side event, ni agregarle mesa de regalos.
- Límite: el plan incluye cierto número ("X de Y usados"); si el plan lo permite, "¿Más side events?" → "Comprar".

PHOTO WALL (/dashboard/photowall) — destino: photo_wall (plan PRO)
- Los invitados confirmados suben fotos desde su invitación (botón "Photo Wall"; máximo 10 por invitado) y aparecen en vivo en tu Photo Wall con el nombre y la hora. La cámara solo funciona el día del evento y el siguiente.
- Desde tu Photo Wall puedes buscar por nombre, "Descargar" o "Eliminar" cada foto (una por una). Las fotos se borran solas 30 días después.

LECTOR DE PASES (plan PRO)
- Invitados → menú "⋯" → "Lector de pases": muestra el usuario (nombre del evento), la contraseña y el link de acceso, más el botón "Acceder al lector". Quien escanea elige el evento, escribe la clave de 4 dígitos y escanea el pase digital (QR) de cada invitado; al escanearlo queda como asistente. Solo aparecen los confirmados.

SAVE THE DATE (/dashboard/savethedate) — destino: save_the_date
- Pestañas "Crear", "Respuestas" y "Compartir". "Copiar link" da el link público. El envío automático a tu lista es del plan PRO.

NUEVO EVENTO — destino: nuevo_evento
- En "Mis invitaciones" → "Nueva invitación" lleva a elegir plan y pagar el evento nuevo.

CRÉDITOS
- Cada invitación o recordatorio enviado por WhatsApp usa 1 crédito; agregar un idioma extra (después del primero) cuesta 100.
- Comprar: en computadora, botón "+" junto a tus créditos en el encabezado → elige un paquete → "Comprar" (pago con tarjeta en Stripe). En celular: botón flotante → "Mis créditos". Los créditos no se compran en la página de planes.
- Los créditos de Lia (sus respuestas) son aparte: 50 gratis al día; si se acaban, en el chat se canjean por créditos de I attend.
`.trim()

module.exports = { GUIA, DESTINOS }
