// models/lia.onboarding.js
// ============================================================
// Onboarding "Crea tu invitación con IA" (iattend-vite:
// src/modules/Invitation/Build/LiaOnboarding/). El organizador describe su
// boda y Lia arma un PRIMER BORRADOR: textos, colores, tipografías y orden de
// secciones. Nunca imágenes, tarjetas, itinerario ni datos del evento.
//
// Es redacción, así que va con Sonnet (las acciones nunca van a Sonnet; esto
// no ejecuta nada: el front aplica el plan al borrador del editor y el
// organizador decide si lo guarda). Si la IA falla o regresa algo inválido se
// usa un preset por palabras clave, sin mostrar error.
// ============================================================

const supabase = require('../config/supabase')
const { anthropic, AI_MODELS, calculateCost, tokensDeEntradaAnthropic } = require('../config/ai.config')
const { paletaPorNombre, catalogoParaPrompt } = require('../config/paletasColor')
const { estiloDeTitulos, conEstiloDeTitulo } = require('./lia.invitacion')

const CLAVES_TITULO = ['greeting_title', 'people_title', 'itinerary_title', 'dresscode_title', 'gifts_title', 'destinations_title', 'notices_title', 'gallery_title']

const TEXTOS = [
  'greeting_title', 'greeting_description', 'people_title', 'quote',
  'itinerary_title', 'dresscode_title', 'dresscode_description',
  'gifts_title', 'gifts_description', 'destinations_title',
  'destinations_description', 'notices_title', 'notices', 'gallery_title',
]
const MAX_TEXTO = { greeting_description: 600, dresscode_description: 500, gifts_description: 400, destinations_description: 400, notices: 600, quote: 300 }

const TONOS = ['Romántico', 'Divertido', 'Elegante', 'Sencillo']

