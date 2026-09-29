// routes/ai.chat.route.js
// ============================================================
// Fase 5 — Agente Lia con streaming + alertas proactivas
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
const { validarAccesoInvitacion } = require('../middlewares/validar-acceso-invitacion')
const { crearLimite, ipDe } = require('../helpers/limiteMemoria')
const { planIncluyeLia } = require('../config/plans')
const { buildSystemPrompt, buildGuestSystemPrompt, tipoDeEvento, idiomaDe, diaDeCalendario, diasEntre, hoyEnMexico, fechaLarga, horaDePared } = require('../models/lia.prompt')

// Los prompts (organizador e invitados) viven en models/lia.prompt.js.

// ------------------------------------------------------------
// TOOLS disponibles para Lia
// ------------------------------------------------------------

const LIA_TOOLS = [
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
    description: 'Propone cambiar la fecha del evento. Crea una tarjeta que el organizador aprueba en la app.',
    input_schema: {
      type: 'object',
      properties: {
        new_date: {
          type: 'string',
          description: 'Nueva fecha como YYYY-MM-DD, o YYYY-MM-DDTHH:mm si el organizador dio la hora (hora local del evento, sin zona). Ejemplo: "2026-10-15" o "2026-10-15T18:00"',
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
    description: 'Lista todos los side events (eventos secundarios) del evento: despedidas, tornaboda, pedida de mano, cenas, etc. Incluye nombre, fecha, lugar y conteo de invitados por estado. Úsala cuando pregunten por eventos adicionales, sub-eventos o eventos complementarios.',
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
    description: 'Obtiene un resumen de todas las novedades recientes: confirmaciones y cancelaciones de las últimas 24 horas (evento principal y side events), invitados que vieron la invitación pero no respondieron, y mensajes sin leer. Úsala cuando el usuario pida notificaciones, novedades, o qué ha pasado recientemente.',
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
            state:    { type: 'string',  enum: ['creado', 'esperando', 'confirmado', 'rechazado'], description: 'Estado (pestaña) para filter_by_state' },
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

// Los ids que manda el modelo (guest_id, side_event_id) son globales: sin
// comprobar que pertenecen a esta invitación, bastaba pedir "el invitado 123"
// para leer o modificar invitados de otro evento.
const guestDeLaInvitacion = async (guestId, invitationId) => {
  if (guestId == null) return null
  const { data } = await supabase
    .from('guests')
    .select('id, name')
    .eq('id', guestId)
    .eq('invitation_id', invitationId)
    .maybeSingle()
  return data
}

const sideEventDeLaInvitacion = async (sideEventId, invitationId) => {
  if (sideEventId == null) return null
  const { data } = await supabase
    .from('side_events')
    .select('id')
    .eq('id', sideEventId)
    .eq('invitation_id', invitationId)
    .maybeSingle()
  return data
}

const sideGuestDeLaInvitacion = async (sideGuestId, invitationId) => {
  if (sideGuestId == null) return null
  const { data } = await supabase
    .from('side_events_guests')
    .select('id, name, side_events_id')
    .eq('id', sideGuestId)
    .maybeSingle()
  if (!data) return null
  return (await sideEventDeLaInvitacion(data.side_events_id, invitationId)) ? data : null
}

const INVITADO_AJENO = { error: 'No encontré a ese invitado en este evento.' }

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
        if (!(await guestDeLaInvitacion(toolInput.guest_id, invitationId))) return INVITADO_AJENO
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
        // La fecha es "de pared" (lo que eligió el organizador), sin zona: se
        // valida como día de calendario y, si no dieron hora, se conserva la
        // que ya tenía el evento. Antes se aceptaba cualquier texto y el
        // preview lo formateaba con la zona del servidor (UTC).
        const m = String(toolInput.new_date || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/)
        const esDiaReal = m && (() => {
          const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
          return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
        })()
        if (!esDiaReal || (m[4] && (+m[4] > 23 || +m[5] > 59))) {
          return { error: 'Fecha no válida: usa YYYY-MM-DD (y HH:mm si hay hora).' }
        }
        const dia = `${m[1]}-${m[2]}-${m[3]}`
        const { data: inv } = await supabase.from('invitations').select('event_date').eq('id', invitationId).maybeSingle()
        const hora = m[4] ? `${m[4]}:${m[5]}` : (horaDePared(inv?.event_date) || '00:00')
        return {
          requires_confirmation: true,
          action_type:  'update_event_date',
          payload:      { new_date: `${dia}T${hora}:00` },
          preview_text: `Cambiar fecha del evento a ${fechaLarga(dia)}${m[4] ? `, ${hora}` : ''}`,
        }
      }
      case 'update_guest_state': {
        const guestData = await guestDeLaInvitacion(toolInput.guest_id, invitationId)
        if (!guestData) return INVITADO_AJENO

        const guestName = guestData.name || `Invitado #${toolInput.guest_id}`

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

        const guestForPreview = await guestDeLaInvitacion(toolInput.guest_id, invitationId)
        if (!guestForPreview) return INVITADO_AJENO

        const guestNameForPreview = guestForPreview.name || `Invitado #${toolInput.guest_id}`

        return {
          requires_confirmation: true,
          action_type:  'assign_guest_table',
          payload:      { guest_id: toolInput.guest_id, table_id: tableRow.id },
          preview_text: `Asignar a ${guestNameForPreview} → Mesa #${tableRow.number}${tableRow.name ? ` — ${tableRow.name}` : ''}`,
        }
      }
      case 'ui_action': {
        // Lo que llega aquí lo decide el modelo y termina ejecutándose en el
        // dashboard: solo se deja pasar la forma que el front sabe usar.
        const payload = toolInput.payload || {}
        let limpio
        if (toolInput.type === 'filter_guests' && typeof payload.query === 'string') {
          limpio = { query: payload.query.slice(0, 100) }
        } else if (toolInput.type === 'filter_by_state' && GUEST_TAB_STATES.includes(payload.state)) {
          limpio = { state: payload.state }
        } else if (toolInput.type === 'open_guest_form') {
          limpio = {}
        } else if (toolInput.type === 'open_guest_detail' && Number.isFinite(Number(payload.guest_id))) {
          if (!(await guestDeLaInvitacion(Number(payload.guest_id), invitationId))) return INVITADO_AJENO
          limpio = { guest_id: Number(payload.guest_id) }
        }
        if (!UI_ACTION_TYPES.includes(toolInput.type) || !limpio) {
          return { error: 'Acción de interfaz no válida' }
        }
        return {
          requires_ui_action: true,
          ui_action: { type: toolInput.type, payload: limpio },
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
          evento_principal: {
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
        if (!(await sideEventDeLaInvitacion(toolInput.side_event_id, invitationId))) {
          return { error: 'No encontré ese side event en este evento.' }
        }
        ;({ data, error } = await supabase.rpc('get_side_event_guests', {
          p_side_event_id: toolInput.side_event_id,
          p_state:         toolInput.state || null,
          p_tag:           toolInput.tag   || null,
        }))
        if (error) throw error
        return data
      }
      case 'update_side_event_guest_state': {
        const guestData = await sideGuestDeLaInvitacion(toolInput.guest_id, invitationId)
        if (!guestData) return INVITADO_AJENO
        const guestName = guestData.name || `Invitado #${toolInput.guest_id}`
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

// Solo se evalúan cuando el intent es ACCION: "¿cuántos de todos los
// invitados confirmaron?" es una consulta. El número solo cuenta si son varias
// mesas o invitados, no una capacidad ("mesa para 10 invitados").
const BULK_PATTERNS = [
  /(?<!para\s)(?<!de\s)\b([2-9]|\d{2,})\s+(mesas|invitad[oa]s)\b/i,
  /\btod[oa]s\s*(los|las)\b/i,
  /\bcada\s+una\b/i,
  /\bgrupo\s+completo\b/i,
  /\btoda\s+la\s+(familia|lista|mesa)\b/i,
]

const bulkBlockedMsg = (lang) => (idiomaDe(lang) === 'en'
  ? "Group actions are coming soon to Lia. For now I can help you one at a time."
  : 'Las acciones en grupo llegan muy pronto a Lia. Por ahora puedo ayudarte de una en una.')

const isBulkAction = (message, intent) => {
  if (intent !== 'ACCION') return false
  return BULK_PATTERNS.some(pattern => pattern.test(message))
}

// Red de seguridad para lo que el regex no ve: si el modelo propone más de
// esto en un solo turno, se descartan las propuestas y se responde el aviso.
const MAX_ACCIONES_POR_TURNO = 3

const UI_ACTION_TYPES = ['filter_guests', 'filter_by_state', 'open_guest_form', 'open_guest_detail']
const GUEST_TAB_STATES = ['creado', 'esperando', 'confirmado', 'rechazado']

// ------------------------------------------------------------
// SALUDO ENRIQUECIDO — construye greeting con datos en paralelo
// ------------------------------------------------------------

const buildGreeting = async (invitation_id, lang) => {
  const en = idiomaDe(lang) === 'en'
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

  // Días de calendario en CDMX (event_date es hora "de pared": no se convierte)
  const diaEvento   = diaDeCalendario(event.event_date)
  const daysToEvent = diaEvento ? diasEntre(hoyEnMexico(), diaEvento) : null
  const evento      = tipoDeEvento(event.label, 'es')

  // Time-based greeting (Mexico City timezone)
  const nowMX = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
  const hour  = nowMX.getHours()

  const morningOptions   = en ? ['Good morning!', 'Good morning ☀️'] : ['¡Buenos días!', 'Buen día ☀️', '¡Buenos días, aquí estoy!']
  const afternoonOptions = en ? ['Good afternoon!', 'Good afternoon ✨'] : ['¡Buenas tardes!', 'Buenas tardes ✨']
  const eveningOptions   = en ? ['Good evening!', 'Good evening 🌙'] : ['¡Buenas noches!', 'Buenas noches 🌙']

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

  const timeGreeting = hour < 12
    ? pick(morningOptions)
    : hour < 19
    ? pick(afternoonOptions)
    : pick(eveningOptions)

  // greeting_text — solo el saludo personal, sin datos
  const names = en ? (event.owners || []).filter(Boolean).join(' & ') : ownerNames
  const greetingText = names
    ? `${en ? 'Hi' : '¡Hola'} ${names}! ${timeGreeting} 👋`
    : `${timeGreeting} 👋`

  // summary — los datos del evento como bullets
  let summary = ''

  if (daysToEvent !== null) {
    if (daysToEvent > 30) {
      summary += `📅 Faltan **${daysToEvent} días** para ${event.label === 'xv' ? 'los' : 'el'} ${evento}.\n`
    } else if (daysToEvent > 7) {
      summary += `📅 ¡Ya están muy cerca! Faltan **${daysToEvent} días**.\n`
    } else if (daysToEvent > 1) {
      summary += `🎊 ¡Faltan **${daysToEvent} días**!\n`
    } else if (daysToEvent === 1) {
      summary += `🎊 ¡**Mañana es el gran día**!\n`
    } else if (daysToEvent === 0) {
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

router.post('/greeting', validarAccesoInvitacion, async (req, res) => {
  const { invitation_id, lang } = req.body

  if (!invitation_id) {
    return res.status(400).json({ success: false, error: 'invitation_id requerido' })
  }

  try {
    const [{ greeting_text, summary, eventSummary, credits_remaining, alerts }, liaIncluded] = await Promise.all([
      buildGreeting(invitation_id, lang),
      planIncluyeLia(req.invitation?.plan),
    ])

    res.json({
      success:           true,
      lia_included:      liaIncluded,
      greeting_text,
      summary,
      alerts,
      credits_remaining,
      event_summary:     eventSummary,
    })
  } catch (err) {
    console.error('[greeting] error:', err.message)
    res.status(500).json({ success: false, error: 'No se pudo cargar el saludo' })
  }
})

// ------------------------------------------------------------
// POST /api/ai/chat — con streaming SSE
// ------------------------------------------------------------

router.post('/chat', validarAccesoInvitacion, async (req, res) => {
  const { invitation_id, message, session_id, stream = true, conversation_history, lang } = req.body

  if (!invitation_id || !message) {
    return res.status(400).json({ success: false, error: 'invitation_id y message son requeridos' })
  }

  // 0. Lia solo en planes que la incluyen (antes el candado era solo visual)
  if (!(await planIncluyeLia(req.invitation?.plan))) {
    return res.status(403).json({ success: false, code: 'NOT_AVAILABLE', error: 'Lia no está incluida en el plan de este evento' })
  }

  // 1. Verificar que hay créditos disponibles (sin descontar aún)
  const { data: statusData, error: statusError } = await supabase
    .rpc('get_lia_credits_status', { p_invitation_id: invitation_id })

  if (statusError || !statusData) {
    console.error('[chat] get_lia_credits_status falló:', statusError?.message)
    return res.status(500).json({ success: false, error: 'No se pudo revisar el saldo de Lia' })
  }

  if (statusData.total_available <= 0) {
    return res.status(402).json({
      success:   false,
      code:      'NO_CREDITS',
      error:     'Alcanzaste tu límite diario de Lia. Se renueva a medianoche.',
      resets_at: statusData?.resets_at,
    })
  }

  try {
    // 2. Historial enviado por el frontend (últimos 6 registros)
    // El historial lo manda el cliente: solo user/assistant (un role "system"
    // falso pasaría tal cual a GPT) y con texto acotado.
    const historyMessages = (Array.isArray(conversation_history) ? conversation_history : [])
      .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))

    // 3. Obtener contexto del evento
    const { data: eventSummary } = await supabase
      .rpc('get_event_summary', { p_invitation_id: invitation_id })

    // Antes aquí había heurísticas por substring ("forma", "¿Confirmas?") que
    // metían el mensaje del usuario dentro del system prompt. El flujo de crear
    // mesa y el "sí" después de una propuesta ya están como reglas fijas del
    // prompt (models/lia.prompt.js), y el modelo ve el historial.
    const systemPrompt = buildSystemPrompt(eventSummary, { lang })
    const currentMessages = [
      ...historyMessages,
      { role: 'user', content: message },
    ]

    // ---- STREAMING ----
    if (stream) {
      res.setHeader('Content-Type',  'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection',    'keep-alive')
      res.flushHeaders()

      // Si el organizador cierra el chat, se corta la llamada al modelo.
      const abort = new AbortController()
      res.on('close', () => { if (!res.writableFinished) abort.abort() })

      let   fullContent    = ''
      let   totalTokensIn  = 0
      let   totalTokensOut = 0
      let   modelUsed      = AI_MODELS.SONNET
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
            { invitation_id, session_id: currentSessionId, role: 'assistant', content: bulkBlockedMsg(lang), model_used: 'blocked' },
          ])
          res.write(`data: ${JSON.stringify({ type: 'text', text: bulkBlockedMsg(lang) })}\n\n`)
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
            result = await runGeminiLoop(systemPrompt, currentMessages, LIA_TOOLS, executeToolWithTracking, invitation_id)
          } else if (intent === 'ACCION') {
            result = await runGPTLoop(systemPrompt, currentMessages, LIA_TOOLS, executeToolWithTracking, invitation_id)
          } else {
            result = await runSonnetStreamLoop(systemPrompt, currentMessages, LIA_TOOLS, executeToolWithTracking, invitation_id, res, AI_MODELS.SONNET, abort.signal)
          }
        } catch (err) {
          if (abort.signal.aborted) throw err
          console.error(`[chat/stream] ${intent} falló, escalando a Sonnet:`, err.message)
          result = await runSonnetStreamLoop(systemPrompt, currentMessages, LIA_TOOLS, executeToolWithTracking, invitation_id, res, AI_MODELS.SONNET, abort.signal)
        }

        fullContent    = result.content
        totalTokensIn  = result.tokensIn
        totalTokensOut = result.tokensOut
        modelUsed      = result.modelId
        if (result.pendingActions?.length > MAX_ACCIONES_POR_TURNO) {
          fullContent = bulkBlockedMsg(lang)
        } else if (result.pendingActions?.length) {
          pendingActions.push(...result.pendingActions)
        }

        // Gemini y GPT no se transmiten en vivo: su texto va en un solo evento.
        // (Si se bloqueó por exceso de acciones, fullContent es el aviso.)
        if ((result.modelId !== AI_MODELS.SONNET || fullContent !== result.content) && fullContent) {
          if (fullContent !== result.content) res.write(`data: ${JSON.stringify({ type: 'replace', text: '' })}\n\n`)
          res.write(`data: ${JSON.stringify({ type: 'text', text: fullContent })}\n\n`)
        }

      } catch (err) {
        if (abort.signal.aborted) return
        console.error('[chat/stream] error fatal:', err.message)
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'No se pudo responder' })}\n\n`)
        res.end()
        return
      }

      // Guardar conversación
      const currentSessionId = toUuidSession(session_id, invitation_id)
      const { data: insertedConv, error: insertError } = await supabase
        .from('ai_conversations')
        .insert([
          { invitation_id, session_id: currentSessionId, role: 'user',      content: message },
          { invitation_id, session_id: currentSessionId, role: 'assistant', content: fullContent,   model_used: modelUsed, tokens_in: totalTokensIn, tokens_out: totalTokensOut },
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
      const costUsd = calculateCost(modelUsed, totalTokensIn, totalTokensOut)
      await supabase.rpc('log_ai_interaction', {
        p_invitation_id: invitation_id,
        p_model:         modelUsed,
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

    // ---- SIN STREAMING (el que usa el dashboard) ----
    const intent = await classifyIntent(message, historyMessages)
    if (isBulkAction(message, intent)) {
      const currentSessionId = toUuidSession(session_id, invitation_id)
      await supabase.from('ai_conversations').insert([
        { invitation_id, session_id: currentSessionId, role: 'user',      content: message },
        { invitation_id, session_id: currentSessionId, role: 'assistant', content: bulkBlockedMsg(lang), model_used: 'blocked' },
      ])
      return res.json({ success: true, message: bulkBlockedMsg(lang), blocked: true })
    }

    const result = await orchestrate({
      invitationId: invitation_id,
      userMessage:  message,
      history:      historyMessages,
      systemPrompt,
      tools:        LIA_TOOLS,
      executeTool,
      intent,
    })

    if (result.pendingActions.length > MAX_ACCIONES_POR_TURNO) {
      result.content        = bulkBlockedMsg(lang)
      result.pendingActions = []
    }

    const currentSessionId = toUuidSession(session_id, invitation_id)
    const { data: insertedConv, error: convError } = await supabase
      .from('ai_conversations')
      .insert([
        { invitation_id, session_id: currentSessionId, role: 'user',      content: message },
        { invitation_id, session_id: currentSessionId, role: 'assistant', content: result.content, model_used: result.modelUsed, tokens_in: result.tokensIn, tokens_out: result.tokensOut },
      ])
      .select()
    if (convError) console.error('ERROR INSERT ai_conversations:', convError)

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
      ui_actions:        result.uiActions,
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
      res.status(500).json({ success: false, error: 'No se pudo responder' })
    } else if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'No se pudo responder' })}\n\n`)
      res.end()
    }
  }
})

