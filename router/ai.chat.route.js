// routes/ai.chat.route.js
// ============================================================
// Fase 5 — Agente Luma con streaming + alertas proactivas
// ============================================================
console.log('>>> AI.CHAT.ROUTE CARGADO — versión con logs en executeTool')


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const toUuidSession = (session_id, fallback) =>
  (session_id && UUID_RE.test(session_id)) ? session_id : fallback

const express      = require('express')
const router       = express.Router()
const supabase = require('../config/supabase')
const { anthropic, AI_MODELS, calculateCost } = require('../config/ai.config')
const { orchestrate, classifyIntent, runGeminiLoop, runGPTLoop } = require('../models/ai.orchestrator')
const { runSonnetStreamLoop } = require('../models/sonnet.stream.loop')

// ------------------------------------------------------------
// SYSTEM PROMPT — Personalidad de Luma
// ------------------------------------------------------------

const buildSystemPrompt = (eventSummary) => {
  const event    = eventSummary?.event || {}
  const totals   = eventSummary?.totals || {}
  const tables   = eventSummary?.tables || {}
  const credits  = eventSummary?.ai_credits || {}

  const eventDate    = event.event_date
    ? new Date(event.event_date).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'fecha por definir'

  const daysToEvent  = event.event_date
    ? Math.ceil((new Date(event.event_date) - new Date()) / (1000 * 60 * 60 * 24))
    : null

  const daysDeadline = event.rsvp_deadline
    ? Math.ceil((new Date(event.rsvp_deadline) - new Date()) / (1000 * 60 * 60 * 24))
    : null

  return `
Eres Lia, la asistente personal de wedding planning integrada en I attend.
Eres como esa amiga que sabe de bodas — cálida, empática, directa y siempre con
una idea práctica lista. Hablas en español con un tono cercano pero profesional.
Nunca eres fría ni robótica. Usas el nombre de los invitados cuando los mencionas.
Cuando hay algo delicado (un familiar que no contestó, una mesa complicada),
lo abordas con tacto y ofreces palabras concretas que el organizador puede usar.

EVENTO ACTUAL:
- Nombre: ${event.name || 'Sin nombre'}
- Fecha: ${eventDate}${daysToEvent !== null ? ` (faltan ${daysToEvent} días)` : ''}
- Pareja: ${(event.owners || []).join(' & ')}
- Deadline de confirmación: ${event.rsvp_deadline || 'No definido'}${daysDeadline !== null ? ` (${daysDeadline > 0 ? `faltan ${daysDeadline} días` : '¡ya venció!'})` : ''}

ESTADO DE INVITADOS:
- Total: ${totals.total || 0}
- Confirmados: ${(totals.confirmado || 0) + (totals.asistente || 0)} (incluye tanto estado "confirmado" como "asistente")
- Esperando: ${totals.esperando || 0}
- Sin contactar: ${totals.creado || 0}
- Rechazados: ${totals.rechazado || 0}
- Con necesidades especiales: ${totals.con_special_needs || 0}

MESAS:
- Total mesas: ${tables.total_tables || 0}
- Capacidad total: ${tables.total_capacity || 0}
- Invitados sentados: ${tables.guests_seated || 0}

REGLAS IMPORTANTES:
- Cuando el usuario pida cambiar el estado de un invitado: 1) llama get_guests_by_status para encontrar al invitado, 2) inmediatamente llama update_guest_state con el ID real obtenido, 3) la tool crea automáticamente la acción pendiente, 4) en tu respuesta muestra el preview: "[Nombre] → [estado]. ¿Confirmas?". NO preguntes confirmación antes de llamar la tool — es segura porque requiere aprobación del frontend
- El campo pending_actions en la respuesta es lo que el usuario debe aprobar — siempre debe estar poblado cuando propones una acción
- Cuando el usuario pida buscar, filtrar o ver un invitado específico en la lista, usa ui_action con type "filter_guests" — NO necesitas consultar Supabase para esto
- Cuando pida ver todos los confirmados/esperando/etc en la lista, usa ui_action con type "filter_by_state"
- Cuando pida abrir el formulario para crear un invitado nuevo, usa ui_action con type "open_guest_form" con los datos que el usuario ya dio (nombre, etc.) en el payload.prefill
- Cuando pida ver el perfil de un invitado específico, primero busca su id con get_guests_by_status, luego usa ui_action con type "open_guest_detail"
- NUNCA preguntes confirmación sin haber llamado la tool primero
- Si no tienes datos suficientes, usa una herramienta para obtenerlos
- Responde siempre en español
- Sé concisa pero cálida — el organizador está ocupado y estresado
- Cuando propongas un mensaje para enviar a un invitado, redáctalo completo
- Nunca inventes datos — solo usa lo que obtienes de las herramientas
- Si detectas algo urgente (deadline vencido, VIPs sin respuesta), menciónalo con tacto
- El campo "tier" es interno — NUNCA lo menciones al usuario. En su lugar usa siempre "prioridad": tier A = Prioridad A, tier B = Prioridad B, tier C = Prioridad C, tier D = Prioridad D. Ejemplo correcto: "22 invitados de Prioridad A sin respuesta". Ejemplo incorrecto: "22 invitados tier A"
- El campo "side" identifica de qué lado de la pareja es cada invitado. Los valores válidos son exactamente los nombres en owners: ${(event.owners || []).join(' y ')}. Cuando el usuario mencione uno de esos nombres para referirse a un grupo, usa side con ese nombre exacto. Ejemplos: "los de Ale" → side: "Ale", "invitados de Santiago" → side: "Santiago"
- El campo "tag" identifica el grupo o relación del invitado: Trabajo, Familia, Amigos, etc. Cuando el usuario mencione un grupo que NO sea un nombre de la pareja, usa tag. Ejemplos: "los del trabajo" → tag: "Trabajo", "familia" → tag: "Familia"
- Cuando uses get_guests_by_status con tag, pasa el valor tal como el usuario lo dijo — la búsqueda es case-insensitive, "trabajo", "Trabajo" y "TRABAJO" funcionan igual.
- Para preguntas sobre niños usa get_guests_by_status con type: 'child'; para hombres type: 'male'; para mujeres type: 'female'
- Responde EXACTAMENTE lo que se pregunta — si piden hombres vs mujeres, solo da esos dos datos, no agregues niños ni otros tipos no solicitados
- Cuando pregunten por conteos de invitados sin especificar estado, incluye TODOS los estados a menos que explícitamente pidan solo confirmados
- Nunca agregues información extra no solicitada en la respuesta
- confirmado y asistente son estados equivalentes — ambos significan que el invitado viene al evento. Nunca los trates como estados diferentes al hablar con el usuario — si alguien pregunta por confirmados, incluye también los asistentes en el conteo.
- TERMINOLOGÍA DE ESTADOS — usa siempre el lenguaje amigable al hablar con el usuario, nunca los nombres internos:
  · creado     → "por invitar" o "lista de espera"
  · esperando  → "invitación enviada" o "esperando respuesta"
  · confirmado / asistente → "confirmado" o "asistencia confirmada"
  · rechazado  → "declinó" o "no asistirá"
  Ejemplos correctos: "15 invitados por invitar", "32 confirmados", "4 declinaron"
  Ejemplos incorrectos: "15 en estado creado", "4 rechazados"
- NUNCA uses un guest_id en una acción sin haberlo obtenido primero de una herramienta como get_guests_by_status
- El flujo correcto para acciones sobre invitados es: 1) llamar get_guests_by_status para encontrar al invitado por nombre, 2) verificar que el ID retornado es correcto, 3) solo entonces proponer la acción con ese ID real
- NUNCA inventes o asumas IDs de invitados
- Para conteos por tipo (hombres, mujeres, niños) SIEMPRE usa get_guests_by_status con el filtro type correspondiente — una llamada por tipo solicitado.

SIDE EVENTS:
- La boda puede tener side events: eventos secundarios como despedidas, tornaboda, pedida de mano, cenas, etc.
- Para consultas sobre side events usa get_side_events_summary primero para ver todos los eventos y sus IDs
- Luego usa get_side_event_guests con el ID del side event específico para ver sus invitados
- Los side events tienen invitados independientes de la lista principal de la boda — pueden ser personas diferentes
- En side events solo existen: nombre, etiqueta, estado y si se envió la invitación por WhatsApp — no hay mesas, tiers ni prioridades
- Terminología igual que en guests: creado → "por invitar", esperando → "invitación enviada", confirmado → "confirmado", rechazado → "declinó"
- Para cambiar el estado de un invitado de un side event usa update_side_event_guest_state — primero busca al invitado con get_side_event_guests para obtener su ID real
- Cuando el usuario pida "Resumen del evento" o un resumen general, llama get_side_events_summary además de get_event_summary. Si hay side events, agrégalos al final del resumen: "También tienes X eventos adicionales: [nombre1], [nombre2]…"

MESAS:
- Identifica mesas por "number" y "name" — nunca menciones "table_id" ni IDs internos. Formato al mostrar: Mesa #[number] — [name] (ejemplo: "Mesa #4 — Familia García")
- "mesa #4" → busca donde number = "4"; "mesa Familia García" → busca por nombre
- Sin mesa: usa SIEMPRE get_guests_without_table (nunca get_guests_by_status para esto)
- Ignora mesas con size = 0 — son elementos decorativos (pista de baile, etc.), no las menciones ni cuentes
- get_guests_by_status retorna table_number y table_name por invitado — usa SIEMPRE esos campos para mostrar la mesa, NUNCA el campo table (es el ID interno). Formato: "Mesa #[table_number] — [table_name]". Si table_number y table_name son null, el invitado no tiene mesa asignada
- Pista de baile: cuando el usuario pida una, créala sin preguntar nada con name="Pista de Baile", size=0, shape="dance", vertical=false
- CREACIÓN — los 3 datos son obligatorios: (1) nombre → (2) capacidad → (3) forma. Pregunta de a uno si faltan, en ese orden. La forma NUNCA se asume — pregunta aunque el nombre sugiera una. Formas válidas: "round", "square", "rectangle" (NUNCA uses "rectangular"). Si es rectangle → pregunta: "¿Vertical u horizontal?" (vertical=true, horizontal=false). En cuanto tengas los 3 datos, llama create_table INMEDIATAMENTE — NO uses frases como "Mesa X creada → ¿Confirmas?" en texto. La confirmación viene del botón en el frontend, no del chat. Si propones en texto sin llamar la tool, el usuario no puede aprobar. El único momento para no llamar create_table es cuando falta algún dato.
- Para eliminar una mesa usa delete_table — primero busca la mesa con get_tables_occupancy para obtener su número/nombre, luego propone la eliminación con confirmación
- Si la mesa tiene invitados asignados, la RPC retornará error — informa al usuario que debe mover los invitados primero
- Cuando pregunten por pases disponibles, tickets disponibles o cuántos lugares quedan, calcula así: pases_usados = confirmado + esperando + asistente; pases_disponibles = tickets - pases_usados. Usa los totals del get_event_summary. Muestra: "Tienes X pases disponibles de Y totales (Z usados)"
- Cuando pregunten por el itinerario o un momento específico, consulta get_event_details. NO incluyas dress code a menos que lo pidan explícitamente
- Estructura de cada momento del itinerario:
  · name    = nombre del evento (Ceremonia, Recepción, Misa...)
  · time    = hora de inicio
  · venue   = nombre del lugar (Templo de San Francisco de Asís, Jardines del Alba...) — SIEMPRE usa este nombre al referirte al lugar
  · address = { street, number, neighborhood, city, state, zip, url }
  · moments = sub-eventos dentro del mismo lugar, cada uno con name, time, description
- Al responder sobre un lugar usa siempre el formato: "[venue] — [street] [number], [neighborhood], [city]"
  Ejemplo: "Templo de San Francisco de Asís — Juan de Dios Martin Barba Antes 6112, Nombre de Dios, Chihuahua"
- Si hay moments con datos, menciónalos como sub-eventos:
  "En la Recepción (Jardines del Alba) habrá:\n· 7:00 pm — Cocktail hour\n· 8:00 pm — Boda civil"
- El campo zip (código postal) solo inclúyelo si el usuario lo pide explícitamente
- Si un campo de address está en null, omítelo de la respuesta sin mencionarlo
- El dress code solo se menciona cuando pregunten específicamente por él, la vestimenta o cómo ir vestidos
- Cuando el usuario pida "notificaciones", "novedades" o "qué ha pasado", usa get_notifications que trae todo en una sola llamada. Presenta la información en este orden: 1) Mensajes sin leer (más urgente), 2) Confirmaciones y cancelaciones de la boda, 3) Cambios en side events, 4) Quién vio pero no respondió. Si alguna sección está vacía, omítela sin mencionarla.
- SIEMPRE consulta una herramienta antes de responder — nunca respondas desde memoria si la pregunta involucra datos de invitados
- NUNCA inventes datos, nombres, números o cualquier información que no hayas obtenido explícitamente de una herramienta
- Si una herramienta no retorna un campo (como edad), NO lo menciones
- Si no tienes el dato, di exactamente: "No tengo ese dato registrado"
- Cuando listes invitados, usa SOLO los campos que vienen en la respuesta de la herramienta — nunca agregues campos extras

ESTILO DE RESPUESTA:
- Sé breve y directa — máximo 3-4 líneas por respuesta salvo cuando listes invitados
- No repitas datos que el usuario ya conoce
- Ve directo al punto — si encontraste lo que buscas, dilo
- Para proponer una acción usa formato corto: "[Nombre] → [acción]. ¿Confirmas?"
- Máximo un emoji por respuesta, solo si aporta
- LISTAS DE INVITADOS — formato obligatorio:
  · Siempre uno por línea, NUNCA separados por comas en la misma fila
  · Cuando agrupes por mesa usa este formato para TODOS los grupos (confirmados, esperando, sin contactar):
      Mesa #[number] — [name]
      · [Nombre invitado 1]
      · [Nombre invitado 2]
  · Los invitados sin mesa asignada se listan bajo:
      Sin mesa:
      · [Nombre 1]
  · NUNCA mezcles formatos en la misma respuesta — todos los grupos deben verse igual
  · Ejemplo correcto:
      ✅ Confirmados (3)
      Mesa #1 — Familia García
      · Juan García
      · María García
      Sin mesa:
      · Pedro Ruiz

      ⏳ Esperando (2)
      Mesa #1 — Familia García
      · Ana Torres
      Sin mesa:
      · Luis Mendoza
- Solo da recomendaciones si explícitamente te las piden
- NUNCA uses lenguaje que indique que una acción ya se ejecutó ("Listo ✓", "Ya confirmé", "Hecho") — usa siempre lenguaje de propuesta: "[Nombre] → [acción]. ¿Confirmas?"
- La acción NO se ejecuta hasta que el usuario apruebe en el frontend
- Puedes agregar información relevante no pedida SOLO si aporta valor inmediato a la situación actual — máximo 1 dato extra, no un resumen completo
- NUNCA menciones los créditos disponibles en ninguna respuesta — son información interna del sistema visible solo en el header del frontend, no en el chat
- El historial es solo para contexto — cada respuesta es independiente, no repitas lo que ya dijiste salvo que te lo pidan explícitamente
- Para expresar cuándo llegó un mensaje usa hours_ago: < 1 hora → "hace un momento", 1-23 horas → "hace X horas", 24-47 horas → "ayer", 48-71 horas → "hace 2 días", 72+ horas → "hace X días"
- NUNCA ofrezcas sugerencias, recomendaciones o próximos pasos a menos que el usuario los pida explícitamente
- NUNCA preguntes "¿Quieres que te sugiera...?" o "¿Te ayudo con...?"
- Responde exactamente lo que se preguntó y detente ahí — si el usuario quiere más, él preguntará

FUNCIONES EN DESARROLLO — FASE 2:
Las siguientes funcionalidades aún no están disponibles.
Si el usuario las solicita, responde exactamente:
"Esa función estará disponible muy pronto en la siguiente actualización de Lia. Por ahora puedo ayudarte con [alternativa]."

Acciones bloqueadas:
- Cambiar el estado de MÚLTIPLES invitados a la vez
  Ejemplos: "confirma a todos los del trabajo", "rechaza a todos los que llevan 30 días sin responder", "cambia el estado de estos 10 invitados"
  → Alternativa: "puedo cambiar el estado de uno a la vez"

- Asignar MÚLTIPLES invitados a una mesa a la vez
  Ejemplos: "sienta a toda la familia García en la mesa 3", "asigna a estos 8 en la misma mesa"
  → Alternativa: "puedo asignarlos uno por uno"

- Operaciones por filtro masivo
  Ejemplos: "mueve a todos los de Trabajo a la mesa 5", "confirma a todos los que vienen con Ale"
  → Alternativa: "puedo hacerlo uno por uno si me dices los nombres"

IMPORTANTE: Si la petición involucra UN solo invitado, procede normalmente — no está bloqueado.
`.trim()
}

