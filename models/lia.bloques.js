// models/lia.bloques.js
// ============================================================
// Bloques visuales de Lia (lista de invitados, barra, resumen, mesas).
//
// El modelo solo elige QUÉ mostrar (tipo + ids o subtipo) con la tool
// `mostrar_bloque`; los datos los pone el servidor leyendo la base, siempre
// filtrados por la invitación. Así un bloque nunca muestra un nombre
// inventado, un número mal sumado ni un invitado de otro evento.
//
// La tool es "terminal": si en un turno el modelo solo pidió bloques, el loop
// termina ahí en vez de hacer otra llamada al modelo para leer un "ok".
// ============================================================

const supabase = require('../config/supabase')
const { DESTINOS } = require('./lia.ayuda')

const MAX_INVITADOS = 25
const MAX_MESAS     = 12
const MAX_BLOQUES_POR_RESPUESTA = 3

const BLOQUE_TOOL = {
  name: 'mostrar_bloque',
  description: `Muestra datos en un bloque visual dentro del chat, debajo de tu texto. Úsala cuando la respuesta sea una lista de invitados, una ocupación o un resumen de números: se lee mejor que en texto. Escribe primero una frase corta (el titular) y llama esta herramienta en la misma respuesta; no repitas en el texto lo que ya muestra el bloque. Tipos:
- lista_invitados: guest_ids obtenidos de otra herramienta (máx. ${MAX_INVITADOS}). Muestra nombre, estado y mesa.
- barra: subtipo "mesas" (lugares ocupados), "confirmaciones" (confirmados del total) o "pases" (pases usados).
- resumen_rsvp: conteo por estado (confirmados, esperando, por invitar, no asistirán).
- mesas: ocupación por mesa; numeros opcional para mostrar solo esas.
- comparacion_lados: invitados por anfitrión (lado de cada uno) y por estado.
- side_events: los side events del evento con su fecha y confirmaciones.
- atajo: botón que lleva a una pantalla de la app. destino (uno de la lista) y etiqueta corta del botón ("Ir a mesas"). Úsalo en dudas de "dónde está" o "cómo hago".
- soporte: tarjeta con el WhatsApp y el correo de soporte. Úsala cuando no puedas resolver la duda.
Máximo ${MAX_BLOQUES_POR_RESPUESTA} bloques por respuesta.`,
  input_schema: {
    type: 'object',
    properties: {
      tipo:      { type: 'string', enum: ['lista_invitados', 'barra', 'resumen_rsvp', 'mesas', 'comparacion_lados', 'side_events', 'atajo', 'soporte'] },
      destino:   { type: 'string', enum: Object.keys(DESTINOS), description: `Para atajo: ${Object.entries(DESTINOS).map(([k, v]) => `${k} (${v})`).join(', ')}` },
      etiqueta:  { type: 'string', description: 'Para atajo: texto corto del botón' },
      titulo:    { type: 'string', description: 'Título corto opcional del bloque' },
      guest_ids: { type: 'array', items: { type: 'number' }, description: 'Para lista_invitados' },
      subtipo:   { type: 'string', enum: ['mesas', 'confirmaciones', 'pases'], description: 'Para barra' },
      numeros:   { type: 'array', items: { type: 'string' }, description: 'Para mesas: números de mesa a mostrar' },
    },
    required: ['tipo'],
  },
}

const titulo = (t) => (typeof t === 'string' && t.trim() ? t.trim().slice(0, 80) : null)

const mesasDeLaInvitacion = async (invitationId) => {
  const { data, error } = await supabase
    .from('tables')
    .select('id, number, name, size')
    .eq('invitation_id', invitationId)
  if (error) throw error
  // size 0 = decorativas (pista de baile): no cuentan
  return (data || []).filter(m => Number(m.size) > 0)
}

const sentadosPorMesa = async (invitationId) => {
  const { data, error } = await supabase
    .from('guests')
    .select('table')
    .eq('invitation_id', invitationId)
    .not('table', 'is', null)
  if (error) throw error
  const conteo = new Map()
  for (const g of data || []) conteo.set(String(g.table), (conteo.get(String(g.table)) || 0) + 1)
  return conteo
}