// Presets de respaldo. Fuentes entre las más usadas (conteo del Font Lab) y paletas
// del catálogo (config/paletasColor.js): Lia nunca inventa colores.
const PRESETS = [
  { words: ['playa', 'mar', 'atardecer', 'costa', 'arena', 'tulum', 'cancún', 'cancun', 'beach', 'caribe'],
    palette: 'Atardecer Terracota', texture: 'Algodón',
    fonts: { cover: 'WindSong', titles: 'Sedan', body: 'Outfit', quote: 'WindSong' }, positions: [1, 4, 5, 3, 7, 6, 2, 9, 8],
    summary: 'Pensé en una boda descalza al atardecer: tonos arena y terracota, letra ligera y el itinerario arriba. Cambia lo que quieras en el editor.',
    texts: { greeting_title: '¡Nos casamos frente al mar!', greeting_description: 'Con los pies en la arena y el corazón lleno, queremos que seas parte del atardecer en el que diremos «sí, para siempre».', quote: 'Donde termina el mar, empieza nuestra historia.', dresscode_title: 'Formal de playa', dresscode_description: 'Telas ligeras, colores claros y calzado cómodo para la arena. Deja los tacones de aguja en casa.', destinations_description: 'Aprovecha el viaje: te dejamos hoteles, lugares para comer rico y dónde arreglarte antes de la fiesta.' } },
  { words: ['hacienda', 'mariachi', 'campo', 'rancho', 'mexicana', 'tequila', 'tierra', 'cálid', 'calid'],
    palette: 'Elegancia Carmesí', texture: 'Pared',
    fonts: { cover: 'Tangerine', titles: 'Playfair Display', body: 'Kaisei Opti', quote: 'Tangerine' }, positions: [1, 2, 3, 4, 5, 7, 6, 9, 8],
    summary: 'Imaginé una hacienda al caer la tarde: barro, cantera y un rojo de fiesta mexicana, con letras clásicas. Es tu punto de partida, ajústala a tu gusto.',
    texts: { greeting_title: '¡Nos casamos en la hacienda!', greeting_description: 'Entre muros de cantera y luces cálidas, queremos celebrar contigo el día en que unimos nuestras vidas. Que no falte nadie.', quote: 'Lo bueno se cuece a fuego lento, como nuestro amor.', dresscode_description: 'Formal con raíces: guayaberas, rebozos y colores tierra son bienvenidos. Busca ideas en nuestro Pinterest.' } },
  { words: ['jardín', 'jardin', 'boho', 'flores', 'campestre', 'bosque', 'verde', 'viñedo', 'vinedo', 'natural'],
    palette: 'Verde Botánico', texture: 'Flores',
    fonts: { cover: 'Cedarville Cursive', titles: 'Kaisei Opti', body: 'Outfit', quote: 'Cedarville Cursive' }, positions: [1, 3, 4, 2, 5, 9, 6, 7, 8],
    summary: 'Una boda entre flores silvestres: salvia y lino, letras suaves y la galería más arriba. Desde el editor la terminas de hacer tuya.',
    texts: { greeting_title: 'Florecimos juntos', greeting_description: 'Bajo los árboles y entre flores silvestres, te esperamos para celebrar un amor que crece cada día.', quote: 'Contigo, cada estación es primavera.', dresscode_title: 'Jardín formal', dresscode_description: 'Tonos pastel, telas que se muevan y zapatos que no se hundan en el pasto.' } },
  { words: ['moderna', 'moderno', 'minimal', 'ciudad', 'urbana', 'rooftop', 'loft', 'museo', 'industrial', 'blanco y negro'],
    palette: 'Noche Clásica', texture: 'ninguna',
    fonts: { cover: 'Dancing Script', titles: 'Playfair Display', body: 'Noto Sans', quote: 'Dancing Script' }, positions: [1, 4, 2, 5, 6, 3, 7, 9, 8],
    summary: 'Algo limpio y editorial: blanco y negro, mucho aire y una tipografía delgada que deja a tus fotos ser protagonistas. Todo se puede cambiar después.',
    texts: { greeting_title: 'Sí, nos casamos', greeting_description: 'Una noche, la ciudad de fondo y las personas que más queremos. Nos encantaría que estuvieras ahí.', quote: 'Tú y yo, y todo lo demás después.', dresscode_title: 'Black tie', dresscode_description: 'Etiqueta rigurosa: smoking o traje oscuro, vestido largo. El negro siempre es buena idea.' } },
  { words: ['iglesia', 'clásica', 'clasica', 'elegante', 'formal', 'dorado', 'tradicional', 'religiosa', 'catedral'],
    palette: 'Champagne Clásico', texture: 'Papel',
    fonts: { cover: 'WindSong', titles: 'Playfair Display', body: 'Sedan', quote: 'Tangerine' }, positions: [1, 2, 3, 4, 5, 6, 7, 9, 8],
    summary: 'Una boda clásica y elegante: marfil con oro viejo, serif de toda la vida y tus padres al frente. Edítala a tu gusto cuando quieras.',
    texts: { greeting_title: 'Tenemos el honor de invitarte', greeting_description: 'Con la bendición de Dios y de nuestros padres, nos complace invitarte a celebrar nuestra unión matrimonial.', quote: 'El amor es paciente, el amor es bondadoso.', dresscode_title: 'Etiqueta', dresscode_description: 'Vestido largo y traje oscuro. Te pedimos evitar el color blanco.' } },
]

// Elige el preset con más palabras clave; si ninguno coincide (o piden "otra
// versión"), rota con `vuelta` para no repetir siempre el mismo.
const elegirPreset = (texto, vuelta = 0) => {
  const s = String(texto ?? '').toLowerCase()
  let mejor = null
  let puntos = 0
  PRESETS.forEach(p => {
    const n = p.words.filter(w => s.includes(w)).length
    if (n > puntos) { puntos = n; mejor = p }
  })
  if (!mejor || vuelta > 0) return PRESETS[(PRESETS.indexOf(mejor) + 1 + vuelta + PRESETS.length) % PRESETS.length]
  return mejor
}