// ------------------------------------------------------------
// TOOLS disponibles para Luma
// ------------------------------------------------------------

const LUMA_TOOLS = [
  {
    name: 'get_event_summary',
    description: 'Obtiene resumen completo del evento: conteos de invitados por estado, distribución por lado, mesas y créditos.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_guests_without_table',
    description: 'Obtiene invitados que vienen al evento (state confirmado o asistente) pero no tienen mesa asignada. Úsala cuando pregunten quién falta por sentar, quién confirmó sin mesa, o quién viene sin lugar asignado.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_event_details',
    description: 'Obtiene los detalles del evento: itinerario con horas y lugares, dress code, avisos, hoteles sugeridos, mesa de regalos y personas importantes del evento (padres, padrinos, etc.) guardadas en el campo people. Cada item del itinerario incluye un campo "address" con dirección detallada y/o URL de Google Maps. Úsala cuando pregunten por horarios, lugares, direcciones, links de Maps, vestimenta, hospedaje o personas relevantes del evento como papás o padrinos.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_guests_by_status',
    description: 'Lista de invitados filtrada. Usa "state" para filtrar por estado, "tier" para prioridad (A/B/C/D), "tag" para grupos como Trabajo, Familia, Amigos, etc., y "side" para el lado de la pareja (nombre de uno de los dos). Incluye días desde envío y recordatorios.',
    input_schema: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          enum: ['creado', 'esperando', 'confirmado', 'rechazado', 'asistente'],
          description: 'Filtrar por estado del invitado.',
        },
        tier: { type: 'string', description: 'Filtrar por prioridad: A, B, C o D.' },
        tag:  { type: 'string', description: 'Filtrar por etiqueta o grupo: Trabajo, Familia, Amigos, u otras etiquetas personalizadas.' },
        side: { type: 'string', description: 'Filtrar por lado de la pareja — usar el nombre exacto de uno de los dos.' },
        type: { type: 'string', enum: ['male', 'female', 'child', 'undefined'], description: 'Filtrar por tipo: child para niños, male para hombres, female para mujeres.' },
      },
      required: [],
    },
  },
  {
    name: 'get_whatsapp_history',
    description: 'Historial completo de WhatsApp de un invitado: mensajes enviados y respuestas recibidas.',
    input_schema: {
      type: 'object',
      properties: {
        guest_id: { type: 'number', description: 'ID del invitado' },
      },
      required: ['guest_id'],
    },
  },
  {
    name: 'get_tables_occupancy',
    description: 'Estado de todas las mesas: capacidad, ocupados, disponibles y quién está en cada una.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'update_guest_state',
    description: 'Propone cambiar el estado de un invitado. Siempre requiere confirmación del organizador antes de ejecutarse.',
    input_schema: {
      type: 'object',
      properties: {
        guest_id: { type: 'number', description: 'ID del invitado' },
        new_state: {
          type: 'string',
          enum: ['creado', 'esperando', 'confirmado', 'rechazado', 'asistente'],
        },
      },
      required: ['guest_id', 'new_state'],
    },
  },
  {
    name: 'get_latest_messages',
    description: 'Obtiene los mensajes de WhatsApp más recientes recibidos de invitados, leídos o no. Úsala cuando pregunten por el último mensaje, quién escribió último, o qué necesitaba alguien.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Número de mensajes a retornar. Default 5.' },
      },
      required: [],
    },
  },
  {
    name: 'get_unread_messages',
    description: 'Obtiene los mensajes de WhatsApp recibidos de invitados que aún no han sido leídos, ligados con el nombre del invitado. Úsala cuando pregunten por mensajes sin leer, respuestas nuevas o si alguien contestó.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_seen_not_replied',
    description: 'Obtiene la lista de invitados que ya vieron o recibieron su invitación de WhatsApp (status read o delivered) pero que aún no han confirmado ni rechazado. Úsala cuando pregunten quién vio la invitación pero no respondió.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_failed_dispatches',
    description: 'Consulta las invitaciones de WhatsApp que fallaron o no se pudieron entregar. Úsala cuando el usuario pregunte por invitaciones no entregadas, errores de envío o problemas de WhatsApp.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_table',
    description: 'Crea una nueva mesa. Para pistas de baile (shape: "dance"), usa siempre name="Pista de Baile", size=0, vertical=false — no preguntes nada al usuario. Para otros tipos de mesa, verifica que tienes nombre, capacidad y forma antes de llamar.',
    input_schema: {
      type: 'object',
      properties: {
        name:     { type: 'string',  description: 'Nombre de la mesa. Ej: "Familia García", "Mesa de honor"' },
        size:     { type: 'number',  description: 'Capacidad en número de personas' },
        shape:    { type: 'string',  enum: ['round', 'square', 'rectangle', 'dance'], description: 'Forma: round=redonda, square=cuadrada, rectangle=rectangular, dance=pista de baile' },
        vertical: { type: 'boolean', description: 'Solo para mesas rectangulares. true = orientación vertical, false = horizontal' },
        number:   { type: 'string',  description: 'Número de mesa. Si no se especifica se asigna automáticamente.' },
      },
      required: ['name', 'size', 'shape'],
    },
  },
  {
    name: 'update_event_date',
    description: 'Actualiza la fecha del evento. Úsala cuando el usuario quiera cambiar la fecha de la boda u otro evento. Requiere confirmación antes de ejecutar.',
    input_schema: {
      type: 'object',
      properties: {
        new_date: {
          type: 'string',
          description: 'Nueva fecha en formato ISO 8601. Ejemplo: "2026-10-15T18:00:00"',
        },
      },
      required: ['new_date'],
    },
  },
  {
    name: 'assign_guest_table',
    description: 'Propone asignar un invitado a una mesa. Valida disponibilidad. Requiere confirmación.',
    input_schema: {
      type: 'object',
      properties: {
        guest_id:     { type: 'number', description: 'ID del invitado' },
        table_number: { type: 'number', description: 'Número visible de la mesa (campo "number"). Úsalo cuando el usuario diga "mesa #4" → pasa 4. NO es el id interno.' },
        table_name:   { type: 'string', description: 'Nombre de la mesa (campo "name"). Úsalo cuando el usuario diga el nombre, ej: "mesa Prueba 1" → pasa "Prueba 1". Puedes pasar number o name, con uno basta.' },
      },
      required: ['guest_id'],
    },
  },
  {
    name: 'delete_table',
    description: 'Elimina una mesa del evento. Valida que no tenga invitados asignados antes de eliminar. Requiere confirmación. Úsala cuando el usuario pida eliminar o borrar una mesa.',
    input_schema: {
      type: 'object',
      properties: {
        table_number: { type: 'number', description: 'Número visible de la mesa. Úsalo cuando el usuario diga "mesa #4"' },
        table_name:   { type: 'string', description: 'Nombre de la mesa. Úsalo cuando el usuario diga el nombre' },
      },
      required: [],
    },
  },
  {
    name: 'get_side_events_summary',
    description: 'Lista todos los side events (eventos secundarios) de la boda: despedidas, tornaboda, pedida de mano, cenas, etc. Incluye nombre, fecha, lugar y conteo de invitados por estado. Úsala cuando pregunten por eventos adicionales, sub-eventos o eventos complementarios.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_side_event_guests',
    description: 'Lista los invitados de un side event específico. Filtra por estado o tag. Incluye nombre, etiqueta, estado y si se les envió la invitación por WhatsApp.',
    input_schema: {
      type: 'object',
      properties: {
        side_event_id: { type: 'number', description: 'ID del side event. Obtenerlo primero con get_side_events_summary.' },
        state:         { type: 'string', enum: ['creado', 'esperando', 'confirmado', 'rechazado'], description: 'Filtrar por estado. Omitir para traer todos.' },
        tag:           { type: 'string', description: 'Filtrar por etiqueta: Familia, Amigos, Trabajo, etc.' },
      },
      required: ['side_event_id'],
    },
  },
  {
    name: 'update_side_event_guest_state',
    description: 'Cambia el estado de un invitado de un side event. Requiere confirmación. Primero busca al invitado con get_side_event_guests para obtener su ID real.',
    input_schema: {
      type: 'object',
      properties: {
        guest_id:  { type: 'number', description: 'ID del invitado del side event' },
        new_state: { type: 'string', enum: ['creado', 'esperando', 'confirmado', 'rechazado'] },
      },
      required: ['guest_id', 'new_state'],
    },
  },
  {
    name: 'get_notifications',
    description: 'Obtiene un resumen de todas las novedades recientes: confirmaciones y cancelaciones de las últimas 24 horas (boda y side events), invitados que vieron la invitación pero no respondieron, y mensajes sin leer. Úsala cuando el usuario pida notificaciones, novedades, o qué ha pasado recientemente.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ui_action',
    description: 'Controla la interfaz del dashboard directamente. Úsala cuando el usuario pida ver, buscar, filtrar o abrir algo en la lista de invitados SIN necesitar datos de Supabase. No consume crédito adicional.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['filter_guests', 'filter_by_state', 'open_guest_form', 'open_guest_detail'],
          description: 'Tipo de acción en la UI',
        },
        payload: {
          type: 'object',
          description: 'Datos para ejecutar la acción',
          properties: {
            query:    { type: 'string',  description: 'Texto de búsqueda para filter_guests' },
            state:    { type: 'string',  description: 'Estado para filter_by_state' },
            guest_id: { type: 'number',  description: 'ID del invitado para open_guest_detail' },
            prefill:  { type: 'object',  description: 'Datos prellenados para open_guest_form' },
          },
        },
      },
      required: ['type', 'payload'],
    },
  },
]

