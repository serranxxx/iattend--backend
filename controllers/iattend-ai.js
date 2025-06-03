// controllers/invitationController.js
const OpenAI = require("openai");
const { fetch } = require("undici");

require("dotenv").config();

const openai = new OpenAI({
    apiKey: process.env.REACT_APP_OPENAI_KEY,
    fetch
});

const generateInvitation = async (req, res) => {
    const { prompt } = req.body;

    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    const systemInstructions = `
Eres un asistente experto en crear invitaciones de boda para una plataforma llamada iattend. 
Tu tarea es analizar la siguiente descripción y devolver solo un JSON estructurado con los siguientes campos:

{
  "greeting": {
    title: "Título para abrir la invitación",
    content: "Una frase de bienvenida para abrir la invitación"
  },
  "quote": "Una cita romántica inspirada en el estilo de la boda",
  "family": [{title: "Título de la persona, ejemplo padre, hermano, madre", content: "Nombre de las personas mencionadas importantes"}],
  "itinerary": [{"evento": "Ceremonia", "hora": "6:00 PM", "lugar": "Jardín del Lago"}, ...],
  "dresscode": "Recomendación de vestimenta según el estilo o lugar",
  "gifts": "Texto sobre la mesa de regalos (si no se menciona nada, usa uno genérico)",
  "notices": ["Avisos adicionales como puntualidad, sin niños, transporte, etc."]
}

Si algo no está en el prompt, genera un contenido genérico y elegante que encaje.
`;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4", // Puedes usar "gpt-3.5-turbo" si prefieres
            messages: [
                { role: "system", content: systemInstructions },
                { role: "user", content: prompt },
            ],
            temperature: 0.7,
        });

        const content = completion.choices[0].message.content;

        const parsed = JSON.parse(content);
        res.status(200).json(parsed);
    } catch (error) {
        console.error("OpenAI Error:", error);
        res.status(500).json({ error: "Error generating invitation", details: error.message });
    }
};

module.exports = { generateInvitation };