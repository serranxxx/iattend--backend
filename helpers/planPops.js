// Planes de Pops (Free / Pops Plus): qué funciones Plus usa el body de un Pop.
// Gemela: iattend-vite/src/modules/SideEvents/planPops.js (si cambia una, cambiar la
// otra). Decisiones en iattend-vite/docs/editor-pops-planes-paso0.md.
//
// Un Pop Free no se guarda (nada) mientras use alguna de estas funciones: el
// editor lo avisa y el backend lo rechaza (router/sideEventGuardar.js).
// Los límites que no viven en el body (30 personas, 3 Pops activos, 3
// formularios / 2 preguntas en Mis formularios) son triggers en la base
// (migrations/2026-11-23c_pops_plus_plan.sql).

const LIMITES_FREE = {
    imagenes: 10,         // fotos subidas y stickers de body.stickers
    portada: 1,           // fotos en la portada (sin video)
    preguntas: 2,         // preguntas del formulario del Pop
    estilosBloque: ['vidrio', 'hielo', 'noche'], // los 3 primeros de ESTILOS_BLOQUE
}

const esVideo = (url) => typeof url === 'string' && /\/video\/|\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url)
const esImagen = (s) => !s?.kind || s.kind === 'sticker'

const preguntasDelFormulario = (form) =>
    (form?.snapshot?.sections ?? []).reduce((n, s) => n + (Array.isArray(s?.fields) ? s.fields.length : 0), 0)

// Orden = el de la lista del aviso.
const FUNCIONES_PLUS = [
    {
        clave: 'imagenes',
        usa: (b) => (b?.stickers ?? []).filter(esImagen).length > LIMITES_FREE.imagenes,
    },
    {
        clave: 'portada',
        usa: (b) => {
            const lista = Array.isArray(b?.images) ? b.images.filter((s) => typeof s === 'string' && s.trim()) : []
            return lista.length > LIMITES_FREE.portada || lista.some(esVideo) || Boolean(b?.video)
        },
    },
    {
        clave: 'estiloBloque',
        usa: (b) => Boolean(b?.blockStyle) && !LIMITES_FREE.estilosBloque.includes(b.blockStyle),
    },
    {
        clave: 'efectoPng',
        usa: (b) => b?.effect?.type === 'imagenes',
    },
    {
        clave: 'mensajeFijado',
        usa: (b) => Boolean(b?.chat?.pinned?.text?.trim?.()),
    },
    {
        clave: 'imagenLink',
        usa: (b) => Boolean(b?.linkImage),
    },
    {
        clave: 'formulario',
        usa: (b) => b?.form?.enabled !== false && preguntasDelFormulario(b?.form) > LIMITES_FREE.preguntas,
    },
]

/** Claves de las funciones Plus que usa este body (vacío = se puede guardar en Free). */
const funcionesPlusEnUso = (body) => FUNCIONES_PLUS.filter((f) => f.usa(body ?? {})).map((f) => f.clave)

module.exports = { LIMITES_FREE, FUNCIONES_PLUS, funcionesPlusEnUso };
