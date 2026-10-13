// models/lia.invitacion.js
// ============================================================
// Modo agente de Lia sobre la invitación (editor /dashboard/build).
//
// El modelo solo dice QUÉ cambia (sección + lista de cambios); el front lo
// actúa en pantalla con un cursor de Lia: abre el editor, hace clic y
// escribe. Nada se guarda desde aquí: los cambios quedan como borrador en el
// editor y publicar es decisión del organizador.
//
// Cada sección editable se declara en SECCIONES (los campos que Lia puede
// tocar, su tipo y sus límites). Abrir una sección nueva es agregarla aquí y
// en el mapa del front (src/modules/Invitation/Build/LiaAgent/liaAgentMapa.js).
//
// editar_invitacion es "terminal": el texto que el modelo escribe antes de
// llamarla es la respuesta, sin otra vuelta al modelo.
//
// ESTRUCTURA describe TODA la invitación (también lo que Lia no edita) para
// que entienda a qué se refiere el organizador; resumenInvitacion la convierte
// en un texto corto (sin imágenes ni estilos) que va como contexto mientras
// el organizador está en el editor.
//
// redactar_texto: las acciones las hace GPT; cuando hay que escribir o
// mejorar un texto, GPT se lo pide a Sonnet con esta herramienta (Sonnet solo
// redacta, nunca ejecuta acciones).
// ============================================================

const supabase = require('../config/supabase')
const { anthropic, AI_MODELS, calculateCost, tokensDeEntradaAnthropic } = require('../config/ai.config')
const { PALETAS, paletaPorNombre, paletaDeColores, catalogoParaPrompt } = require('../config/paletasColor')

const MAX_CAMBIOS = 6

// tipo 'texto'        → op cambiar con valor string
// tipo 'activo'       → op cambiar con valor boolean (prender/apagar la sección)
// tipo 'lista_texto'  → ops agregar (valor), cambiar (indice + valor), quitar (indice)
// Secciones que solo tienen título (y a veces descripción) de texto.
const seccionDeTextos = (id, nombre, { descripcion = false, maxDescripcion = 800 } = {}) => ({
  nombre,
  ayuda: `title (texto, título de la sección)${descripcion ? ', description (texto, descripción de la sección)' : ''}, active (true/false)`,
  campos: {
    active: { tipo: 'activo' },
    title:  { tipo: 'texto', max: 80, actual: (d) => d?.[id]?.title },
    ...(descripcion ? { description: { tipo: 'texto', max: maxDescripcion, actual: (d) => d?.[id]?.description } } : {}),
  },
  leer: (data) => ({
    activa: !!data?.[id]?.active,
    title: data?.[id]?.title ?? '',
    ...(descripcion ? { description: data?.[id]?.description ?? '' } : {}),
  }),
})