const contar = (filas) => {
  const c = { confirmados: 0, esperando: 0, por_invitar: 0, no_asistiran: 0, total: 0 }
  for (const { state } of filas) {
    c.total += 1
    if (state === 'confirmado' || state === 'asistente') c.confirmados += 1
    else if (state === 'esperando') c.esperando += 1
    else if (state === 'rechazado') c.no_asistiran += 1
    else c.por_invitar += 1
  }
  return c
}

const conteoPorEstado = async (invitationId) => {
  const { data, error } = await supabase
    .from('guests')
    .select('state')
    .eq('invitation_id', invitationId)
  if (error) throw error
  return contar(data || [])
}

// Invitados por anfitrión: `guests.side` guarda el nombre tal cual está en
// invitations.owners. Los que no tienen lado se cuentan aparte.
const resolverComparacion = async (input, invitationId) => {
  const [{ data: inv, error: invError }, { data: invitados, error }] = await Promise.all([
    supabase.from('invitations').select('owners').eq('id', invitationId).maybeSingle(),
    supabase.from('guests').select('state, side').eq('invitation_id', invitationId),
  ])
  if (invError || error) throw invError || error
  const owners = (Array.isArray(inv?.owners) ? inv.owners : []).filter(Boolean).slice(0, 4)
  if (owners.length < 2) return { error: 'El evento no tiene dos anfitriones registrados para comparar' }
  const norm = (v) => String(v ?? '').trim().toLowerCase()
  const lados = owners.map(nombre => ({
    nombre,
    ...contar((invitados || []).filter(g => norm(g.side) === norm(nombre))),
  }))
  const sinLado = contar((invitados || []).filter(g => !owners.some(o => norm(o) === norm(g.side))))
  return { tipo: 'comparacion_lados', titulo: titulo(input?.titulo), lados, sin_lado: sinLado.total }
}

const resolverListaInvitados = async (input, invitationId) => {
  const ids = [...new Set((Array.isArray(input.guest_ids) ? input.guest_ids : [])
    .map(Number).filter(Number.isFinite))].slice(0, MAX_INVITADOS)
  if (!ids.length) return { error: 'lista_invitados necesita guest_ids obtenidos de otra herramienta' }

  const [{ data: invitados, error }, mesas] = await Promise.all([
    supabase.from('guests').select('id, name, state, table').eq('invitation_id', invitationId).in('id', ids),
    mesasDeLaInvitacion(invitationId),
  ])
  if (error) throw error

  const mesaPorId = new Map(mesas.map(m => [String(m.id), m]))
  const porId = new Map((invitados || []).map(g => [g.id, g]))
  // Se respeta el orden en que Lia los pidió; los ids ajenos se descartan.
  const filas = ids.map(id => porId.get(id)).filter(Boolean).map(g => {
    const mesa = g.table != null ? mesaPorId.get(String(g.table)) : null
    return {
      id:    g.id,
      name:  g.name,
      state: g.state,
      table: mesa ? { number: mesa.number, name: mesa.name } : null,
    }
  })
  if (!filas.length) return { error: 'Ninguno de esos invitados es de este evento' }
  return { tipo: 'lista_invitados', titulo: titulo(input.titulo), invitados: filas }
}

const resolverBarra = async (input, invitationId) => {
  if (input.subtipo === 'mesas') {
    const [mesas, sentados] = await Promise.all([mesasDeLaInvitacion(invitationId), sentadosPorMesa(invitationId)])
    const total = mesas.reduce((acc, m) => acc + Number(m.size || 0), 0)
    const ocupados = mesas.reduce((acc, m) => acc + (sentados.get(String(m.id)) || 0), 0)
    return { tipo: 'barra', subtipo: 'mesas', titulo: titulo(input.titulo), ocupados, total }
  }
  if (input.subtipo === 'confirmaciones') {
    const c = await conteoPorEstado(invitationId)
    return { tipo: 'barra', subtipo: 'confirmaciones', titulo: titulo(input.titulo), ocupados: c.confirmados, total: c.total }
  }
  if (input.subtipo === 'pases') {
    const [{ data: inv, error }, c] = await Promise.all([
      supabase.from('invitations').select('tickets').eq('id', invitationId).maybeSingle(),
      conteoPorEstado(invitationId),
    ])
    if (error) throw error
    // Misma regla que el prompt: usados = confirmados + esperando
    return { tipo: 'barra', subtipo: 'pases', titulo: titulo(input.titulo), ocupados: c.confirmados + c.esperando, total: Number(inv?.tickets || 0) }
  }
  return { error: 'barra necesita subtipo: mesas, confirmaciones o pases' }
}