// Fuentes activas con su uso: el mismo conteo que muestra el Font Lab
// (RPC get_font_usage, invitaciones que usan cada fuente).
const leerFuentes = async () => {
  const [{ data: fuentes }, { data: uso }] = await Promise.all([
    supabase.from('fonts').select('family, category').eq('active', true).order('family'),
    supabase.rpc('get_font_usage'),
  ])
  const usos = Object.fromEntries((uso ?? []).map(u => [u.font_family, u.invitation_count ?? 0]))
  return (fuentes ?? []).map(f => ({ ...f, usos: usos[f.family] ?? 0 }))
}

// Catálogo de texturas (Texture Lab). Lia elige una por nombre o "ninguna".
const leerTexturas = async () => {
  const { data } = await supabase.from('textures').select('id, name').eq('is_active', true).order('sort_order')
  return data ?? []
}

const normal = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

// Lo inválido se descarta (el front conserva lo que ya había)
// `base` = textos actuales (o del borrador si es ajuste); `fuentes` trae la
// categoría de cada familia para saber si la de títulos es manuscrita.
const sanear = (plan, fuentes, texturas = [], base = {}) => {
  if (!plan || typeof plan !== 'object') return null
  const familias = new Set(fuentes.map(f => f.family))
  const out = {
    summary: typeof plan.summary === 'string' ? plan.summary.trim().slice(0, 400) : '',
    texts: {},
  }
  // Los colores salen SIEMPRE de una paleta del catálogo, por nombre
  const paleta = paletaPorNombre(plan.palette ?? plan.palette_name)
  if (paleta) {
    const { primary, secondary, accent, actions } = paleta
    out.colors = { primary, secondary, accent, actions }
    out.palette_name = paleta.name
  }
  if (plan.fonts && typeof plan.fonts === 'object') {
    out.fonts = {}
    for (const k of ['cover', 'titles', 'body', 'quote']) if (familias.has(plan.fonts[k])) out.fonts[k] = plan.fonts[k]
  }
  // Textura del catálogo por nombre; "ninguna" la quita
  if (typeof plan.texture === 'string') {
    if (normal(plan.texture) === 'ninguna') out.texture = { id: null, name: 'ninguna' }
    else {
      const t = texturas.find(x => normal(x.name) === normal(plan.texture))
      if (t) out.texture = { id: t.id, name: t.name }
    }
  }
  const pos = Array.isArray(plan.positions) ? plan.positions.map(Number) : null
  if (pos && pos.length === 9 && [...pos].sort((a, b) => a - b).join() === '1,2,3,4,5,6,7,8,9') out.positions = pos
  if (plan.texts && typeof plan.texts === 'object') {
    for (const k of TEXTOS) {
      const t = plan.texts[k]
      if (typeof t === 'string' && t.trim()) out.texts[k] = t.trim().slice(0, MAX_TEXTO[k] ?? 80)
    }
  }
  // Títulos: el estilo lo decide la tipografía de títulos (manuscrita =
  // mayúscula inicial; otra = el estilo que ya tienen). Los que la IA no
  // mandó se toman de los actuales y se ajustan igual, para que todos
  // queden parejos.
  const categoria = Object.fromEntries(fuentes.map(f => [f.family, String(f.category ?? '').toLowerCase()]))
  const fuenteTitulos = out.fonts?.titles ?? base.__fuente_titulos
  const estilo = estiloDeTitulos(CLAVES_TITULO.map(k => base[k]), { manuscrita: categoria[fuenteTitulos] === 'handwriting' })
  for (const k of CLAVES_TITULO) {
    const t = out.texts[k] ?? base[k]
    if (typeof t === 'string' && t.trim()) out.texts[k] = conEstiloDeTitulo(t.trim(), estilo).slice(0, MAX_TEXTO[k] ?? 80)
  }
  return out
}

const SYSTEM = 'Eres Lia, asistente de I attend (México) que arma borradores de invitaciones de boda. Respondes SOLO con JSON válido, sin texto extra. Escribes en español de México, cálido y natural, sin emojis.'

