// models/sonnet.stream.loop.js
// ============================================================
// runSonnetStreamLoop — loop de Sonnet con streaming real SSE
// Se importa en ai.chat.route.js
// ============================================================

const { anthropic, AI_MODELS } = require('../config/ai.config')

async function runSonnetStreamLoop(systemPrompt, messages, tools, executeTool, invitationId, res) {
  const MAX_ITER       = 5
  let currentMsgs      = messages
  let totalIn          = 0
  let totalOut         = 0
  let finalText        = ''
  const pendingActions = []

  for (let i = 0; i < MAX_ITER; i++) {
    const response = await anthropic.messages.create({
      model:      AI_MODELS.SONNET,
      max_tokens: 1024,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages:   currentMsgs,
      tools,
    })

    totalIn  += response.usage.input_tokens
    totalOut += response.usage.output_tokens

    if (response.stop_reason === 'tool_use') {
      const toolResults = []
      for (const toolUse of response.content.filter(b => b.type === 'tool_use')) {
        const result = await executeTool(toolUse.name, toolUse.input, invitationId)
        if (result?.requires_confirmation) pendingActions.push(result)
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) })
      }
      currentMsgs = [
        ...currentMsgs,
        { role: 'assistant', content: response.content },
        { role: 'user',      content: toolResults },
      ]
      continue
    }

    // Respuesta final — streaming real
    const textBlock = response.content.find(b => b.type === 'text')
    if (textBlock) {
      const words = textBlock.text.split(' ')
      for (const word of words) {
        res.write(`data: ${JSON.stringify({ type: 'text', text: word + ' ' })}\n\n`)
      }
      finalText = textBlock.text
    }
    break
  }

  return { content: finalText, tokensIn: totalIn, tokensOut: totalOut, modelId: AI_MODELS.SONNET, pendingActions }
}

module.exports = { runSonnetStreamLoop }
