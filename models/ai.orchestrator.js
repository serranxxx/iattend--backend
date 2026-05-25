// models/ai.orchestrator.js
// ============================================================
// Orquestador multi-modelo con clasificación de intent
// Gemini clasifica → elige modelo → fallback a Sonnet
// ============================================================

const { anthropic, openai, genAI, AI_MODELS, calculateCost } = require('../config/ai.config')

// ------------------------------------------------------------
// CLASIFICADOR DE INTENT — Gemini Flash
// Costo: ~$0.0001 por clasificación — no se cobra al usuario
// ------------------------------------------------------------

const INTENT_SYSTEM = `
Clasifica el mensaje en exactamente una categoría.
Responde SOLO con la palabra clave, sin explicación.

CONSULTA_SIMPLE: preguntas que se responden con datos básicos del evento
  que ya están en el contexto: conteos generales, fecha, lugar, dress code.
  Ejemplos: "cuántos confirmados hay", "cuándo es la boda", "dónde es la ceremonia"
  NO incluye: preguntas sobre mensajes de WhatsApp, historial de invitados,
  preguntas de seguimiento ("qué me dijo", "quién es", "cuéntame más")

ACCION: peticiones que crean o modifican datos
  Ejemplos: "confirma a Juan", "pon a María en mesa 3", "crea una mesa",
  "cambia el estado", "asigna", "agrega", "cambia la fecha"

EMPATIA: todo lo demás — consejos, preguntas de seguimiento,
  preguntas sobre mensajes/historial de WhatsApp, situaciones delicadas,
  preguntas que requieren buscar datos específicos de invitados
  Ejemplos: "qué me dijo", "quién vio mi invitación", "qué pasó con",
  "cómo manejo esto", "qué recomiendas", "tengo mensajes sin leer",
  "quién confirmó", "dame la lista de"
`.trim()

async function classifyIntent(message, historyMessages = []) {
  try {
    const model = genAI.getGenerativeModel({ model: AI_MODELS.GEMINI })

    // Incluir último mensaje del historial para contexto
    const lastMsg = historyMessages.filter(m => m.role === 'assistant').at(-1)?.content || ''
    const context = lastMsg ? `Contexto previo: "${lastMsg.slice(0, 100)}"\n` : ''

    const result = await model.generateContent({
      systemInstruction: INTENT_SYSTEM,
      contents: [{
        role: 'user',
        parts: [{ text: `${context}Mensaje: "${message}"` }]
      }]
    })

    const intent = result.response.text().trim().toUpperCase()

    if (['CONSULTA_SIMPLE', 'ACCION', 'EMPATIA'].includes(intent)) {
      return intent
    }

    // Si Gemini retorna algo inesperado, fallback a EMPATIA (Sonnet)
    console.warn(`[classify] intent inesperado: "${intent}" — usando EMPATIA`)
    return 'EMPATIA'

  } catch (err) {
    console.error('[classify] Gemini falló, usando EMPATIA:', err.message)
    return 'EMPATIA'
  }
}

// ------------------------------------------------------------
// LOOP GENÉRICO — ejecuta el ciclo de tools para cualquier modelo
// Retorna: { content, tokensIn, tokensOut, modelId, pendingActions }
// ------------------------------------------------------------

// Sonnet (Anthropic)
async function runSonnetLoop(systemPrompt, messages, tools, executeTool, invitationId) {
  const MAX_ITER = 5
  let currentMsgs = messages
  let totalIn = 0, totalOut = 0, finalText = ''
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

    if (response.stop_reason !== 'tool_use') {
      finalText = response.content.find(b => b.type === 'text')?.text || ''
      break
    }

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
  }

  return { content: finalText, tokensIn: totalIn, tokensOut: totalOut, modelId: AI_MODELS.SONNET, pendingActions }
}

// GPT-4o Mini (OpenAI)
async function runGPTLoop(systemPrompt, messages, tools, executeTool, invitationId) {
  const MAX_ITER = 5

  // Convertir tools de formato Anthropic a formato OpenAI
  const openaiTools = tools.map(t => ({
    type: 'function',
    function: {
      name:        t.name,
      description: t.description,
      parameters:  t.input_schema,
    }
  }))

  let currentMsgs = [{ role: 'system', content: systemPrompt }, ...messages]
  let totalIn = 0, totalOut = 0, finalText = ''
  const pendingActions = []

  for (let i = 0; i < MAX_ITER; i++) {
    const response = await openai.chat.completions.create({
      model:      AI_MODELS.GPT,
      max_tokens: 1024,
      messages:   currentMsgs,
      tools:      openaiTools,
    })

    totalIn  += response.usage.prompt_tokens
    totalOut += response.usage.completion_tokens

    const choice = response.choices[0]

    if (choice.finish_reason !== 'tool_calls') {
      finalText = choice.message.content || ''
      break
    }

    // Ejecutar tools
    const assistantMsg = { role: 'assistant', content: choice.message.content || '', tool_calls: choice.message.tool_calls }
    const toolMsgs = []

    for (const toolCall of choice.message.tool_calls) {
      const toolInput = JSON.parse(toolCall.function.arguments)
      const result    = await executeTool(toolCall.function.name, toolInput, invitationId)
      if (result?.requires_confirmation) pendingActions.push(result)
      toolMsgs.push({
        role:         'tool',
        tool_call_id: toolCall.id,
        content:      JSON.stringify(result),
      })
    }

    currentMsgs = [...currentMsgs, assistantMsg, ...toolMsgs]
  }

  return { content: finalText, tokensIn: totalIn, tokensOut: totalOut, modelId: AI_MODELS.GPT, pendingActions }
}

