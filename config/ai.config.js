require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY?.trim() });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY?.trim());

const MODELS = {
    anthropic: 'claude-sonnet-4-5',
    haiku: 'claude-haiku-4-5',
    openai: 'gpt-4o-mini',
    gemini: 'gemini-2.5-flash',
};

// Cost per 1M tokens in USD (input / output)
const TOKEN_COSTS = {
    [MODELS.anthropic]: { input: 3.00,  output: 15.00 },
    [MODELS.haiku]:     { input: 1.00,  output: 5.00  },
    [MODELS.openai]:    { input: 0.15,  output: 0.60  },
    [MODELS.gemini]:    { input: 0.075, output: 0.30  },
};

// Alias usados por ai.chat.route (Fase 5)
const AI_MODELS = {
    SONNET: MODELS.anthropic,
    HAIKU:  MODELS.haiku,
    GPT:    MODELS.openai,
    GEMINI: MODELS.gemini,
};

function calculateCost(modelId, tokensIn, tokensOut) {
    const costs = TOKEN_COSTS[modelId];
    if (!costs) return 0;
    return (tokensIn * costs.input + tokensOut * costs.output) / 1_000_000;
}

// Anthropic reporta aparte lo que se escribe y se lee de la caché de prompt;
// input_tokens ya no los incluye. Se convierten a "tokens de entrada
// equivalentes" con sus multiplicadores (escritura 1.25x, lectura 0.1x) para
// que calculateCost cobre lo real sin cambiar su firma.
function tokensDeEntradaAnthropic(usage = {}) {
    return Math.round(
        (usage.input_tokens || 0)
        + 1.25 * (usage.cache_creation_input_tokens || 0)
        + 0.1  * (usage.cache_read_input_tokens || 0)
    );
}

const gemini = genAI

module.exports = { anthropic, openai, genAI, gemini, MODELS, TOKEN_COSTS, AI_MODELS, calculateCost, tokensDeEntradaAnthropic };