// ------------------------------------------------------------
// EJECUTOR DE TOOLS
// ------------------------------------------------------------

const executeTool = async (toolName, toolInput, invitationId) => {
  try {
    let data, error

    switch (toolName) {
      case 'get_event_summary': {
        ;({ data, error } = await supabase.rpc('get_event_summary', { p_invitation_id: invitationId }))
        if (error) throw error
        return data
      }
      case 'get_guests_without_table': {
        ;({ data, error } = await supabase.rpc('get_guests_without_table', { p_invitation_id: invitationId }))
        if (error) throw error
        return data
      }
      case 'get_event_details': {
        ;({ data, error } = await supabase.rpc('get_event_details', { p_invitation_id: invitationId }))
        if (error) throw error
        return data
      }
      case 'get_guests_by_status': {
        ;({ data, error } = await supabase.rpc('get_guests_by_status', {
          p_invitation_id: invitationId,
          p_state: toolInput.state || null,
          p_tier:  toolInput.tier  || null,
          p_side:  toolInput.side  || null,
          p_tag:   toolInput.tag   || null,
          p_type:  toolInput.type  || null,
        }))
        if (error) throw error
        return data
      }
      case 'get_whatsapp_history': {
        ;({ data, error } = await supabase.rpc('get_whatsapp_history', { p_guest_id: toolInput.guest_id }))
        if (error) throw error
        return data
      }
      case 'get_latest_messages': {
        ;({ data, error } = await supabase.rpc('get_latest_messages', {
          p_invitation_id: invitationId,
          p_limit:         toolInput.limit || 5,
        }))
        if (error) throw error
        return data
      }
      case 'get_unread_messages': {
        ;({ data, error } = await supabase.rpc('get_unread_messages', { p_invitation_id: invitationId }))
        if (error) throw error
        return data
      }
      case 'get_seen_not_replied': {
        ;({ data, error } = await supabase.rpc('get_seen_not_replied', { p_invitation_id: invitationId }))
        if (error) throw error
        return data
      }
      case 'get_failed_dispatches': {
        ;({ data, error } = await supabase.rpc('get_failed_dispatches', { p_invitation_id: invitationId }))
        if (error) throw error
        return data
      }
      case 'get_tables_occupancy': {
        ;({ data, error } = await supabase.rpc('get_tables_occupancy', { p_invitation_id: String(invitationId) }))
        if (error) {
          console.error(`[tool:${toolName}] RPC error →`, error)
          throw error
        }
        return data
      }
      case 'create_table': {
        const shapeLabels = { round: 'redonda', square: 'cuadrada', rectangle: 'rectangular', dance: 'pista de baile' }
        const orientationLabel = toolInput.shape === 'rectangle'
          ? `, ${toolInput.vertical ? 'vertical' : 'horizontal'}`
          : ''
        return {
          requires_confirmation: true,
          action_type:  'create_table',
          payload:      toolInput,
          preview_text: `Crear mesa "${toolInput.name}" — ${toolInput.size} personas, ${shapeLabels[toolInput.shape] || toolInput.shape}${orientationLabel}`,
        }
      }
      case 'update_event_date': {
        return {
          requires_confirmation: true,
          action_type:  'update_event_date',
          payload:      { new_date: toolInput.new_date },
          preview_text: `Cambiar fecha del evento a ${new Date(toolInput.new_date).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}`,
        }
      }
      case 'update_guest_state': {
        const { data: guestData } = await supabase
          .from('guests')
          .select('name')
          .eq('id', toolInput.guest_id)
          .single()

        const guestName = guestData?.name || `Invitado #${toolInput.guest_id}`

        return {
          requires_confirmation: true,
          action_type:  'update_guest_state',
          payload:      toolInput,
          preview_text: `Cambiar estado de ${guestName} a "${toolInput.new_state}"`,
        }
      }
      case 'assign_guest_table': {
        // Resolver number o name → id real de la mesa
        if (!toolInput.table_number && !toolInput.table_name) {
          return { error: 'Necesito el número o el nombre de la mesa para asignar al invitado.' }
        }

        let query = supabase.from('tables').select('id, number, name').eq('invitation_id', invitationId)

        if (toolInput.table_number != null) {
          query = query.eq('number', toolInput.table_number)
        } else {
          query = query.ilike('name', toolInput.table_name.trim())
        }

        const { data: tableRow, error: tableError } = await query.single()

        if (tableError || !tableRow) {
          const ref = toolInput.table_number != null ? `número ${toolInput.table_number}` : `nombre "${toolInput.table_name}"`
          return { error: `No encontré una mesa con ${ref} en este evento.` }
        }

        const { data: guestForPreview } = await supabase
          .from('guests')
          .select('name')
          .eq('id', toolInput.guest_id)
          .single()

        const guestNameForPreview = guestForPreview?.name || `Invitado #${toolInput.guest_id}`

        return {
          requires_confirmation: true,
          action_type:  'assign_guest_table',
          payload:      { guest_id: toolInput.guest_id, table_id: tableRow.id },
          preview_text: `Asignar a ${guestNameForPreview} → Mesa #${tableRow.number}${tableRow.name ? ` — ${tableRow.name}` : ''}`,
        }
      }
      case 'ui_action': {
        return {
          requires_ui_action: true,
          ui_action: {
            type:    toolInput.type,
            payload: toolInput.payload,
          },
        }
      }
      case 'delete_table': {
        if (!toolInput.table_number && !toolInput.table_name) {
          return { error: 'Necesito el número o nombre de la mesa a eliminar.' }
        }

        let query = supabase.from('tables').select('id, number, name').eq('invitation_id', invitationId)
        if (toolInput.table_number != null) {
          query = query.eq('number', String(toolInput.table_number))
        } else {
          query = query.ilike('name', toolInput.table_name.trim())
        }

        const { data: tableRow, error: tableError } = await query.single()
        if (tableError || !tableRow) {
          const ref = toolInput.table_number != null
            ? `número ${toolInput.table_number}`
            : `nombre "${toolInput.table_name}"`
          return { error: `No encontré una mesa con ${ref}.` }
        }

        return {
          requires_confirmation: true,
          action_type:  'delete_table',
          payload:      { table_id: tableRow.id },
          preview_text: `Eliminar Mesa #${tableRow.number}${tableRow.name ? ` — ${tableRow.name}` : ''}`,
        }
      }
      case 'get_notifications': {
        const [
          { data: recentChanges },
          { data: seenNotReplied },
          { data: unreadMessages },
          { data: sideEvents },
        ] = await Promise.all([
          supabase.rpc('get_recent_state_changes', { p_invitation_id: invitationId }),
          supabase.rpc('get_seen_not_replied',      { p_invitation_id: invitationId }),
          supabase.rpc('get_unread_messages',       { p_invitation_id: invitationId }),
          supabase.rpc('get_side_events_summary',   { p_invitation_id: invitationId }),
        ])

        const sideEventChanges = await Promise.all(
          (sideEvents || []).map(async (se) => {
            const { data: guests } = await supabase
              .from('side_events_guests')
              .select('name, state, last_update_date')
              .eq('side_events_id', se.id)
              .gte('last_update_date', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
              .in('state', ['confirmado', 'rechazado'])

            return {
              event_name: se.name,
              changes:    guests || [],
            }
          })
        )

        return {
          boda: {
            confirmados_recientes:   recentChanges?.confirmed || [],
            cancelaciones_recientes: recentChanges?.declined  || [],
          },
          vieron_sin_responder: seenNotReplied?.guests    || [],
          mensajes_sin_leer:    unreadMessages?.messages  || [],
          side_events:          sideEventChanges.filter(se => se.changes.length > 0),
        }
      }
      case 'get_side_events_summary': {
        ;({ data, error } = await supabase.rpc('get_side_events_summary', { p_invitation_id: invitationId }))
        if (error) throw error
        return data
      }
      case 'get_side_event_guests': {
        ;({ data, error } = await supabase.rpc('get_side_event_guests', {
          p_side_event_id: toolInput.side_event_id,
          p_state:         toolInput.state || null,
          p_tag:           toolInput.tag   || null,
        }))
        if (error) throw error
        return data
      }
      case 'update_side_event_guest_state': {
        const { data: guestData } = await supabase
          .from('side_events_guests')
          .select('name')
          .eq('id', toolInput.guest_id)
          .single()
        const guestName = guestData?.name || `Invitado #${toolInput.guest_id}`
        return {
          requires_confirmation: true,
          action_type:  'update_side_event_guest_state',
          payload:      toolInput,
          preview_text: `Cambiar estado de ${guestName} a "${toolInput.new_state}" en el side event`,
        }
      }
      default:
        return { error: `Herramienta desconocida: ${toolName}` }
    }
  } catch (err) {
    console.error(`[tool:${toolName}] EXCEPTION →`, err.message, err)
    return { error: err.message }
  }
}

// ------------------------------------------------------------
// DETECCIÓN DE ACCIONES EN MASA
// ------------------------------------------------------------

const BULK_PATTERNS = [
  /\b(\d+)\s*(mesas?|invitados?|personas?)\b/i,
  /\btodos\s*(los|las)\b/i,
  /\bcada\s+una\b/i,
  /\bgrupo\s+completo\b/i,
  /\btoda\s+la\s+(familia|lista|mesa)\b/i,
]

const BULK_BLOCKED_MSG = 'Las acciones en grupo estarán disponibles muy pronto en la siguiente actualización de Lia. Por ahora puedo ayudarte de una en una — ¿quieres que empecemos?'

const isBulkAction = (message, intent) => {
  if (intent !== 'ACCION') return false
  return BULK_PATTERNS.some(pattern => pattern.test(message))
}

// ------------------------------------------------------------
// SALUDO ENRIQUECIDO — construye greeting con datos en paralelo
// ------------------------------------------------------------

const buildGreeting = async (invitation_id) => {
  const [
    { data: eventSummary },
    { data: unreadMessages },
    { data: recentChanges },
    { data: seenNotReplied },
    { data: dailyUsage },
  ] = await Promise.all([
    supabase.rpc('get_event_summary',       { p_invitation_id: invitation_id }),
    supabase.rpc('get_unread_messages',      { p_invitation_id: invitation_id }),
    supabase.rpc('get_recent_state_changes', { p_invitation_id: invitation_id }),
    supabase.rpc('get_seen_not_replied',     { p_invitation_id: invitation_id }),
    supabase.rpc('get_or_create_daily_usage', { p_invitation_id: invitation_id }),
  ])

  const event   = eventSummary?.event || {}

  const ownerNames = (event.owners || []).filter(Boolean).join(' y ')

  const daysToEvent = event.event_date
    ? Math.ceil((new Date(event.event_date) - new Date()) / (1000 * 60 * 60 * 24))
    : null

  // Time-based greeting (Mexico City timezone)
  const nowMX = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
  const hour  = nowMX.getHours()

  const morningOptions   = ['¡Buenos días!', 'Buen día ☀️', '¡Buenos días, aquí estoy!']
  const afternoonOptions = ['¡Buenas tardes!', 'Buenas tardes ✨', '¡Hola! Buenas tardes']
  const eveningOptions   = ['¡Buenas noches!', 'Buenas noches 🌙', '¡Hola! Buenas noches']

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

  const timeGreeting = hour < 12
    ? pick(morningOptions)
    : hour < 19
    ? pick(afternoonOptions)
    : pick(eveningOptions)

  // greeting_text — solo el saludo personal, sin datos
  const greetingText = ownerNames
    ? `¡Hola ${ownerNames}! ${timeGreeting} 👋`
    : `¡Hola! ${timeGreeting} 👋`

  // summary — los datos del evento como bullets
  let summary = ''

  if (daysToEvent !== null) {
    if (daysToEvent > 30) {
      summary += `📅 Faltan **${daysToEvent} días** para la boda.\n`
    } else if (daysToEvent > 7) {
      summary += `📅 ¡Ya están muy cerca! Faltan **${daysToEvent} días**.\n`
    } else if (daysToEvent > 1) {
      summary += `🎊 ¡La boda es en **${daysToEvent} días**!\n`
    } else if (daysToEvent === 1) {
      summary += `🎊 ¡**Mañana es el gran día**!\n`
    } else {
      summary += `🎊 ¡**Hoy es el gran día**!\n`
    }
  }

  const totalUnread = unreadMessages?.total_unread || 0
  if (totalUnread > 0) {
    const uniqueNames = [...new Set(
      (unreadMessages?.messages || [])
        .map(m => m.guest?.name || m.contact_name)
        .filter(Boolean)
    )].slice(0, 3)
    const namesStr = uniqueNames.join(', ')
    const extra = totalUnread > uniqueNames.length ? ` (${totalUnread} en total)` : ''
    summary += `📬 **${totalUnread} mensaje${totalUnread > 1 ? 's' : ''} sin leer** de ${namesStr}${extra}.\n`
  } else {
    summary += `📬 Sin mensajes nuevos.\n`
  }

  const recentConfirmed = recentChanges?.confirmed || []
  const recentDeclined  = recentChanges?.declined  || []

  if (recentConfirmed.length > 0) {
    const names = recentConfirmed.slice(0, 3).map(g => g.name).join(', ')
    const extra = recentConfirmed.length > 3 ? ` y ${recentConfirmed.length - 3} más` : ''
    summary += `✅ **${recentConfirmed.length} confirmaron**: ${names}${extra}.\n`
  }

  if (recentDeclined.length > 0) {
    const names = recentDeclined.slice(0, 2).map(g => g.name).join(', ')
    const extra = recentDeclined.length > 2 ? ` y ${recentDeclined.length - 2} más` : ''
    summary += `❌ **${recentDeclined.length} cancelaron**: ${names}${extra}.\n`
  }

  if (recentConfirmed.length === 0 && recentDeclined.length === 0) {
    summary += `📋 Sin cambios de confirmación en las últimas 24 horas.\n`
  }

  const seenTotal = seenNotReplied?.total || 0
  if (seenTotal > 0) {
    const verb = seenTotal === 1 ? 'vio' : 'vieron'
    summary += `👀 **${seenTotal} ${seenTotal === 1 ? 'invitado' : 'invitados'} ${verb}** la invitación pero no ${seenTotal > 1 ? 'han respondido' : 'ha respondido'}.\n`
  }

  return {
    greeting_text:     greetingText,
    summary:           summary.trim(),
    eventSummary,
    credits_remaining: dailyUsage?.total_available || 0,
    alerts: [],
  }
}

// ------------------------------------------------------------
// POST /api/ai/greeting
// Saludo proactivo al abrir el chat — no consume crédito
// ------------------------------------------------------------

router.post('/greeting', async (req, res) => {
  const { invitation_id } = req.body

  if (!invitation_id) {
    return res.status(400).json({ success: false, error: 'invitation_id requerido' })
  }

  try {
    const { greeting_text, summary, eventSummary, credits_remaining, alerts } = await buildGreeting(invitation_id)

    res.json({
      success:           true,
      greeting_text,
      summary,
      alerts,
      credits_remaining,
      event_summary:     eventSummary,
    })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// ------------------------------------------------------------
// POST /api/ai/chat — con streaming SSE
// ------------------------------------------------------------

router.post('/chat', async (req, res) => {
  const { invitation_id, message, session_id, stream = true, conversation_history } = req.body

  if (!invitation_id || !message) {
    return res.status(400).json({ success: false, error: 'invitation_id y message son requeridos' })
  }

  // 1. Verificar que hay créditos disponibles (sin descontar aún)
  const { data: statusData } = await supabase
    .rpc('get_lia_credits_status', { p_invitation_id: invitation_id })

  if (!statusData || statusData.total_available <= 0) {
    return res.status(402).json({
      success:   false,
      code:      'NO_CREDITS',
      error:     'Alcanzaste tu límite diario de Lia. Se renueva a medianoche.',
      resets_at: statusData?.resets_at,
    })
  }

  try {
    // 2. Historial enviado por el frontend (últimos 6 registros)
    const historyMessages = (conversation_history || [])
      .slice(-6)
      .map((m) => ({ role: m.role, content: String(m.content) }))

    // 3. Obtener contexto del evento
    const { data: eventSummary } = await supabase
      .rpc('get_event_summary', { p_invitation_id: invitation_id })

    // Detectar qué está esperando Luma en base al último mensaje del assistant
    const lastAssistantMsg = historyMessages
      .filter((m) => m.role === 'assistant')
      .at(-1)?.content || ''

    const waitingForTableName    = lastAssistantMsg.includes('llamar a esta mesa')
    const waitingForTableShape   = lastAssistantMsg.includes('forma')
    const waitingForTableSize    = lastAssistantMsg.includes('cuántas personas') || lastAssistantMsg.includes('para cuántas')
    const waitingForOrientation  = lastAssistantMsg.includes('vertical') && lastAssistantMsg.includes('horizontal')
    const waitingConfirmation    = lastAssistantMsg.includes('¿Confirmas') || lastAssistantMsg.includes('¿confirmas')

    const userConfirming = /^(s[ií]|confirmo?|confirmas?|ok|dale|listo|adelante|hazlo)$/i.test(message.trim())

    let actionContext = ''

    if (waitingForTableName) {
      actionContext = `
CONTEXTO CRÍTICO: Estás en medio de crear una mesa.
Acabas de preguntar "¿Cómo quieres llamar a esta mesa?"
El usuario acaba de responder: "${message}"
ESO ES EL NOMBRE DE LA MESA — no lo interpretes como otra cosa.
Ahora pregunta la forma: "¿Qué forma tendrá? Redonda, cuadrada o rectangular"
NO busques invitados, NO hagas otra consulta, NO cambies de tema.
`
    } else if (waitingForTableShape) {
      const userMsgs = historyMessages
        .filter(m => m.role === 'user')
        .map(m => m.content)
      actionContext = `
CONTEXTO CRÍTICO: El usuario acaba de especificar la forma: "${message}"
Mensajes previos del usuario en esta acción: ${JSON.stringify(userMsgs)}

Ya tienes los 3 datos obligatorios. LLAMA INMEDIATAMENTE create_table
con los datos extraídos del historial — NO preguntes nada más ni
propongas en texto. La tool genera la pending_action automáticamente.

Si la forma es "rectangle" y no tienes orientación, entonces sí
pregunta: "¿Vertical u horizontal?"
`
    } else if (waitingForTableSize) {
      actionContext = `
CONTEXTO CRÍTICO: Estás en medio de crear una mesa.
El usuario acaba de especificar la capacidad: "${message}"
Continúa con el flujo de creación de mesa.
`
    } else if (waitingForOrientation) {
      const userMsgs = historyMessages
        .filter(m => m.role === 'user')
        .map(m => m.content)
      actionContext = `
CONTEXTO CRÍTICO: Estás completando la creación de una mesa rectangular.
La orientación especificada es: "${message}"
Mensajes previos del usuario en esta acción: ${JSON.stringify(userMsgs)}
Extrae nombre, capacidad y orientación de esos mensajes y llama
create_table inmediatamente con todos los datos.
`
    } else if (waitingConfirmation && userConfirming) {
      actionContext = `
CONTEXTO CRÍTICO: El usuario acaba de confirmar la acción que propusiste.
Debes llamar INMEDIATAMENTE la tool correspondiente (create_table,
update_guest_state, assign_guest_table, etc.) con los datos que
ya recolectaste en esta conversación.
NO preguntes nada más — ejecuta la tool ahora.
`
    }

    const systemPrompt = buildSystemPrompt(eventSummary) + (actionContext ? '\n' + actionContext : '')
    const currentMessages = [
      ...historyMessages,
      { role: 'user', content: message },
    ]

    const cachedSystem = [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
    const toolsWithCache = LUMA_TOOLS.map((tool, i) =>
      i === LUMA_TOOLS.length - 1 ? { ...tool, cache_control: { type: 'ephemeral' } } : tool
    )

    // ---- STREAMING ----
    if (stream) {
      res.setHeader('Content-Type',                'text/event-stream')
      res.setHeader('Cache-Control',               'no-cache')
      res.setHeader('Connection',                  'keep-alive')
      res.setHeader('Access-Control-Allow-Origin', '*')

      let   fullContent    = ''
      let   totalTokensIn  = 0
      let   totalTokensOut = 0
      const toolsCalled    = []
      const pendingActions = []
      const uiActions      = []

      try {
        // 1. Clasificar intent (no consume crédito, falla silenciosamente)
        const intent = await classifyIntent(message, historyMessages)
        console.log(`[chat/stream] intent: ${intent}`)
        res.write(`data: ${JSON.stringify({ type: 'intent', intent })}\n\n`)

        if (isBulkAction(message, intent)) {
          const currentSessionId = toUuidSession(session_id, invitation_id)
          await supabase.from('ai_conversations').insert([
            { invitation_id, session_id: currentSessionId, role: 'user',      content: message },
            { invitation_id, session_id: currentSessionId, role: 'assistant', content: BULK_BLOCKED_MSG, model_used: 'blocked' },
          ])
          for (const word of BULK_BLOCKED_MSG.split(' ')) {
            res.write(`data: ${JSON.stringify({ type: 'text', text: word + ' ' })}\n\n`)
          }
          res.write(`data: ${JSON.stringify({ type: 'done', pending_actions: [], tools_called: [], credits_remaining: statusData?.total_available || 0, message_id: null })}\n\n`)
          res.end()
          return
        }

        // Wrapper de executeTool que emite eventos SSE, trackea toolsCalled y captura uiActions
        // pendingActions son retornadas por cada loop y mergeadas abajo
        const executeToolWithTracking = async (toolName, toolInput, invId) => {
          res.write(`data: ${JSON.stringify({ type: 'tool_start', tool: toolName })}\n\n`)
          const toolResult = await executeTool(toolName, toolInput, invId)
          toolsCalled.push(toolName)
          if (toolResult?.requires_ui_action) uiActions.push(toolResult.ui_action)
          res.write(`data: ${JSON.stringify({ type: 'tool_end', tool: toolName })}\n\n`)
          return toolResult
        }

        // 2. Ejecutar el loop del modelo correspondiente
        // El streaming palabra por palabra solo aplica a Sonnet
        // Para Gemini y GPT simulamos streaming con la respuesta completa
        let result

        try {
          if (intent === 'CONSULTA_SIMPLE') {
            result = await runGeminiLoop(systemPrompt, currentMessages, LUMA_TOOLS, executeToolWithTracking, invitation_id)
          } else if (intent === 'ACCION') {
            result = await runGPTLoop(systemPrompt, currentMessages, LUMA_TOOLS, executeToolWithTracking, invitation_id)
          } else {
            result = await runSonnetStreamLoop(systemPrompt, currentMessages, LUMA_TOOLS, executeToolWithTracking, invitation_id, res)
          }
        } catch (err) {
          console.error(`[chat/stream] ${intent} falló, escalando a Sonnet:`, err.message)
          result = await runSonnetStreamLoop(systemPrompt, currentMessages, LUMA_TOOLS, executeToolWithTracking, invitation_id, res)
        }

        fullContent    = result.content
        totalTokensIn  = result.tokensIn
        totalTokensOut = result.tokensOut
        if (result.pendingActions?.length) pendingActions.push(...result.pendingActions)

        // Para Gemini y GPT — simular streaming del texto
        if (result.modelId !== AI_MODELS.SONNET && fullContent) {
          const words = fullContent.split(' ')
          for (const word of words) {
            res.write(`data: ${JSON.stringify({ type: 'text', text: word + ' ' })}\n\n`)
          }
        }

      } catch (err) {
        console.error('[chat/stream] error fatal:', err.message)
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`)
        res.end()
        return
      }

      // Guardar conversación
      const currentSessionId = toUuidSession(session_id, invitation_id)
      const { data: insertedConv, error: insertError } = await supabase
        .from('ai_conversations')
        .insert([
          { invitation_id, session_id: currentSessionId, role: 'user',      content: message,      model_used: AI_MODELS.SONNET },
          { invitation_id, session_id: currentSessionId, role: 'assistant', content: fullContent,   model_used: AI_MODELS.SONNET, tokens_in: totalTokensIn, tokens_out: totalTokensOut },
        ])
        .select()
      if (insertError) console.error('Error guardando conversación:', insertError.message)

      const assistantMessageId = insertedConv?.find(r => r.role === 'assistant')?.id

      // Guardar acciones pendientes
      let savedActions = []
      if (pendingActions.length > 0) {
        const { data: insertedActions } = await supabase
          .from('ai_pending_actions')
          .insert(pendingActions.map(a => ({
            invitation_id,
            action_type:  a.action_type,
            payload:      a.payload,
            preview_text: a.preview_text,
            status:       'pending',
          })))
          .select('id, action_type, preview_text, payload')
        savedActions = insertedActions || []
      }

      // Log
      const costUsd = calculateCost(AI_MODELS.SONNET, totalTokensIn, totalTokensOut)
      await supabase.rpc('log_ai_interaction', {
        p_invitation_id: invitation_id,
        p_model:         AI_MODELS.SONNET,
        p_tokens_in:     totalTokensIn,
        p_tokens_out:    totalTokensOut,
        p_cost_usd:      costUsd,
        p_tool_called:   toolsCalled.join(',') || null,
        p_success:       true,
      })

      // Descontar créditos con el costo real del prompt
      const { data: creditData } = await supabase
        .rpc('consume_lia_credits', { p_invitation_id: invitation_id, p_cost_usd: costUsd })
      if (!creditData?.success) console.warn('[credits] Se agotaron créditos durante el prompt')

      res.write(`data: ${JSON.stringify({
        type:              'done',
        pending_actions:   savedActions,
        ui_actions:        uiActions,
        tools_called:      toolsCalled,
        credits_remaining: creditData?.total_available || 0,
        pct_free_used:     creditData?.pct_free_used   || 0,
        paid_balance:      creditData?.paid_balance     || 0,
        message_id:        assistantMessageId,
      })}\n\n`)

      res.end()
      return
    }

    // ---- SIN STREAMING (fallback) ----
    if (isBulkAction(message, 'ACCION')) {
      const currentSessionId = toUuidSession(session_id, invitation_id)
      await supabase.from('ai_conversations').insert([
        { invitation_id, session_id: currentSessionId, role: 'user',      content: message },
        { invitation_id, session_id: currentSessionId, role: 'assistant', content: BULK_BLOCKED_MSG, model_used: 'blocked' },
      ])
      return res.json({ success: true, message: BULK_BLOCKED_MSG, blocked: true })
    }

    const result = await orchestrate({
      invitationId: invitation_id,
      userMessage:  message,
      history:      historyMessages,
      systemPrompt,
      tools:        LUMA_TOOLS,
      executeTool,
    })

    const currentSessionId = toUuidSession(session_id, invitation_id)
    console.log('INSERT ai_conversations:', { invitation_id, session_id: currentSessionId, content_length: result.content?.length })
    const { data: insertedConv, error: convError } = await supabase
      .from('ai_conversations')
      .insert([
        { invitation_id, session_id: currentSessionId, role: 'user',      content: message },
        { invitation_id, session_id: currentSessionId, role: 'assistant', content: result.content, model_used: result.modelUsed, tokens_in: result.tokensIn, tokens_out: result.tokensOut },
      ])
      .select()
    if (convError) {
      console.error('ERROR INSERT ai_conversations:', convError)
    } else {
      console.log('ai_conversations OK — filas:', insertedConv?.length)
    }

    let savedActions = []
    if (result.pendingActions.length > 0) {
      const { data: insertedActions } = await supabase
        .from('ai_pending_actions')
        .insert(result.pendingActions.map((a) => ({
          invitation_id,
          action_type:  a.action_type,
          payload:      a.payload,
          preview_text: a.preview_text,
          status:       'pending',
        })))
        .select('id, action_type, preview_text, payload')
      savedActions = insertedActions || []
    }

    await supabase.rpc('log_ai_interaction', {
      p_invitation_id: invitation_id,
      p_model:         result.modelUsed,
      p_tokens_in:     result.tokensIn,
      p_tokens_out:    result.tokensOut,
      p_cost_usd:      result.costUsd,
      p_tool_called:   result.toolsCalled.join(',') || null,
      p_success:       true,
    })

    // Descontar créditos con el costo real del prompt
    const { data: creditData } = await supabase
      .rpc('consume_lia_credits', { p_invitation_id: invitation_id, p_cost_usd: result.costUsd })
    if (!creditData?.success) console.warn('[credits] Se agotaron créditos durante el prompt')

    const assistantMessageId = insertedConv?.find(r => r.role === 'assistant')?.id

    res.json({
      success:           true,
      message:           result.content,
      model_used:        result.modelUsed,
      credits_remaining: creditData?.total_available || 0,
      pct_free_used:     creditData?.pct_free_used   || 0,
      paid_balance:      creditData?.paid_balance     || 0,
      pending_actions:   savedActions,
      tools_called:      result.toolsCalled,
      message_id:        assistantMessageId,
    })

  } catch (err) {
    console.error('Error en ai.chat:', err)

    await supabase.rpc('log_ai_interaction', {
      p_invitation_id: invitation_id,
      p_model:         'unknown',
      p_tokens_in:     0,
      p_tokens_out:    0,
      p_cost_usd:      0,
      p_success:       false,
      p_error_message: err.message,
    })

    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message })
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`)
      res.end()
    }
  }
})

// ------------------------------------------------------------
// POST /api/ai/chat/approve — Aprobar acción pendiente
// ------------------------------------------------------------

router.post('/chat/approve', async (req, res) => {
  const { action_id, invitation_id } = req.body

  if (!action_id || !invitation_id) {
    return res.status(400).json({ success: false, error: 'action_id e invitation_id son requeridos' })
  }

  try {
    const { data: action, error } = await supabase
      .from('ai_pending_actions')
      .select('*')
      .eq('id', action_id)
      .eq('invitation_id', invitation_id)
      .eq('status', 'pending')
      .single()

    if (error || !action) {
      return res.status(404).json({ success: false, error: 'Acción no encontrada o ya procesada' })
    }

    let executeResult

    switch (action.action_type) {
      case 'update_guest_state': {
        const { data, error: rpcError } = await supabase.rpc('update_guest_state', {
          p_guest_id:  action.payload.guest_id,
          p_new_state: action.payload.new_state,
          p_actor:     'system',
        })
        if (rpcError) throw rpcError
        executeResult = data
        break
      }
      case 'assign_guest_table': {
        const { data, error: rpcError } = await supabase.rpc('assign_guest_table', {
          p_guest_id: action.payload.guest_id,
          p_table_id: action.payload.table_id,
        })
        if (rpcError) throw rpcError
        executeResult = data
        break
      }
      case 'update_event_date': {
        const { data, error: rpcError } = await supabase.rpc('update_event_date', {
          p_invitation_id: invitation_id,
          p_new_date:      action.payload.new_date,
        })
        if (rpcError) throw rpcError
        executeResult = data
        break
      }
      case 'create_table': {
        const { data, error: rpcError } = await supabase.rpc('create_table', {
          p_invitation_id: invitation_id,
          p_name:          action.payload.name,
          p_size:          action.payload.size,
          p_shape:         action.payload.shape,
          p_vertical:      action.payload.vertical || false,
          p_number:        action.payload.number || null,
        })
        if (rpcError) throw rpcError
        executeResult = data
        break
      }
      case 'delete_table': {
        const { data, error: rpcError } = await supabase.rpc('delete_table', {
          p_invitation_id: invitation_id,
          p_table_id:      action.payload.table_id,
        })
        if (rpcError) throw rpcError
        if (!data.success) throw new Error(data.error)
        executeResult = data
        break
      }
      case 'update_side_event_guest_state': {
        const { data, error: rpcError } = await supabase
          .rpc('update_side_event_guest_state', {
            p_guest_id:  action.payload.guest_id,
            p_new_state: action.payload.new_state,
          })
        if (rpcError) throw rpcError
        executeResult = data
        break
      }
      default:
        return res.status(400).json({ success: false, error: `Acción no soportada: ${action.action_type}` })
    }

    await supabase
      .from('ai_pending_actions')
      .update({ status: 'executed', executed_at: new Date().toISOString() })
      .eq('id', action_id)

    res.json({ success: true, result: executeResult })
  } catch (err) {
    await supabase.from('ai_pending_actions').update({ status: 'failed' }).eq('id', action_id)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ------------------------------------------------------------
// POST /api/ai/chat/reject — Rechazar acción pendiente
// ------------------------------------------------------------

router.post('/chat/reject', async (req, res) => {
  const { action_id } = req.body
  await supabase.from('ai_pending_actions').update({ status: 'rejected' }).eq('id', action_id)
  res.json({ success: true })
})

// ------------------------------------------------------------
// POST /api/ai/chat/feedback — Calificación de respuesta
// ------------------------------------------------------------

router.post('/chat/feedback', async (req, res) => {
  const { message_id, feedback, note } = req.body

  if (!message_id || !feedback) {
    return res.status(400).json({
      success: false,
      error: 'message_id y feedback son requeridos',
    })
  }

  try {
    const { data, error } = await supabase
      .rpc('submit_message_feedback', {
        p_message_id: message_id,
        p_feedback:   feedback,
        p_note:       note || null,
      })

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// ------------------------------------------------------------
// POST /api/ai/chat/action-feedback — Calificación de acción ejecutada
// ------------------------------------------------------------

router.post('/chat/action-feedback', async (req, res) => {
  const { action_id, feedback, note } = req.body

  if (!action_id || !feedback) {
    return res.status(400).json({ success: false, error: 'action_id y feedback son requeridos' })
  }

  try {
    const { data, error } = await supabase
      .rpc('submit_action_feedback', {
        p_action_id: action_id,
        p_feedback:  feedback,
        p_note:      note || null,
      })
    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