const resolverMesas = async (input, invitationId) => {
  const [mesas, sentados] = await Promise.all([mesasDeLaInvitacion(invitationId), sentadosPorMesa(invitationId)])
  const pedidas = Array.isArray(input.numeros) ? input.numeros.map(String) : []
  const filas = mesas
    .filter(m => !pedidas.length || pedidas.includes(String(m.number)))
    .map(m => ({ number: m.number, name: m.name, size: Number(m.size), seated: sentados.get(String(m.id)) || 0 }))
    .sort((a, b) => Number(a.number) - Number(b.number))
    .slice(0, MAX_MESAS)
  if (!filas.length) return { error: 'No encontré esas mesas en este evento' }
  return { tipo: 'mesas', titulo: titulo(input.titulo), mesas: filas }
}

// Side events con su fecha "de pared" (YYYY-MM-DD HH:mm:00, sin zona: se
// muestra tal cual) y el conteo por estado de sus propios invitados.
const resolverSideEvents = async (input, invitationId) => {
  const { data, error } = await supabase.rpc('get_side_events_summary', { p_invitation_id: invitationId })
  if (error) throw error
  const eventos = (Array.isArray(data) ? data : []).slice(0, 8).map(se => {
    const t = se.totals || {}
    return {
      id:    se.id,
      name:  se.name,
      date:  se.date || null,
      place: se.address?.neighborhood || se.address?.city || null,
      confirmados:  (t.confirmado || 0) + (t.asistente || 0),
      esperando:    t.esperando || 0,
      por_invitar:  t.creado || 0,
      no_asistiran: t.rechazado || 0,
      total:        t.total || 0,
    }
  })
  if (!eventos.length) return { error: 'Este evento no tiene side events' }
  return { tipo: 'side_events', titulo: titulo(input?.titulo), eventos }
}

// Devuelve { terminal, bloque } para el loop, o { error } que se le regresa al modelo.
const resolverBloque = async (input, invitationId) => {
  let bloque
  switch (input?.tipo) {
    case 'lista_invitados': bloque = await resolverListaInvitados(input, invitationId); break
    case 'barra':           bloque = await resolverBarra(input, invitationId); break
    case 'resumen_rsvp':    bloque = { tipo: 'resumen_rsvp', titulo: titulo(input.titulo), ...(await conteoPorEstado(invitationId)) }; break
    case 'mesas':           bloque = await resolverMesas(input, invitationId); break
    case 'comparacion_lados': bloque = await resolverComparacion(input, invitationId); break
    case 'side_events':     bloque = await resolverSideEvents(input, invitationId); break
    case 'atajo':
      // Solo destinos de la lista: la ruta la pone iattend-vite, nunca el modelo
      if (!DESTINOS[input.destino]) return { error: `destino no válido; usa uno de: ${Object.keys(DESTINOS).join(', ')}` }
      bloque = { tipo: 'atajo', destino: input.destino, etiqueta: titulo(input.etiqueta) || DESTINOS[input.destino] }
      break
    case 'soporte':
      // El número y el correo los pone iattend-vite (src/helpers/contact.js)
      bloque = { tipo: 'soporte', titulo: titulo(input.titulo) }
      break
    default:                return { error: 'Tipo de bloque no válido' }
  }
  if (bloque.error) return bloque
  return { terminal: true, ok: true, bloque }
}

