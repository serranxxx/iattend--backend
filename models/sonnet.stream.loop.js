// models/sonnet.stream.loop.js
// ============================================================
// runSonnetStreamLoop — loop de Claude con streaming SSE real
// Se importa en ai.chat.route.js (organizador y chat de invitados).
//
// El texto se manda al cliente conforme llega del modelo (messages.stream),
// no palabra por palabra al final. Si el modelo pide una tool a media
// respuesta, el texto previo ("Déjame revisar…") también se ve en vivo.
// ============================================================

const { anthropic, AI_MODELS, tokensDeEntradaAnthropic } = require('../config/ai.config')

const TIMEOUT_MS = 45 * 1000

// `model` es opcional: el chat de invitados usa Haiku.
// `signal` (opcional) corta la llamada si el cliente cerró la conexión, para
// no seguir pagando una respuesta que nadie va a leer.
async function runSonnetStreamLoop(systemPrompt, messages, tools, executeTool, invitationId, res, model = AI_MODELS.SONNET, signal) {
  const MAX_ITER       = 5
  let currentMsgs      = messages
  let totalIn          = 0
  let totalOut         = 0
  let finalText        = ''
  const pendingActions = []

  for (let i = 0; i < MAX_ITER; i++) {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: 1024,
      system: Array.isArray(systemPrompt)
        ? systemPrompt
        : [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages:   currentMsgs,
      ...(tools?.length ? { tools } : {}),
    }, { signal, timeout: TIMEOUT_MS, maxRetries: 1 })

    stream.on('text', (delta) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'text', text: delta })}\n\n`)
    })

    const response = await stream.finalMessage()

    totalIn  += tokensDeEntradaAnthropic(response.usage)
    totalOut += response.usage.output_tokens

    const texto = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
    finalText += texto

    if (response.stop_reason === 'tool_use') {
      const toolResults = []
      const resultados  = []
      for (const toolUse of response.content.filter(b => b.type === 'tool_use')) {
        const result = await executeTool(toolUse.name, toolUse.input, invitationId)
        resultados.push(result)
        if (result?.requires_confirmation) pendingActions.push(result)
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) })
      }
      // Tools terminales (mostrar_bloque): no hace falta otra vuelta al modelo
      if (resultados.length && resultados.every(r => r?.terminal)) break

      // Separa el texto previo a la tool del que viene después
      if (texto && !res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'text', text: '\n\n' })}\n\n`)
      if (texto) finalText += '\n\n'
      currentMsgs = [
        ...currentMsgs,
        { role: 'assistant', content: response.content },
        { role: 'user',      content: toolResults },
      ]
      continue
    }

    break
  }

  return { content: finalText.trim(), tokensIn: totalIn, tokensOut: totalOut, modelId: model, pendingActions }
}

module.exports = { runSonnetStreamLoop }