// Gemini Flash (Google)
async function runGeminiLoop(systemPrompt, messages, tools, executeTool, invitationId) {
  const MAX_ITER = 5

  // Convertir tools a formato Gemini
  const geminiTools = [{
    functionDeclarations: tools.map(t => ({
      name:        t.name,
      description: t.description,
      parameters:  t.input_schema,
    }))
  }]

  const model = genAI.getGenerativeModel({
    model:             AI_MODELS.GEMINI,
    systemInstruction: systemPrompt,
    tools:             geminiTools,
  })

  // Convertir historial a formato Gemini
  // Gemini exige que el historial empiece con 'user' — se descartan los mensajes
  // iniciales de 'model' (pueden venir del saludo de Lia al inicio de sesión)
  const rawHistory = messages.slice(0, -1).map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
  }))
  const firstUserIdx  = rawHistory.findIndex(m => m.role === 'user')
  const geminiHistory = firstUserIdx >= 0 ? rawHistory.slice(firstUserIdx) : []

  const chat           = model.startChat({ history: geminiHistory })
  const lastMsg        = messages.at(-1)?.content || ''
  let   totalIn        = 0
  let   totalOut       = 0
  let   finalText      = ''
  let   currentMsg     = typeof lastMsg === 'string' ? lastMsg : JSON.stringify(lastMsg)
  const pendingActions = []

  for (let i = 0; i < MAX_ITER; i++) {
    const result   = await chat.sendMessage(currentMsg)
    const response = result.response

    totalIn  += response.usageMetadata?.promptTokenCount     || 0
    totalOut += response.usageMetadata?.candidatesTokenCount || 0

    const fnCalls = response.functionCalls()

    if (!fnCalls || fnCalls.length === 0) {
      finalText = response.text()
      break
    }

    // Ejecutar tools y devolver resultados
    // Gemini exige que response sea un objeto — los arrays se envuelven en { data: [...] }
    const fnResponses = []
    for (const fn of fnCalls) {
      const result = await executeTool(fn.name, fn.args, invitationId)
      if (result?.requires_confirmation) pendingActions.push(result)
      fnResponses.push({
        functionResponse: {
          name:     fn.name,
          response: Array.isArray(result) ? { data: result } : (result ?? {}),
        }
      })
    }

    // En Gemini el siguiente mensaje son los resultados de las tools
    currentMsg = fnResponses
  }

  return { content: finalText, tokensIn: totalIn, tokensOut: totalOut, modelId: AI_MODELS.GEMINI, pendingActions }
}

// ------------------------------------------------------------
// ORQUESTADOR PRINCIPAL
// ------------------------------------------------------------

async function orchestrate({
  invitationId,
  userMessage,
  history,
  systemPrompt,
  tools,
  executeTool,
}) {
  // 1. Clasificar intent con Gemini (no cobra crédito)
  const intent = await classifyIntent(userMessage, history)
  console.log(`[orchestrate] intent: ${intent}`)

  const messages = [...history, { role: 'user', content: userMessage }]

  // 2. Elegir modelo según intent y ejecutar con fallback a Sonnet
  let result

  try {
    if (intent === 'CONSULTA_SIMPLE') {
      result = await runGeminiLoop(systemPrompt, messages, tools, executeTool, invitationId)
    } else if (intent === 'ACCION') {
      result = await runGPTLoop(systemPrompt, messages, tools, executeTool, invitationId)
    } else {
      result = await runSonnetLoop(systemPrompt, messages, tools, executeTool, invitationId)
    }
  } catch (err) {
    console.error(`[orchestrate] ${intent} falló (${err.message}), escalando a Sonnet`)
    result = await runSonnetLoop(systemPrompt, messages, tools, executeTool, invitationId)
  }

  // 3. Si el resultado está vacío, fallback a Sonnet
  if (!result.content?.trim() && result.modelId !== AI_MODELS.SONNET) {
    console.warn(`[orchestrate] respuesta vacía de ${result.modelId}, escalando a Sonnet`)
    result = await runSonnetLoop(systemPrompt, messages, tools, executeTool, invitationId)
  }

  return {
    content:        result.content,
    modelUsed:      result.modelId,
    tokensIn:       result.tokensIn,
    tokensOut:      result.tokensOut,
    costUsd:        calculateCost(result.modelId, result.tokensIn, result.tokensOut),
    toolsCalled:    [],
    pendingActions: result.pendingActions || [],
  }
}

module.exports = { orchestrate, classifyIntent, runSonnetLoop, runGPTLoop, runGeminiLoop }