// Texto corto del bloque para el historial: el modelo no ve los bloques, y
// sin esto no sabría qué nombres o números acaba de mostrar.
const bloqueComoTexto = (b) => {
  if (!b) return ''
  if (b.tipo === 'lista_invitados') return `[Lista: ${b.invitados.map(g => g.name).join(', ')}]`
  if (b.tipo === 'barra') return `[Barra ${b.subtipo}: ${b.ocupados} de ${b.total}]`
  if (b.tipo === 'resumen_rsvp') return `[Resumen: ${b.confirmados} confirmados, ${b.esperando} esperando, ${b.por_invitar} por invitar, ${b.no_asistiran} no asistirán]`
  if (b.tipo === 'mesas') return `[Mesas: ${b.mesas.map(m => `#${m.number} ${m.seated}/${m.size}`).join(', ')}]`
  if (b.tipo === 'side_events') return `[Side events: ${b.eventos.map(e => `${e.name} (${e.date || 'sin fecha'}, ${e.confirmados}/${e.total} confirmados)`).join('; ')}]`
  if (b.tipo === 'atajo') return `[Botón: ${b.etiqueta}]`
  if (b.tipo === 'soporte') return '[Tarjeta de contacto con soporte]'
  if (b.tipo === 'comparacion_lados') return `[Lados: ${b.lados.map(l => `${l.nombre} ${l.total} (${l.confirmados} confirmados)`).join(' vs ')}]`
  return ''
}

// ------------------------------------------------------------
// Bloques automáticos
// ------------------------------------------------------------
// Si el modelo respondió sin pedir bloque, se arma uno a partir de las
// herramientas que usó. No depende de que el modelo "se acuerde": una lista,
// una ocupación o una comparación siempre se ven como UI. No aplica cuando
// hubo acciones (tarjetas) o acciones de interfaz, porque ahí las consultas
// eran para encontrar un ID, no para mostrar datos.

const LISTAS = ['get_guests_by_status', 'get_guests_without_table']

const idsDe = (result) => {
  const filas = Array.isArray(result) ? result : Array.isArray(result?.invitados) ? result.invitados : null
  return filas ? filas.map(g => g?.id).filter(id => id != null) : null
}

// "Lado de Ale vs lado de Santiago" / "Ale's side vs Santiago's side" (atajos
// de la app) o cualquier "X vs Y" con dos lados.
const pideComparacion = (mensaje) =>
  /\blado de .+\bvs\.?\s+(el\s+)?lado de\b/i.test(mensaje) || /'s side vs .+'s side/i.test(mensaje)

const bloquesAutomaticos = async ({ evidencias = [], mensaje = '', invitationId }) => {
  const usadas = evidencias.filter(e => !e.result?.error)
  const lados = new Set(usadas.filter(e => e.tool === 'get_guests_by_status' && e.input?.side).map(e => String(e.input.side).toLowerCase()))

  if (pideComparacion(mensaje) || lados.size >= 2) {
    const b = await resolverComparacion({}, invitationId)
    return b.error ? [] : [b]
  }

  const listas = usadas.filter(e => LISTAS.includes(e.tool))
  if (listas.length === 1) {
    const ids = idsDe(listas[0].result)
    if (ids?.length && ids.length <= MAX_INVITADOS) {
      const b = await resolverListaInvitados({ guest_ids: ids }, invitationId)
      return b.error ? [] : [b]
    }
  }

  if (usadas.some(e => e.tool === 'get_tables_occupancy')) {
    return [await resolverBarra({ subtipo: 'mesas' }, invitationId)]
  }

  const conSides   = usadas.some(e => e.tool === 'get_side_events_summary')
  const conResumen = usadas.some(e => e.tool === 'get_event_summary')
  const bloques = []
  // "Mis side events" a veces también pide el resumen general: si el mensaje
  // es de side events, solo se muestran ellos.
  if (conResumen && !(conSides && /side\s*event|evento(s)? adicional/i.test(mensaje))) {
    bloques.push({ tipo: 'resumen_rsvp', titulo: null, ...(await conteoPorEstado(invitationId)) })
  }
  if (conSides) {
    const b = await resolverSideEvents({}, invitationId)
    if (!b.error) bloques.push(b)
  }
  return bloques
}

module.exports = { BLOQUE_TOOL, resolverBloque, bloqueComoTexto, bloquesAutomaticos, MAX_BLOQUES_POR_RESPUESTA }