// Carácter de cada fuente del catálogo, para que Lia elija por estilo y no
// siempre las mismas. Una fuente nueva del Font Lab sin entrada aquí igual
// se ofrece, solo sin descripción.
const ESTILO_FUENTE = {
  'Aboreto': 'mayúsculas art déco, moderna y elegante',
  'Anton SC': 'condensada y fuerte, urbana',
  'Cedarville Cursive': 'manuscrita casual, cercana',
  'Comfortaa': 'redondeada y amigable',
  'Dancing Script': 'cursiva alegre y clásica',
  'DM Serif Display': 'serif de alto contraste, editorial',
  'Edu NSW ACT Cursive': 'cursiva escolar, sencilla',
  'Fredoka': 'redondeada y divertida',
  'Kaisei Opti': 'serif suave y delicada',
  'Libre Baskerville': 'serif clásica de libro',
  'Libre Franklin': 'sans neutra y limpia',
  'Monsieur La Doulaise': 'caligrafía formal y ornamentada',
  'Mulish': 'sans minimalista',
  'Noto Sans': 'sans neutra',
  'Open Sans': 'sans neutra y legible',
  'Outfit': 'sans geométrica moderna',
  'Platypi': 'serif cálida y moderna',
  'Playfair Display': 'serif elegante de alto contraste',
  'Poppins': 'sans geométrica',
  'Quicksand': 'sans redondeada y ligera',
  'Sedan': 'serif clásica y suave',
  'Tangerine': 'caligrafía delgada y elegante',
  'WindSong': 'caligrafía fluida y romántica',
  'Work Sans': 'sans moderna',
}

// Textos de referencia: los actuales o, si es un ajuste, los del borrador
const textosBase = ({ textos, actual }) => ({ ...(actual?.texts ?? textos ?? {}), __fuente_titulos: actual?.fonts?.titles })