// ------------------------------------------------------------
// POST /api/ai/chat/approve — Aprobar acción pendiente
// ------------------------------------------------------------

router.post('/chat/approve', validarAccesoInvitacion, async (req, res) => {
  const { action_id, invitation_id } = req.body

  if (!action_id || !invitation_id) {
    return res.status(400).json({ success: false, error: 'action_id e invitation_id son requeridos' })
  }

  try {
    // Se reclama la acción de forma atómica (pending → executed en un solo
    // UPDATE condicional): con dos clics o dos pestañas, solo una petición
    // la obtiene y la otra recibe 404. Si la ejecución falla, pasa a failed.
    const { data: action, error } = await supabase
      .from('ai_pending_actions')
      .update({ status: 'executed', executed_at: new Date().toISOString() })
      .eq('id', action_id)
      .eq('invitation_id', invitation_id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle()

    if (error || !action) {
      return res.status(404).json({ success: false, error: 'Acción no encontrada o ya procesada' })
    }

    // Se vuelve a comprobar al ejecutar: las RPCs de invitados reciben solo el
    // id del invitado, y puede haber acciones pendientes de antes de validar
    // la pertenencia al proponerlas.
    const guestId = action.payload?.guest_id
    const ajeno =
      (['update_guest_state', 'assign_guest_table'].includes(action.action_type)
        && !(await guestDeLaInvitacion(guestId, invitation_id)))
      || (action.action_type === 'update_side_event_guest_state'
        && !(await sideGuestDeLaInvitacion(guestId, invitation_id)))

    if (ajeno) {
      await supabase.from('ai_pending_actions').update({ status: 'failed' }).eq('id', action_id)
      return res.status(403).json({ success: false, error: 'Ese invitado no pertenece a este evento' })
    }

    if (action.action_type === 'assign_guest_table') {
      const { data: mesa } = await supabase
        .from('tables')
        .select('id')
        .eq('id', action.payload.table_id)
        .eq('invitation_id', invitation_id)
        .maybeSingle()
      if (!mesa) {
        await supabase.from('ai_pending_actions').update({ status: 'failed' }).eq('id', action_id)
        return res.status(403).json({ success: false, error: 'Esa mesa no pertenece a este evento' })
      }
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
        await supabase.from('ai_pending_actions').update({ status: 'failed' }).eq('id', action_id)
        return res.status(400).json({ success: false, error: `Acción no soportada: ${action.action_type}` })
    }

    res.json({ success: true, result: executeResult })
  } catch (err) {
    console.error('[chat/approve] error:', err.message)
    await supabase.from('ai_pending_actions').update({ status: 'failed' }).eq('id', action_id)
    res.status(500).json({ success: false, error: 'No se pudo ejecutar la acción' })
  }
})

// ------------------------------------------------------------
// POST /api/ai/chat/reject — Rechazar acción pendiente
// ------------------------------------------------------------

router.post('/chat/reject', validarAccesoInvitacion, async (req, res) => {
  const { action_id, invitation_id } = req.body
  await supabase
    .from('ai_pending_actions')
    .update({ status: 'rejected' })
    .eq('id', action_id)
    .eq('invitation_id', invitation_id)
    .eq('status', 'pending')
  res.json({ success: true })
})

// ------------------------------------------------------------
// POST /api/ai/chat/feedback — Calificación de respuesta
// ------------------------------------------------------------

router.post('/chat/feedback', validarAccesoInvitacion, async (req, res) => {
  const { message_id, feedback, note, invitation_id } = req.body

  if (!message_id || !feedback) {
    return res.status(400).json({
      success: false,
      error: 'message_id y feedback son requeridos',
    })
  }

  try {
    const { data: mensaje } = await supabase
      .from('ai_conversations')
      .select('id')
      .eq('id', message_id)
      .eq('invitation_id', invitation_id)
      .maybeSingle()
    if (!mensaje) return res.status(404).json({ success: false, error: 'Mensaje no encontrado' })

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

router.post('/chat/action-feedback', validarAccesoInvitacion, async (req, res) => {
  const { action_id, feedback, note, invitation_id } = req.body

  if (!action_id || !feedback) {
    return res.status(400).json({ success: false, error: 'action_id y feedback son requeridos' })
  }

  try {
    const { data: accion } = await supabase
      .from('ai_pending_actions')
      .select('id')
      .eq('id', action_id)
      .eq('invitation_id', invitation_id)
      .maybeSingle()
    if (!accion) return res.status(404).json({ success: false, error: 'Acción no encontrada' })

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

// ------------------------------------------------------------
// POST /api/ai/guest-chat — Chat público para invitados
// Solo info pública del evento. Sin créditos ni tools admin.
// ------------------------------------------------------------

// Los datos públicos del evento (get_event_details) van directo en el prompt:
// antes eran una tool, y cada pregunta costaba dos llamadas al modelo (una
// para pedir la tool y otra para responder). Se cachean un minuto por
// invitación porque muchos invitados preguntan casi al mismo tiempo.
const DETALLES_CACHE_MS = 60 * 1000
const detallesCache = new Map()

const detallesDelEvento = async (invitationId) => {
  const guardado = detallesCache.get(invitationId)
  if (guardado && Date.now() - guardado.at < DETALLES_CACHE_MS) return guardado.data
  const { data, error } = await supabase.rpc('get_event_details', { p_invitation_id: invitationId })
  if (error) throw error
  detallesCache.set(invitationId, { data, at: Date.now() })
  if (detallesCache.size > 500) detallesCache.delete(detallesCache.keys().next().value)
  return data
}

// Límites del chat de invitados. Es público (el invitado no tiene sesión), así
// que el costo se contiene aquí: tamaño de lo que se manda al modelo, ráfagas
// por IP y un tope diario por invitación contado en la base.
const GUEST_LIMITES = {
  mensajeMax:      500,   // caracteres del mensaje nuevo
  historialTurnos: 10,    // mensajes previos que se reenvían al modelo
  turnoMax:        2000,  // caracteres por mensaje del historial
  nombreMax:       60,
  diarioPorInvitacion: 300,
}
const GUEST_TOOL_LOG = 'guest_chat'  // marca en ai_agent_logs.tool_called
const limiteGuestIp = crearLimite({ max: 20, ventanaMs: 10 * 60 * 1000 })

// El historial lo arma el cliente: solo user/assistant con texto plano,
// recortado, empezando por user y sin dos turnos seguidos del mismo rol
// (la API de Anthropic los exige alternados).
const limpiarHistorialGuest = (historial) => {
  const turnos = (Array.isArray(historial) ? historial : [])
    .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-GUEST_LIMITES.historialTurnos)
    .map(m => ({ role: m.role, content: m.content.slice(0, GUEST_LIMITES.turnoMax) }))

  while (turnos.length && turnos[0].role !== 'user') turnos.shift()

  return turnos.reduce((acc, m) => {
    const previo = acc[acc.length - 1]
    if (previo?.role === m.role) previo.content += `\n\n${m.content}`
    else acc.push({ ...m })
    return acc
  }, [])
}

const limpiarNombreGuest = (nombre) => (typeof nombre === 'string'
  ? nombre.replace(/[\u0000-\u001f"`\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, GUEST_LIMITES.nombreMax)
  : '')

// Lia para invitados solo existe en invitaciones activas cuyo plan la incluye
// (feature `lia` en plans.features, editable en Admin → Planes).
// Devuelve la invitación (label, event_date) o null si Lia no aplica.
const invitacionConLiaGuest = async (invitationId) => {
  const { data: inv } = await supabase
    .from('invitations')
    .select('id, plan, active, label, event_date')
    .eq('id', invitationId)
    .maybeSingle()
  if (!inv?.active) return null
  return (await planIncluyeLia(inv.plan)) ? inv : null
}

const usoGuestDeHoy = async (invitationId) => {
  const inicioDelDia = new Date()
  inicioDelDia.setUTCHours(0, 0, 0, 0)
  const { count, error } = await supabase
    .from('ai_agent_logs')
    .select('id', { count: 'exact', head: true })
    .eq('invitation_id', invitationId)
    .like('tool_called', `${GUEST_TOOL_LOG}%`)
    .gte('created_at', inicioDelDia.toISOString())
  if (error) throw error
  return count || 0
}

router.post('/guest-chat', async (req, res) => {
  const { invitation_id, message, guest_name, conversation_history, lang } = req.body

  if (!invitation_id || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ success: false, code: 'BAD_REQUEST', error: 'invitation_id y message son requeridos' })
  }
  if (!UUID_RE.test(invitation_id)) {
    return res.status(400).json({ success: false, code: 'BAD_REQUEST', error: 'invitation_id no válido' })
  }
  if (message.length > GUEST_LIMITES.mensajeMax) {
    return res.status(413).json({ success: false, code: 'MESSAGE_TOO_LONG', error: `El mensaje no puede pasar de ${GUEST_LIMITES.mensajeMax} caracteres` })
  }
  if (!limiteGuestIp(ipDe(req))) {
    return res.status(429).json({ success: false, code: 'RATE_LIMITED', error: 'Demasiadas preguntas seguidas. Intenta en unos minutos.' })
  }

  let invitacion, detalles
  try {
    invitacion = await invitacionConLiaGuest(invitation_id)
    if (!invitacion) {
      return res.status(403).json({ success: false, code: 'NOT_AVAILABLE', error: 'Lia no está disponible para este evento' })
    }
    if ((await usoGuestDeHoy(invitation_id)) >= GUEST_LIMITES.diarioPorInvitacion) {
      return res.status(429).json({ success: false, code: 'DAILY_LIMIT', error: 'Lia ya respondió muchas preguntas hoy. Intenta mañana.' })
    }
    detalles = await detallesDelEvento(invitation_id)
  } catch (err) {
    console.error('[guest-chat] error al validar:', err.message)
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', error: 'No se pudo procesar la pregunta' })
  }

  const systemPrompt = buildGuestSystemPrompt({ guestName: limpiarNombreGuest(guest_name), invitation: invitacion, details: detalles, lang: /^[a-z]{2}(-[A-Za-z]{2})?$/.test(String(lang || '')) ? lang : null })
  const currentMessages = limpiarHistorialGuest([
    ...(Array.isArray(conversation_history) ? conversation_history : []),
    { role: 'user', content: message.trim() },
  ])

  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection',    'keep-alive')
  res.flushHeaders()

  const abort = new AbortController()
  res.on('close', () => { if (!res.writableFinished) abort.abort() })

  const inicio = Date.now()
  let result = null
  let fallo = null

  try {
    // Sin tools: los datos ya van en el prompt.
    result = await runSonnetStreamLoop(
      systemPrompt,
      currentMessages,
      undefined,
      async () => ({ error: 'Sin herramientas' }),
      invitation_id,
      res,
      AI_MODELS.HAIKU,
      abort.signal
    )

    if (!res.destroyed && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
      res.end()
    }
  } catch (err) {
    fallo = err
    if (!abort.signal.aborted) console.error('[guest-chat] error:', err.message)
    if (!res.destroyed && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'No se pudo procesar la pregunta' })}\n\n`)
      res.end()
    }
  }

  // Cada pregunta queda en ai_agent_logs, también las que fallan: de ahí sale
  // el tope diario y el costo del chat de invitados en la analítica.
  const tokensIn  = result?.tokensIn  || 0
  const tokensOut = result?.tokensOut || 0
  const { error: logError } = await supabase.rpc('log_ai_interaction', {
    p_invitation_id: invitation_id,
    p_model:         AI_MODELS.HAIKU,
    p_tokens_in:     tokensIn,
    p_tokens_out:    tokensOut,
    p_cost_usd:      calculateCost(AI_MODELS.HAIKU, tokensIn, tokensOut),
    p_tool_called:   GUEST_TOOL_LOG,
    p_success:       !fallo && Boolean(result?.content),
    p_duration_ms:   Date.now() - inicio,
  })
  if (logError) console.error('[guest-chat] no se pudo registrar el uso:', logError.message)
})

module.exports = router