// `ayuda` es lo que el modelo lee en la descripción de editar_invitacion.
const SECCIONES = {
  greeting: {
    nombre: 'Bienvenida',
    ayuda: 'title (texto, título de bienvenida), description (texto, mensaje de bienvenida), active (true/false)',
    campos: {
      active:      { tipo: 'activo' },
      title:       { tipo: 'texto', max: 120, actual: (d) => d?.greeting?.title },
      description: { tipo: 'texto', max: 1500, actual: (d) => d?.greeting?.description },
    },
    leer: (data) => ({
      activa: !!data?.greeting?.active,
      title: data?.greeting?.title ?? '',
      description: data?.greeting?.description ?? '',
    }),
  },
  quote: {
    nombre: 'Cita',
    ayuda: 'texto (la frase o cita de la sección Cita, puede incluir su autor o referencia), active (true/false)',
    campos: {
      active: { tipo: 'activo' },
      texto:  { tipo: 'texto', max: 600, actual: (d) => d?.quote?.text?.font?.value },
    },
    leer: (data) => ({
      activa: !!data?.quote?.active,
      texto: data?.quote?.text?.font?.value ?? '',
    }),
  },
  cover: {
    nombre: 'Portada',
    ayuda: 'title (texto, los nombres que aparecen en la portada), fecha (YYYY-MM-DD, la de la cuenta regresiva). La imagen y la canción no las cambias',
    campos: {
      title: { tipo: 'texto', max: 60, actual: (d) => d?.cover?.title?.text?.value },
      fecha: { tipo: 'fecha' },
    },
    leer: (data) => ({
      title: data?.cover?.title?.text?.value ?? '',
      fecha: String(data?.cover?.date?.value ?? '').slice(0, 10) || null,
    }),
  },
  people: {
    ...seccionDeTextos('people', 'Personas'),
    ayuda: 'title (texto, título de la sección), personas (lista; cada persona tiene title = rol como "Madre de la novia" y description = nombre: agregar con valor {title, description}, cambiar con indice y valor con lo que cambia, quitar con indice), active (true/false)',
    campos: {
      ...seccionDeTextos('people', 'Personas').campos,
      personas: { tipo: 'lista_objetos', subcampos: { title: 60, description: 120 }, maxItems: 20 },
    },
    leer: (data) => ({
      activa: !!data?.people?.active,
      title: data?.people?.title ?? '',
      personas: (data?.people?.personas ?? []).map((p, i) => ({ indice: i, rol: p?.title ?? '', nombre: p?.description ?? '' })),
    }),
  },
  itinerary: {
    ...seccionDeTextos('itinerary', 'Itinerario'),
    ayuda: 'title (texto, título de la sección), momentos (cambiar con indice y valor {name, time}: nombre del momento y hora "17:30" o "5:30 pm"; no se agregan ni quitan, y la dirección o imagen no las cambias), active (true/false)',
    campos: {
      ...seccionDeTextos('itinerary', 'Itinerario').campos,
      momentos: { tipo: 'momentos', clave: 'object' },
    },
    leer: (data) => ({
      activa: !!data?.itinerary?.active,
      title: data?.itinerary?.title ?? '',
      momentos: (data?.itinerary?.object ?? []).map((m, i) => ({ indice: i, name: m?.name ?? '', time: m?.time ?? null, lugar: m?.subtext ?? null })),
    }),
  },
  dresscode:    seccionDeTextos('dresscode', 'Dress code', { descripcion: true }),
  gifts: {
    ...seccionDeTextos('gifts', 'Mesa de regalos', { descripcion: true }),
    ayuda: 'title, description (textos), cards (máximo 3 en total; agregar con valor {tipo: "tienda" | "banco", marca: una del catálogo, titular: si es banco}; cambiar con indice y valor {marca, titular} para cambiar el banco/tienda de una tarjeta existente; quitarlas, links y números de cuenta los hace el organizador), active (true/false)',
    campos: {
      ...seccionDeTextos('gifts', 'Mesa de regalos', { descripcion: true }).campos,
      cards: { tipo: 'tarjetas_regalo', maxItems: 3 },
    },
    leer: (data, cat) => ({
      activa: !!data?.gifts?.active,
      title: data?.gifts?.title ?? '',
      description: data?.gifts?.description ?? '',
      tarjetas: (data?.gifts?.cards ?? []).map((c, i) => ({ indice: i, ...(c?.kind === 'bank' ? { tipo: 'banco', marca: c.bank, titular: c.name } : { tipo: 'tienda', marca: c?.brand }) })),
      catalogo: cat ? { tiendas: cat.marcas.filter(m => m.kind === 'store').map(m => m.name), bancos: cat.marcas.filter(m => m.kind === 'bank').map(m => m.name) } : undefined,
    }),
  },
  destinations: seccionDeTextos('destinations', 'Destinos', { descripcion: true }),
  gallery:      seccionDeTextos('gallery', 'Galería'),
  generals: {
    nombre: 'Generales',
    ayuda: 'paleta (cambiar con el NOMBRE de una paleta del catálogo; nunca colores sueltos ni hex), textura (cambiar con el nombre de una textura del catálogo o "ninguna"), orden (cambiar con la lista COMPLETA de secciones en el orden nuevo: greeting, people, quote, itinerary, dresscode, gifts, destinations, notices, gallery). Fuentes no',
    campos: {
      paleta:  { tipo: 'paleta' },
      textura: { tipo: 'textura' },
      orden:   { tipo: 'orden' },
    },
    leer: (data, cat) => ({
      paleta: paletaDeColores(data?.generals?.colors)?.name ?? 'personalizada (no es del catálogo)',
      paletas_disponibles: PALETAS.map(p => `${p.name} (${p.keywords.join(', ')})`),
      textura: cat?.texturas.find(t => t.id === data?.generals?.texture)?.name ?? 'ninguna',
      orden: (data?.generals?.positions ?? []).map(i => ESTRUCTURA.find(e => e.indice === i)?.id).filter(Boolean),
      texturas_disponibles: cat?.texturas.map(t => t.name),
    }),
  },
  notices: {
    nombre: 'Avisos',
    ayuda: 'title (texto, título de la sección), notices (lista de avisos de texto: agregar con valor, cambiar con indice y valor, quitar con indice), active (true/false)',
    campos: {
      active:  { tipo: 'activo' },
      title:   { tipo: 'texto', max: 80, actual: (d) => d?.notices?.title },
      notices: { tipo: 'lista_texto', max: 400, maxItems: 12 },
    },
    leer: (data) => ({
      activa: !!data?.notices?.active,
      title: data?.notices?.title ?? '',
      notices: (data?.notices?.notices ?? []).map((n, i) => ({ indice: i, texto: n ?? '' })),
    }),
  },
}

const SECCIONES_IDS = Object.keys(SECCIONES)

// ---- Estilo de los títulos de sección ----
// Lo decide la tipografía de los títulos (generals.fonts.titles):
// - manuscrita (categoría 'handwriting' en la tabla fonts): mayúscula
//   inicial, nunca todo en MAYÚSCULAS (en script no se lee);
// - cualquier otra: se puede jugar con mayúsculas; se sigue el estilo que ya
//   tienen la mayoría de los títulos, para que todos vayan iguales.
// Se fuerza aquí, no se le deja al modelo.
const SECCIONES_CON_TITULO = ['greeting', 'people', 'itinerary', 'dresscode', 'gifts', 'destinations', 'notices', 'gallery']
const esMayusculas = (t) => /[a-záéíóúñ]/i.test(t) && t === t.toUpperCase()

