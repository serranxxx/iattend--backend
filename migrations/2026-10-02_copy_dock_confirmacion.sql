-- Textos del rediseño de la confirmación del plan Pro (iattend-events,
-- components/Invitation/InvitationDock). Correr en el SQL editor de Supabase.
--
-- Agrega la sección `dock` al bundle base de copy de la invitación. No hace
-- falta tocar copy_translations: getTranslatedCopy() (iattend-events,
-- lib/translation/copy-cache.ts) compara el source_hash del bundle y, al
-- cambiar, vuelve a traducir cada idioma con DeepL en su siguiente visita.
-- Los marcadores {name}, {n}, {total}, {i} y {time} se conservan
-- tal cual (DeepL ya respeta {max} en camera.maxPhotosReached).
--
-- Fuente de verdad: src/data/ui/invitation_ui_es.ts → dock. Si se cambia un
-- texto ahí, volver a correr este script con el JSON actualizado.

update public.copy_bundles
set json = json::jsonb || jsonb_build_object('dock', $dock${
  "confirm": "CONFIRMAR",
  "close": "Cerrar",
  "eyebrowConfirm": "Confirmar asistencia",
  "eyebrowEdit": "Editar respuesta",
  "eyebrowConfirmed": "Confirmado",
  "eyebrowTour": "Tus herramientas",
  "eyebrowDeclined": "Respuesta enviada",
  "hi": "Hola, {name}",
  "pass": "pase",
  "passes": "pases",
  "individual": "Tu invitación es individual.",
  "forYouAndOne": "Para ti y 1 acompañante.",
  "forYouAndMany": "Para ti y {n} acompañantes.",
  "whoAttends": "¿Quién asiste?",
  "countOf": "{n} de {total}",
  "youGoing": "Tú · Asiste",
  "youNotGoing": "Tú · No asistirá",
  "going": "Asiste",
  "notGoing": "No asistirá",
  "needsName": "Escribe su nombre para su pase",
  "companionPlaceholder": "Nombre del acompañante {n}",
  "missingOne": "Escribe el nombre de tu acompañante para generar su pase, o márcalo como \"no asistirá\".",
  "missingMany": "Escribe el nombre de tus {n} acompañantes para generar sus pases, o márcalos como \"no asistirá\".",
  "toastMissingOne": "Falta el nombre de 1 acompañante",
  "toastMissingMany": "Faltan {n} nombres",
  "ctaConfirmOne": "CONFIRMAR 1 ASISTENTE",
  "ctaConfirmMany": "CONFIRMAR {n} ASISTENTES",
  "ctaSend": "ENVIAR RESPUESTA",
  "ctaSave": "GUARDAR CAMBIOS",
  "declineAll": "Ninguno podrá asistir",
  "openHi": "¡Hola!",
  "openSub": "Agrega tu nombre y el de quienes te acompañan.",
  "openCountOne": "1 pase en tu confirmación",
  "openCountMany": "{n} pases en tu confirmación",
  "yourName": "Tu nombre",
  "companionName": "Nombre del acompañante",
  "addCompanion": "Agregar acompañante",
  "remove": "Quitar",
  "toastName": "Agrega tu nombre por favor",
  "toastUpdated": "Respuesta actualizada",
  "toastError": "No pudimos guardar tu respuesta. Intenta de nuevo.",
  "thanks": "¡Gracias por confirmar, {name}!",
  "thanksSub": "Estamos felices de poder contar con tu asistencia.",
  "confirmedOne": "1 pase confirmado",
  "confirmedMany": "{n} pases confirmados",
  "saveCalendar": "Guárdalo en tu calendario",
  "until": "hasta {time}",
  "hours2": "2 h",
  "allDay": "todo el día",
  "calNoteOne": "Se agregará 1 evento con su hora y dirección.",
  "calNoteMany": "Se agregarán {n} eventos con su hora y dirección.",
  "calNoteNone": "Selecciona al menos un momento.",
  "calDone": "Listo",
  "calNext": "{i} de {n}",
  "continue": "CONTINUAR",
  "tourTitle": "Tu invitación ahora es tu acceso al evento",
  "tourSub": "Encontrarás estas herramientas en la barra inferior.",
  "tourPassesOne": "Tu pase con código QR. Muéstralo en la entrada.",
  "tourPassesMany": "Tus {n} pases con código QR. Muéstralos en la entrada.",
  "tourPhotos": "Toma y comparte fotos en el Photo Wall durante la celebración.",
  "tourLia": "Pregúntale horarios, dresscode o cómo llegar.",
  "tourEdit": "¿Cambiaron tus planes? Actualiza quién asiste cuando quieras.",
  "tourNote": "Usa tu invitación el día del evento.",
  "gotIt": "ENTENDIDO",
  "declinedTitle": "Lamentamos no poder contar con tu asistencia",
  "declinedSub": "Gracias por avisarnos. Si tus planes cambian, puedes actualizar tu respuesta aquí mismo.",
  "changeAnswer": "Cambiar respuesta",
  "tabPasses": "Pases",
  "tabPhotos": "Fotos",
  "tabLia": "Lia",
  "tabEdit": "Editar",
  "passesTitle": "Tus pases",
  "passesSubOne": "1 pase",
  "passesSubMany": "{n} pases · desliza para verlos",
  "passLabel": "PASE {i} DE {n}",
  "passHint": "Muestra el código QR en la entrada el día del evento.",
  "liaTitle": "Lia",
  "liaSub": "Resuelve tus dudas del evento",
  "liaHello": "¡Hola, {name}! Soy Lia. Puedo ayudarte a resolver tus dudas sobre el evento.",
  "liaHelloAnon": "¡Hola! Soy Lia. Puedo ayudarte a resolver tus dudas sobre el evento.",
  "quickQuestion": "Pregunta rápida"
}$dock$::jsonb)
where slug = 'invitation_ui_v1';

-- Verificación: debe regresar 81.
select count(*) as dock_keys
from public.copy_bundles, jsonb_object_keys(json::jsonb -> 'dock')
where slug = 'invitation_ui_v1';
