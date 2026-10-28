// ============================================================
// POST /api/ai/write — "Texto con Lia" del editor de la invitación
// (iattend-vite, panel de herramienta del editor de escritorio).
//
// Redacta 1–3 opciones de texto para un campo de la invitación (bienvenida,
// título, frase, aviso) a partir de lo que pide el organizador y un tono.
// Mismas reglas que el chat de Lia: sesión de Supabase + acceso a la
// invitación, plan que incluya a Lia y créditos de Lia del día (se cobra el
// costo real con consume_lia_credits). Redacta Sonnet (solo redacta, no hace
// acciones).
// ============================================================

const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { anthropic, AI_MODELS, calculateCost, tokensDeEntradaAnthropic } = require('../config/ai.config')
const { validarAccesoInvitacion } = require('../middlewares/validar-acceso-invitacion')
const { planIncluyeLia } = require('../config/plans')
const { tipoDeEvento, idiomaDe } = require('../models/lia.prompt')

// Qué se está escribiendo y su largo máximo (caracteres).
const DESTINOS = {
  greeting_text:  { es: 'el texto de bienvenida de la invitación (un párrafo corto que invita al evento)', max: 220 },
  greeting_title: { es: 'el título de la sección de bienvenida (una frase muy corta)', max: 45 },
  quote:          { es: 'una frase o cita para la sección "Frase" (puede ser una cita conocida con su autor, o una frase original)', max: 170 },
  notice:         { es: 'un aviso para los invitados (indicación práctica: niños, estacionamiento, código de vestimenta, horario, etc.)', max: 150 },
}

const TONOS = {
  romantic: 'romántico y cálido',
  formal:   'formal y elegante',
  fun:      'divertido y desenfadado',
}

const HERRAMIENTA = {
  name: 'opciones',
  description: 'Entrega las opciones de texto redactadas.',
  input_schema: {
    type: 'object',
    properties: {
      options: { type: 'array', items: { type: 'string' }, description: 'Cada opción es el texto final, listo para pegarse en la invitación.' },
    },
    required: ['options'],
  },
}

router.post('/', validarAccesoInvitacion, async (req, res) => {
  const { invitation_id, target, prompt = '', tone = 'romantic', lang, count = 3, current = '', avoid = [] } = req.body
  const destino = DESTINOS[target]
  if (!destino) return res.status(400).json({ success: false, error: 'target no válido' })
  const cuantas = Math.min(3, Math.max(1, Number(count) || 3))

  if (!(await planIncluyeLia(req.invitation?.plan))) {
    return res.status(403).json({ success: false, code: 'NOT_AVAILABLE', error: 'Lia no está incluida en el plan de este evento' })
  }

  const { data: status, error: statusError } = await supabase.rpc('get_lia_credits_status', { p_invitation_id: invitation_id })
  if (statusError || !status) {
    console.error('[ai/write] get_lia_credits_status falló:', statusError?.message)
    return res.status(500).json({ success: false, error: 'No se pudo revisar el saldo de Lia' })
  }
  if (status.total_available <= 0) {
    return res.status(402).json({ success: false, code: 'NO_CREDITS', error: 'Alcanzaste tu límite diario de Lia. Se renueva a medianoche.', resets_at: status.resets_at })
  }

  try {
    const { data: summary } = await supabase.rpc('get_event_summary', { p_invitation_id: invitation_id })
    const event = summary?.event || {}
    const owners = (event.owners || []).filter(Boolean)
    const idioma = idiomaDe(lang) === 'en' ? 'inglés' : 'español'
    const evitar = (Array.isArray(avoid) ? avoid : []).filter((x) => typeof x === 'string').slice(0, 6).map((x) => x.slice(0, 300))

    const system = `Eres Lia, la redactora de I attend, una plataforma de invitaciones digitales en México.
Escribes textos para invitaciones: cálidos, naturales, sin clichés vacíos, con buena ortografía y sin emojis.

EVENTO:
- Tipo: ${tipoDeEvento(event.label, 'es')}
- Nombre: ${event.name || 'sin nombre'}
- Anfitriones: ${owners.length ? owners.join(' & ') : 'sin registrar'}

REGLAS:
- Escribe ${destino.es}.
- Tono: ${TONOS[tone] || TONOS.romantic}.
- Idioma: ${idioma}.
- Cada opción de máximo ${destino.max} caracteres. Opciones distintas entre sí (enfoque, no solo palabras).
- No inventes datos concretos (fechas, lugares, horarios, nombres) que no estén arriba o en la petición.
- Puedes resaltar una o dos palabras clave con *asteriscos* (se muestran en negritas). No uses otro formato.
- Entrega exactamente ${cuantas} ${cuantas === 1 ? 'opción' : 'opciones'} con la herramienta "opciones".`

    const peticion = [
      prompt.trim() ? `Lo que quiere el organizador: ${prompt.trim().slice(0, 600)}` : 'El organizador no dio detalles: propón algo adecuado al evento.',
      current?.trim() ? `Texto actual (puedes mejorarlo o partir de cero): ${current.trim().slice(0, 400)}` : null,
      evitar.length ? `No repitas estas opciones que ya vio:\n- ${evitar.join('\n- ')}` : null,
    ].filter(Boolean).join('\n\n')

    const response = await anthropic.messages.create({
      model: AI_MODELS.SONNET,
      max_tokens: 800,
      system,
      messages: [{ role: 'user', content: peticion }],
      tools: [HERRAMIENTA],
      tool_choice: { type: 'tool', name: HERRAMIENTA.name },
    })

    const uso = response.usage || {}
    const tokensIn = tokensDeEntradaAnthropic(uso)
    const tokensOut = uso.output_tokens || 0
    const options = (response.content.find((b) => b.type === 'tool_use')?.input?.options || [])
      .filter((x) => typeof x === 'string' && x.trim())
      .map((x) => x.trim().slice(0, destino.max + 40))
      .slice(0, cuantas)

    const costUsd = calculateCost(AI_MODELS.SONNET, tokensIn, tokensOut)
    await supabase.rpc('log_ai_interaction', {
      p_invitation_id: invitation_id,
      p_model:         AI_MODELS.SONNET,
      p_tokens_in:     tokensIn,
      p_tokens_out:    tokensOut,
      p_cost_usd:      costUsd,
      p_tool_called:   `editor_write:${target}`,
      p_success:       options.length > 0,
    })
    const { data: credit } = await supabase.rpc('consume_lia_credits', { p_invitation_id: invitation_id, p_cost_usd: costUsd })

    if (!options.length) return res.status(502).json({ success: false, error: 'Lia no devolvió opciones' })
    return res.json({ success: true, options, credits_remaining: credit?.total_available ?? null })
  } catch (err) {
    console.error('[ai/write]', err?.message)
    return res.status(500).json({ success: false, error: 'No se pudo redactar el texto' })
  }
})

module.exports = router