const estiloDeTitulos = (titulos = [], { manuscrita = false } = {}) => {
  if (manuscrita) return 'oracion'
  const conTexto = titulos.map(t => String(t ?? '').trim()).filter(Boolean)
  if (!conTexto.length) return 'normal'
  return conTexto.filter(esMayusculas).length * 2 >= conTexto.length ? 'mayusculas' : 'normal'
}

const titulosDe = (data) => SECCIONES_CON_TITULO.map(id => data?.[id]?.title)

// "MESA DE REGALOS" → "Mesa de regalos" (respeta ¡ ¿ y comillas al inicio)
const aOracion = (t) => {
  if (!esMayusculas(t)) return t
  return t.toLocaleLowerCase('es-MX').replace(/^([¡¿"'«\s]*)(\p{L})/u, (_, previo, letra) => previo + letra.toLocaleUpperCase('es-MX'))
}

const conEstiloDeTitulo = (texto, estilo) => (
  estilo === 'mayusculas' ? texto.toLocaleUpperCase('es-MX')
    : estilo === 'oracion' ? aOracion(texto)
      : texto
)

const esManuscrita = (familia, categorias = {}) => categorias[familia] === 'handwriting'

// Estilo para los títulos de una invitación (data completa)
const estiloDeInvitacion = (data, categorias) =>
  estiloDeTitulos(titulosDe(data), { manuscrita: esManuscrita(data?.generals?.fonts?.titles?.typeFace, categorias) })

const corto = (texto, max = 160) => {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

// Toda la invitación, en el orden del editor. `positions` de generals ordena
// las secciones con su índice (1 = greeting … 9 = gallery); portada y
// generales siempre van primero.
const ESTRUCTURA = [
  { id: 'cover', nombre: 'Portada', indice: 0, que: 'título (nombres), fecha del evento con cuenta regresiva, canción de fondo, imagen de fondo',
    resumen: (d) => `título "${corto(d?.title?.text?.value, 80)}"; fecha ${String(d?.date?.value ?? '').slice(0, 10) || 'sin fecha'}; canción ${d?.song?.name ? `"${d.song.name}" de ${d.song.artist}` : 'ninguna'}` },
  { id: 'greeting', nombre: 'Bienvenida', indice: 1, que: 'título y mensaje de bienvenida',
    resumen: (d) => `título "${corto(d?.title, 80)}"; mensaje "${corto(d?.description)}"` },
  { id: 'people', nombre: 'Personas (padres, padrinos)', indice: 2, que: 'título y lista de personas (rol y nombre)',
    resumen: (d) => `título "${corto(d?.title, 60)}"; ${(d?.personas ?? []).filter(p => p?.description && p.description.trim() !== '&').map(p => `${corto(p.title, 40) || 'sin rol'}: ${corto(p.description, 60)}`).join(' · ') || 'sin personas'}` },
  { id: 'quote', nombre: 'Cita', indice: 3, que: 'una frase o cita (puede ser bíblica, de un autor, de los novios) sobre una imagen',
    resumen: (d) => `"${corto(d?.text?.font?.value, 200)}"` },
  { id: 'itinerary', nombre: 'Itinerario', indice: 4, que: 'momentos del evento (ceremonia, recepción…) con hora, lugar y dirección',
    resumen: (d) => `título "${corto(d?.title, 60)}"; ${(d?.object ?? []).map(m => `${corto(m?.name, 40)} ${m?.time ?? ''} en ${corto(m?.subtext, 50) || 'sin lugar'}`).join(' · ') || 'sin momentos'}` },
  { id: 'dresscode', nombre: 'Dress code', indice: 5, que: 'título, descripción del código de vestimenta, colores sugeridos, links e imágenes de referencia',
    resumen: (d) => `título "${corto(d?.title, 60)}"; "${corto(d?.description)}"; colores ${(d?.colors ?? []).join(', ') || 'ninguno'}` },
  { id: 'gifts', nombre: 'Mesa de regalos', indice: 6, que: 'título, descripción y tarjetas de regalo (tiendas con link o cuentas bancarias)',
    resumen: (d) => `título "${corto(d?.title, 60)}"; "${corto(d?.description)}"; tarjetas ${(d?.cards ?? []).map((c, i) => c?.kind === 'bank' ? `[${i}] banco ${c.bank ?? ''} a nombre de ${c.name ?? '—'}` : `[${i}] tienda ${c?.brand ?? ''}`).join(' · ') || 'ninguna'}` },
  { id: 'destinations', nombre: 'Destinos (hospedaje y lugares)', indice: 7, que: 'título, descripción y tarjetas de hoteles y actividades recomendadas',
    resumen: (d) => `título "${corto(d?.title, 60)}"; "${corto(d?.description)}"; ${(d?.cards ?? []).map(c => `${corto(c?.name, 40)} (${c?.type === 'hotel' ? 'hotel' : 'actividad'})`).join(' · ') || 'sin tarjetas'}` },
  { id: 'notices', nombre: 'Avisos', indice: 8, que: 'título y lista de avisos de texto para los invitados',
    resumen: (d) => `título "${corto(d?.title, 60)}"; ${(d?.notices ?? []).map((n, i) => `[${i}] "${corto(n, 120)}"`).join(' ') || 'sin avisos'}` },
  { id: 'gallery', nombre: 'Galería', indice: 9, que: 'título y fotos',
    resumen: (d) => `título "${corto(d?.title, 60)}"; ${(d?.prod ?? d?.dev ?? []).length} fotos` },
]
const ESTRUCTURA_IDS = ESTRUCTURA.map(e => e.id)

const resumenGenerales = (g) => {
  if (!g) return null
  const c = g.colors ?? {}
  const orden = (g.positions ?? []).map(i => ESTRUCTURA.find(e => e.indice === i)?.id).filter(Boolean).join(', ')
  return `orden actual de secciones: ${orden || '—'}; tipo de evento ${g.event?.label ?? '—'}; paleta ${paletaDeColores(c)?.name ?? 'personalizada'}; fuentes: títulos ${g.fonts?.titles?.typeFace ?? '—'}, cuerpo ${g.fonts?.body?.typeFace ?? '—'}; textura ${g.texture ?? 'ninguna'}`
}

// Texto corto con todo lo que tiene la invitación, en el orden en que la ve
// el invitado. Marca qué secciones están apagadas y cuáles edita Lia.
const resumenInvitacion = (data) => {
  if (!data) return null
  const orden = data.generals?.positions ?? []
  const porIndice = (e) => (e.indice === 0 ? -1 : orden.indexOf(e.indice) === -1 ? 99 : orden.indexOf(e.indice))
  const lineas = [...ESTRUCTURA]
    .sort((a, b) => porIndice(a) - porIndice(b))
    .filter(e => data[e.id])
    .map(e => {
      const d = data[e.id]
      const estado = e.id === 'cover' || d.active !== false ? '' : ' (APAGADA)'
      const edita = SECCIONES[e.id] ? ' [Lia la edita]' : ''
      return `- ${e.id} · ${e.nombre}${estado}${edita}: ${e.resumen(d)}`
    })
  const generales = resumenGenerales(data.generals)
  return [...lineas, generales ? `- generals · Generales: ${generales}` : null].filter(Boolean).join('\n')
}

const LEER_INVITACION_TOOL = {
  name: 'leer_invitacion',
  description: `Lee la invitación: lo que el organizador tiene en el editor si está ahí (con cambios sin publicar), o lo publicado. Sin seccion devuelve un resumen de TODA la invitación (todas las secciones, cuáles están apagadas, orden, colores y fuentes); con seccion devuelve el detalle de una sección que Lia edita (con índices). Si el mensaje trae CONTEXTO DE LA INVITACIÓN no hace falta llamarla para entender qué hay.
Partes de una invitación:
${ESTRUCTURA.map(e => `- ${e.id} (${e.nombre}): ${e.que}`).join('\n')}
- generals (Generales): tipo de evento, paleta de colores, fuentes, textura y orden de las secciones`,
  input_schema: {
    type: 'object',
    properties: {
      seccion: { type: 'string', enum: SECCIONES_IDS, description: 'Opcional: sin ella, resumen de toda la invitación' },
    },
  },
}

const REDACTAR_TEXTO_TOOL = {
  name: 'redactar_texto',
  description: 'Pide a la redactora de I attend un texto para la invitación. Úsala SIEMPRE que haya que escribir, mejorar, acortar o cambiar el tono de un texto, o elegir uno (una cita bíblica, una frase, un aviso), y en la siguiente respuesta ponlo con editar_invitacion sin cambiarlo. No escribas tú textos de la invitación.',
  input_schema: {
    type: 'object',
    properties: {
      seccion:     { type: 'string', enum: ESTRUCTURA_IDS, description: 'Dónde va el texto' },
      campo:       { type: 'string', description: 'Qué texto es (title, description, texto, un aviso…)' },
      instruccion: { type: 'string', description: 'Lo que pidió el organizador, con sus palabras' },
      texto_actual: { type: 'string', description: 'El texto que hay ahora, si se va a mejorar o cambiar' },
    },
    required: ['seccion', 'instruccion'],
  },
}

const EDITAR_INVITACION_TOOL = {
  name: 'editar_invitacion',
  description: `Edita la invitación en el editor, a la vista del organizador: Lia abre el editor y hace los cambios en pantalla; quedan en el borrador del editor. No guarda ni publica nada, y no le sugieras publicar.
Escribe primero una frase corta y en futuro inmediato ("Va, lo agrego; mira la pantalla.") y llama la herramienta en esa MISMA respuesta. Nunca anuncies un cambio ("voy a hacerlo", "procedo") sin llamarla. No digas que ya quedó.
Secciones y campos (active prende o apaga la sección):
${Object.entries(SECCIONES).map(([id, s]) => `- ${id} (${s.nombre}): ${s.ayuda}`).join('\n')}
Edita la sección que el organizador nombra ("la cita" es quote, "la bienvenida" es greeting, "los avisos" es notices, "los padres/padrinos" es people, "el dress code" es dresscode, "la mesa de regalos" es gifts, "hospedaje/destinos" es destinations, "la portada" es cover, "colores/paleta/textura/orden de secciones" es generals; los colores solo cambian eligiendo una paleta del catálogo); no pongas en una sección lo que pidió para otra. Lo que no está en esta lista (imágenes, canción, direcciones, tarjetas de destinos, colores y links del dress code, fuentes) no lo editas.
"Paleta", "colores de la invitación", "tonos", "que se vea en colores de X" o una temporada/estilo de colores ("de primavera", "más cálidos") = generals paleta, NUNCA dresscode. El dress code solo si habla de vestimenta, ropa o cómo ir vestidos; y si habla del dress code (aunque mencione colores), cambia solo el dress code, no la paleta.
Paletas del catálogo (usa el nombre exacto; la palabra clave te ayuda a elegir): ${catalogoParaPrompt()}.
Los índices empiezan en 0 y salen de leer_invitacion. Llámala una sola vez por respuesta, con todos los cambios juntos (máximo ${MAX_CAMBIOS}); si necesitas leer_invitacion, llámala antes, en otro paso, no a la vez.`,
  input_schema: {
    type: 'object',
    properties: {
      seccion: { type: 'string', enum: SECCIONES_IDS },
      cambios: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            op:     { type: 'string', enum: ['agregar', 'cambiar', 'quitar'] },
            campo:  { type: 'string' },
            indice: { type: 'number', description: 'Para cambiar o quitar un elemento de una lista' },
            valor:  { description: 'Según el campo: texto, true/false (active), "YYYY-MM-DD" (fecha), objeto (personas, momentos, cards, colores) o lista de ids (orden)' },
          },
          required: ['op', 'campo'],
        },
      },
    },
    required: ['seccion', 'cambios'],
  },
}

// Si el organizador está en el editor, el chat manda su borrador (lo que ve
// en pantalla, con cambios sin publicar). Es lo que Lia debe leer: los
// índices de sus cambios se aplican sobre ese borrador, no sobre lo publicado.
// Solo se aceptan las secciones editables y un tamaño razonable.
const limpiarBorrador = (borrador) => {
  if (!borrador || typeof borrador !== 'object' || Array.isArray(borrador)) return null
  const limpio = {}
  for (const id of [...ESTRUCTURA_IDS, 'generals']) {
    if (borrador[id] && typeof borrador[id] === 'object' && !Array.isArray(borrador[id])) limpio[id] = borrador[id]
  }
  if (!Object.keys(limpio).length || JSON.stringify(limpio).length > 150_000) return null
  return limpio
}

const leerData = async (invitationId, borrador) => {
  if (borrador) return borrador
  const { data, error } = await supabase
    .from('invitations')
    .select('data')
    .eq('id', invitationId)
    .maybeSingle()
  if (error) throw error
  return data?.data ?? null
}

const resolverLeerInvitacion = async ({ seccion } = {}, invitationId, borrador) => {
  if (!seccion) {
    const data = await leerData(invitationId, borrador)
    if (!data) return { error: 'No encontré la invitación.' }
    return {
      invitacion: resumenInvitacion(data),
      nota: borrador ? 'Lo que el organizador tiene ahora en el editor.' : 'Lo publicado.',
    }
  }
  const def = SECCIONES[seccion]
  if (!def) return { error: `Sección no disponible. Opciones: ${SECCIONES_IDS.join(', ')}` }
  const conBorrador = !!borrador?.[seccion]
  const data = await leerData(invitationId, conBorrador ? borrador : null)
  if (!data) return { error: 'No encontré la invitación.' }
  const cat = ['gifts', 'generals'].includes(seccion) ? await leerCatalogos() : null
  return {
    seccion,
    ...def.leer(data, cat),
    nota: conBorrador
      ? 'Esto es lo que el organizador tiene ahora en el editor (incluye cambios sin publicar).'
      : 'Esto es lo publicado.',
  }
}

// ---- redactar_texto: Sonnet solo escribe ----
const REDACTORA_SYSTEM = `Eres la redactora de I attend, una plataforma de invitaciones digitales para bodas y eventos en México.
Escribes textos para la invitación que verán los invitados: cálidos, claros, sin clichés exagerados ni emojis (salvo que lo pidan).
Responde SOLO con el texto final, sin comillas, sin explicaciones ni opciones. Respeta el idioma de la invitación (español salvo que pidan otro).
Si te piden una cita bíblica o de un autor, usa una real y pon la referencia al final ("— 1 Corintios 13:4"). No inventes datos del evento (fechas, lugares, nombres) que no te den.`

const LARGO_MAXIMO = (seccion, campo) => SECCIONES[seccion]?.campos?.[campo]?.max ?? 400

const resolverRedactarTexto = async ({ seccion, campo, instruccion, texto_actual } = {}, invitationId, borrador) => {
  if (!instruccion) return { error: 'Falta la instrucción.' }
  const data = await leerData(invitationId, borrador).catch(() => null)
  const max = LARGO_MAXIMO(seccion, campo)
  const nombre = ESTRUCTURA.find(e => e.id === seccion)?.nombre ?? seccion
  const contexto = [
    `Evento: ${data?.generals?.event?.label ?? 'boda'}; ${data?.cover?.title?.text?.value ? `de ${data.cover.title.text.value}` : ''}`,
    `Sección: ${nombre}${campo ? ` (campo ${campo})` : ''}. Máximo ${max} caracteres.`,
    campo === 'title' ? `Es un título de sección: corto (1 a 4 palabras), sin paréntesis.` : null,
    texto_actual ? `Texto actual: ${String(texto_actual).slice(0, 1500)}` : null,
    `Pedido del organizador: ${String(instruccion).slice(0, 600)}`,
  ].filter(Boolean).join('\n')

  const r = await anthropic.messages.create({
    model: AI_MODELS.SONNET,
    max_tokens: 500,
    system: REDACTORA_SYSTEM,
    messages: [{ role: 'user', content: contexto }],
  }, { timeout: 30 * 1000, maxRetries: 1 })

  let texto = r.content.filter(b => b.type === 'text').map(b => b.text).join('').trim().replace(/^["“]|["”]$/g, '')
  if (!texto) return { error: 'No se pudo redactar el texto.' }
  const tokensIn = tokensDeEntradaAnthropic(r.usage)
  const tokensOut = r.usage.output_tokens
  const ETIQUETAS = { title: 'título', description: 'descripción', texto: 'texto', notices: 'aviso' }
  if (campo === 'title' && SECCIONES_CON_TITULO.includes(seccion)) {
    const { categorias } = await leerCatalogos()
    texto = conEstiloDeTitulo(texto, estiloDeInvitacion(data, categorias))
  }
  return {
    texto: texto.slice(0, max),
    nota: 'Ponlo tal cual con editar_invitacion. Ya se le muestra al organizador en un bloque con botón de copiar: no lo repitas en tu respuesta.',
    // Tarjeta con el texto y su botón de copiar (LiaBlocks.jsx, tipo texto)
    bloque: { tipo: 'texto', titulo: `${nombre}${campo ? ` · ${ETIQUETAS[campo] ?? campo}` : ''}`, texto: texto.slice(0, max) },
    _uso: { modelo: AI_MODELS.SONNET, tokensIn, tokensOut, costoUsd: calculateCost(AI_MODELS.SONNET, tokensIn, tokensOut) },
  }
}

// ---- Catálogos que el modelo nombra con palabras ----
const leerCatalogos = async () => {
  const [{ data: marcas }, { data: texturas }, { data: fuentes }] = await Promise.all([
    supabase.from('gift_brands').select('kind, name').order('kind').order('sort_order'),
    supabase.from('textures').select('id, name').eq('is_active', true).order('sort_order'),
    supabase.from('fonts').select('family, category'),
  ])
  const categorias = Object.fromEntries((fuentes ?? []).map(f => [f.family, String(f.category ?? '').toLowerCase()]))
  return { marcas: marcas ?? [], texturas: texturas ?? [], categorias }
}

const normal = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

// Índice de cada sección en generals.positions (el orden del editor)
const INDICE_DE = Object.fromEntries(ESTRUCTURA.filter(e => e.indice > 0).map(e => [e.id, e.indice]))


// "17:30", "5:30 pm", "5 pm" → "5:30 pm" (el formato que guarda el editor)
const horaDeItinerario = (valor) => {
  const m = String(valor ?? '').trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/)
  if (!m) return null
  let h = +m[1]
  const min = m[2] ?? '00'
  const sufijo = m[3]?.replace(/\./g, '')
  if (+min > 59 || h > 23) return null
  if (sufijo) {
    if (h < 1 || h > 12) return null
    return `${h}:${min} ${sufijo}`
  }
  const pm = h >= 12
  h = h % 12 || 12
  return `${h}:${min} ${pm ? 'pm' : 'am'}`
}