const pedirPlan = async ({ prompt, nombres, fecha, tono, textos, instruccion, actual }, fuentes, texturas) => {
  const mayusculasHoy = estiloDeTitulos(CLAVES_TITULO.map(k => textosBase({ textos, actual })[k])) === 'mayusculas'
  // Solo se sugieren las más usadas de cada grupo (el conteo del Font Lab),
  // de la más a la menos usada; entre ellas Lia elige por estilo.
  const por = (cats, cuantas) => fuentes
    .filter(f => cats.includes(String(f.category).toLowerCase()))
    .sort((a, b) => b.usos - a.usos)
    .slice(0, cuantas)
    .map(f => f.family)
  const conEstilo = (lista) => lista.map(f => (ESTILO_FUENTE[f] ? `${f} (${ESTILO_FUENTE[f]})` : f)).join('; ')
  const script = por(['handwriting'], 4)
  const titulos = por(['serif', 'display', 'handwriting'], 6)
  const cuerpo = por(['sans-serif', 'serif'], 5)
  const otraVersion = instruccion && /(otra|distint)/i.test(instruccion)
  const user = `Crea un primer borrador para la invitación digital.
Descripción de la pareja: "${prompt}"
Nombres: ${nombres || 'sin nombres'}. Fecha: ${fecha || 'sin fecha'}. Tono deseado: ${tono}.
${instruccion
    ? `Borrador actual: ${JSON.stringify(actual)}\nAjuste pedido: "${instruccion}". Cambia solo lo necesario para cumplirlo.`
    : `Textos actuales (reescríbelos con el tono y estilo; conserva datos como fechas límite): ${JSON.stringify(textos)}`}
No puedes cambiar fotos. Los colores salen SOLO de una paleta del catálogo (nunca inventes colores): elige la que mejor encaje con su descripción. Paletas disponibles, con sus palabras clave: ${catalogoParaPrompt()}.
Elige también la textura de fondo que mejor vaya con lo que describe (o "ninguna" si pide algo muy limpio): ${texturas.map(t => t.name).join(', ')}.
Tipografías: usa solo estas, que son las más usadas en I attend (de más a menos usada); entre ellas elige por el estilo que describe la pareja. La de portada (cover) y la de la frase (quote) suelen ser manuscritas; títulos con carácter y cuerpo muy legible.${otraVersion ? ' Como pide otra versión, usa tipografías DISTINTAS a las del borrador actual.' : ''}
- Portada (cover): ${conEstilo(script)}
- Títulos (titles): ${conEstilo(titulos)}
- Cuerpo (body): ${conEstilo(cuerpo)}
Títulos de sección (los *_title): cortos, de 1 a 4 palabras, sin paréntesis ni explicaciones, y TODOS en el mismo estilo. Si la tipografía de títulos que eliges es manuscrita, escríbelos con mayúscula inicial y nunca todo en mayúsculas; si no es manuscrita, puedes usar mayúsculas${mayusculasHoy ? ' (los títulos actuales están en MAYÚSCULAS)' : ''}.
Secciones (índices): 1 bienvenida, 2 padres, 3 frase sobre foto, 4 itinerario, 5 dress code, 6 regalos, 7 destinos/hoteles, 8 avisos, 9 galería.
Devuelve exactamente:
{"summary":"2 frases en primera persona como Lia explicando la propuesta y recordando que es un punto de partida que pueden editar","palette":"nombre exacto de una paleta del catálogo","texture":"nombre exacto de una textura del catálogo o ninguna","fonts":{"cover":"nombre exacto de la lista de portada","titles":"nombre exacto de la lista de títulos","body":"nombre exacto de la lista de cuerpo","quote":"nombre exacto de la lista de portada o de títulos"},"positions":[permutación de 1..9],"texts":{${TEXTOS.map(k => `"${k}":"..."`).join(',')}}}`

  const r = await anthropic.messages.create({
    model: AI_MODELS.SONNET,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  }, { timeout: 40 * 1000, maxRetries: 1 })

  const texto = r.content.filter(b => b.type === 'text').map(b => b.text).join('')
  const json = texto.match(/\{[\s\S]*\}/)
  const tokensIn = tokensDeEntradaAnthropic(r.usage)
  const tokensOut = r.usage.output_tokens
  return {
    plan: json ? JSON.parse(json[0]) : null,
    uso: { tokensIn, tokensOut, costoUsd: calculateCost(AI_MODELS.SONNET, tokensIn, tokensOut) },
  }
}

// { prompt, nombres, fecha, tono, textos, instruccion?, actual?, vuelta? }
// → { plan, origen: 'ia' | 'respaldo', uso }
const armarBorrador = async (entrada) => {
  const tono = TONOS.includes(entrada.tono) ? entrada.tono : 'Romántico'
  const datos = {
    prompt: String(entrada.prompt ?? '').slice(0, 1500),
    nombres: String(entrada.nombres ?? '').slice(0, 80),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(entrada.fecha ?? '') ? entrada.fecha : '',
    tono,
    textos: entrada.textos && typeof entrada.textos === 'object' ? entrada.textos : {},
    instruccion: entrada.instruccion ? String(entrada.instruccion).slice(0, 400) : null,
    actual: entrada.actual ?? null,
  }
  const [fuentes, texturas] = await Promise.all([leerFuentes(), leerTexturas()])

  let uso = null
  try {
    const r = await pedirPlan(datos, fuentes, texturas)
    uso = r.uso
    const plan = sanear(r.plan, fuentes, texturas, textosBase(datos))
    if (plan && Object.keys(plan.texts).length >= 6) return { plan, origen: 'ia', uso }
  } catch (err) {
    console.error('[onboarding] la IA falló, uso respaldo:', err.message)
  }

  const otra = datos.instruccion && /(otra|distint)/i.test(datos.instruccion)
  const preset = elegirPreset(otra ? '' : `${datos.instruccion ?? ''} ${datos.prompt}`, Number(entrada.vuelta) || 0)
  return { plan: sanear(preset, fuentes, texturas, textosBase(datos)), origen: 'respaldo', uso }
}

module.exports = { armarBorrador, TEXTOS }