const fechaDePortada = (valor) => {
  const m = String(valor ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null
  return `${m[1]}-${m[2]}-${m[3]}T00:00:00`
}

const recortar = (t, max) => (typeof t === 'string' ? t.trim().slice(0, max) : null)

// Limpia cada cambio contra la definición de la sección. Lo que no cuadra se
// le regresa al modelo como error en vez de mandarlo a la pantalla.
const limpiarCambio = async (def, cambio, cat, data, seccion) => {
  const campo = def.campos[cambio?.campo]
  if (!campo) return { error: `Campo "${cambio?.campo}" no editable. Campos: ${Object.keys(def.campos).join(', ')}` }
  const { op } = cambio
  const indice = Number(cambio.indice)
  const conIndice = Number.isInteger(indice) && indice >= 0
  const base = { op, campo: cambio.campo }
  const texto = typeof cambio.valor === 'string' ? cambio.valor.trim() : null

  switch (campo.tipo) {
    case 'activo':
      if (op !== 'cambiar' || typeof cambio.valor !== 'boolean') return { error: `${cambio.campo}: usa op "cambiar" con valor true o false.` }
      return { ...base, valor: cambio.valor }

    case 'texto':
      if (op !== 'cambiar' || !texto) return { error: `${cambio.campo}: usa op "cambiar" con un texto.` }
      if (campo.actual && normal(campo.actual(data)) === normal(texto)) {
        return { error: `${cambio.campo}: ese ya es el texto actual. No hagas un cambio que no pidió; si no puedes hacer lo que pidió, díselo.` }
      }
      // Títulos de sección: mismo estilo que el resto de la invitación
      if (cambio.campo === 'title' && SECCIONES_CON_TITULO.includes(seccion)) {
        return { ...base, valor: conEstiloDeTitulo(texto, estiloDeInvitacion(data, cat.categorias)).slice(0, campo.max) }
      }
      return { ...base, valor: texto.slice(0, campo.max) }

    case 'lista_texto':
      if (op === 'agregar') return texto ? { ...base, valor: texto.slice(0, campo.max) } : { error: `${cambio.campo}: agregar necesita el texto en valor.` }
      if (op === 'cambiar') return conIndice && texto ? { ...base, indice, valor: texto.slice(0, campo.max) } : { error: `${cambio.campo}: cambiar necesita indice y valor.` }
      if (op === 'quitar') return conIndice ? { ...base, indice } : { error: `${cambio.campo}: quitar necesita indice.` }
      break

    case 'lista_objetos': {
      const v = cambio.valor && typeof cambio.valor === 'object' ? cambio.valor : {}
      const valor = {}
      for (const [sub, max] of Object.entries(campo.subcampos)) {
        const t = recortar(v[sub], max)
        if (t != null) valor[sub] = t
      }
      if (op === 'agregar') return Object.keys(valor).length ? { ...base, valor } : { error: `${cambio.campo}: agregar necesita valor con ${Object.keys(campo.subcampos).join(' y/o ')}.` }
      if (op === 'cambiar') return conIndice && Object.keys(valor).length ? { ...base, indice, valor } : { error: `${cambio.campo}: cambiar necesita indice y valor con ${Object.keys(campo.subcampos).join(' y/o ')}.` }
      if (op === 'quitar') return conIndice ? { ...base, indice } : { error: `${cambio.campo}: quitar necesita indice.` }
      break
    }

    case 'momentos': {
      if (op !== 'cambiar' || !conIndice) return { error: 'momentos: solo op "cambiar" con indice (no se agregan ni quitan momentos).' }
      const v = cambio.valor && typeof cambio.valor === 'object' ? cambio.valor : {}
      const valor = {}
      if (v.name != null) valor.name = recortar(v.name, 60)
      if (v.time != null) {
        valor.time = horaDeItinerario(v.time)
        if (!valor.time) return { error: 'momentos: hora no válida; usa HH:mm (24 h) o "5:30 pm".' }
      }
      return Object.keys(valor).length ? { ...base, indice, valor } : { error: 'momentos: valor necesita name y/o time.' }
    }

    case 'fecha': {
      const valor = op === 'cambiar' ? fechaDePortada(cambio.valor) : null
      return valor ? { ...base, valor } : { error: 'fecha: usa op "cambiar" con la fecha YYYY-MM-DD.' }
    }

    case 'tarjetas_regalo': {
      const v = cambio.valor && typeof cambio.valor === 'object' ? cambio.valor : {}
      if (op === 'cambiar') {
        // Cambiar el banco o la tienda (y el titular) de una tarjeta que ya
        // existe, sin cambiar su tipo. Links y números no se tocan.
        const actual = conIndice ? data?.gifts?.cards?.[indice] : null
        if (!actual) return { error: 'cards: cambiar necesita el indice de una tarjeta existente.' }
        const kindActual = actual.kind === 'bank' ? 'bank' : 'store'
        const valor = {}
        if (v.marca != null) {
          const disponibles = cat.marcas.filter(m => m.kind === kindActual)
          const marca = disponibles.find(m => normal(m.name) === normal(v.marca))
          if (!marca) return { error: `cards: marca no disponible para una tarjeta de ${kindActual === 'bank' ? 'banco' : 'tienda'}: ${disponibles.map(m => m.name).join(', ')}. Una tarjeta no cambia de tienda a banco.` }
          valor[kindActual === 'bank' ? 'bank' : 'brand'] = marca.name
        }
        if (v.titular != null && kindActual === 'bank') valor.name = recortar(v.titular, 80)
        return Object.keys(valor).length ? { ...base, indice, valor } : { error: 'cards: cambiar necesita valor con marca y/o titular.' }
      }
      if (op !== 'agregar') return { error: 'cards: puedes agregar tarjetas o cambiar la marca/titular de una; quitarlas lo hace el organizador.' }
      const kind = v.tipo === 'banco' ? 'bank' : v.tipo === 'tienda' ? 'store' : null
      if (!kind) return { error: 'cards: valor.tipo debe ser "tienda" o "banco".' }
      const disponibles = cat.marcas.filter(m => m.kind === kind)
      const marca = disponibles.find(m => normal(m.name) === normal(v.marca))
      if (!marca) return { error: `cards: marca no disponible. ${kind === 'bank' ? 'Bancos' : 'Tiendas'}: ${disponibles.map(m => m.name).join(', ')}.` }
      return {
        ...base,
        valor: kind === 'bank'
          ? { kind, bank: marca.name, brand: null, name: recortar(v.titular, 80) || null, url: null, number: null }
          : { kind, brand: marca.name, bank: null, name: null, url: null, number: null },
      }
    }

    case 'paleta': {
      // Solo paletas del catálogo (la colección de Generales): Lia nunca
      // inventa colores.
      if (op !== 'cambiar') return { error: 'paleta: usa op "cambiar" con el nombre de una paleta.' }
      const paleta = paletaPorNombre(cambio.valor)
      if (!paleta) return { error: `paleta: usa una del catálogo, por nombre: ${PALETAS.map(p => p.name).join(', ')}.` }
      const { primary, secondary, accent, actions } = paleta
      // `nombre` es para el registro de lo hecho (⟦HECHO⟧): con los hex, Lia
      // luego no sabría qué paleta puso.
      return { ...base, valor: { primary, secondary, accent, actions }, nombre: paleta.name }
    }

    case 'textura': {
      if (op !== 'cambiar') return { error: 'textura: usa op "cambiar".' }
      if (cambio.valor == null || normal(cambio.valor) === 'ninguna') return { ...base, valor: null }
      const t = cat.texturas.find(x => normal(x.name) === normal(cambio.valor) || String(x.id) === String(cambio.valor))
      return t ? { ...base, valor: t.id } : { error: `textura: no existe. Disponibles: ${cat.texturas.map(x => x.name).join(', ')} o "ninguna".` }
    }

    case 'orden': {
      if (op !== 'cambiar' || !Array.isArray(cambio.valor)) return { error: 'orden: usa op "cambiar" con la lista completa de secciones en el orden nuevo.' }
      const actual = data?.generals?.positions ?? []
      const valor = cambio.valor.map(id => INDICE_DE[id])
      if (valor.some(v => v == null)) return { error: `orden: usa estos ids: ${Object.keys(INDICE_DE).join(', ')}.` }
      const mismas = valor.length === actual.length && [...valor].sort().join() === [...actual].sort().join()
      return mismas ? { ...base, valor } : { error: `orden: manda TODAS las secciones (${actual.map(i => Object.keys(INDICE_DE).find(k => INDICE_DE[k] === i)).join(', ')}) en el orden nuevo, sin repetir.` }
    }
  }

  return { error: `Operación "${op}" no válida para ${cambio.campo}.` }
}

const resolverEditarInvitacion = async ({ seccion, cambios } = {}, invitationId, borrador) => {
  const def = SECCIONES[seccion]
  if (!def) return { error: `Sección no disponible. Opciones: ${SECCIONES_IDS.join(', ')}` }
  if (!Array.isArray(cambios) || !cambios.length) return { error: 'Faltan los cambios.' }
  if (cambios.length > MAX_CAMBIOS) return { error: `Máximo ${MAX_CAMBIOS} cambios por llamada.` }

  // Los índices se validan contra el borrador del editor si llegó (si no,
  // contra lo publicado); el front los vuelve a revisar antes de actuar.
  const data = await leerData(invitationId, borrador?.[seccion] ? borrador : null)
  if (!data) return { error: 'No encontré la invitación.' }
  const cat = await leerCatalogos()

  const limpios = []
  for (const cambio of cambios) {
    const limpio = await limpiarCambio(def, cambio, cat, data, seccion)
    if (limpio.error) return limpio
    limpios.push(limpio)
  }

  for (const c of limpios) {
    if (c.indice == null) continue
    const clave = def.campos[c.campo].clave ?? c.campo
    const lista = data?.[seccion]?.[clave]
    if (!Array.isArray(lista) || c.indice >= lista.length) {
      return { error: `No existe el elemento ${c.indice} en ${c.campo}. Usa leer_invitacion para ver los índices.` }
    }
  }
  for (const [campo, { clave, maxItems }] of Object.entries(def.campos)) {
    if (!maxItems) continue
    const actuales = data?.[seccion]?.[clave ?? campo]?.length ?? 0
    const netos = limpios.filter(c => c.campo === campo).reduce((n, c) => n + (c.op === 'agregar' ? 1 : c.op === 'quitar' ? -1 : 0), 0)
    if (actuales + netos > maxItems) {
      return {
        error: campo === 'cards'
          ? `La mesa de regalos ya tiene ${actuales} tarjetas y el máximo es ${maxItems}. Dile que para agregar otra primero quite una en el editor (tú no quitas tarjetas).`
          : `${def.nombre} admite máximo ${maxItems} elementos en ${campo}.`,
      }
    }
  }

  return {
    terminal: true,
    ok: true,
    requires_ui_action: true,
    ui_action: { type: 'edit_invitation', payload: { seccion, cambios: limpios } },
  }
}

module.exports = {
  estiloDeTitulos,
  conEstiloDeTitulo,
  LEER_INVITACION_TOOL,
  EDITAR_INVITACION_TOOL,
  REDACTAR_TEXTO_TOOL,
  resolverLeerInvitacion,
  resolverEditarInvitacion,
  resolverRedactarTexto,
  resumenInvitacion,
  limpiarBorrador,
}
