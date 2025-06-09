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
Tu tarea es analizar la siguiente descripción y generar un JSON estructurado con la siguiente información. Si algún dato no se menciona, genera un contenido genérico, elegante y coherente con el resto.
El JSON debe tener los siguientes campos:

{
  "palette": {
    "primary": "Color base principal, claro y legible, en formato hexadecimal (#xxxxxx), basado en la descripción de colores de la boda. Este color no puede ser chillante, siempre debe de ser un tono pastel",
    "secondary": "Color que complementa al primario. Puede ser un tono más oscuro o un color que contraste. También en hexadecimal.",
    "accent": "Color del texto principal. Debe tener alto contraste y buena legibilidad sobre el color base (No sobre el color secundario). En hexadecimal.",
    "buttons": "Color llamativo para botones o llamados a la acción. Debe armonizar con los otros colores. En hexadecimal.",
    "contrast": true // Booleano: true si el secondary es un color altamente contrastante con el primary, false si solo es algunos tonos más oscuro.
  },
  "greeting": {
    "title": "Título corto que da la bienvenida a la invitación.",
    "content": "Frase de bienvenida cálida y acorde al estilo del evento."
  },
  "quote": "Cita romántica o inspiradora que combine con la temática o tono del evento.",
  "family": {
    "title": "Título que haga referencia a las personas que se mencionan (Mis padres),
    "members": [
      {
        "title": "Rol de la persona (ej. madre, padre, hermana, etc.)",
        "content": "Nombre completo o forma afectiva con la que se menciona. (Una por persona)"
      }
    ] 
  },
  "itinerary": [
    {
      "name": "Nombre del evento (ej. Ceremonia, Recepción)",
      "time": "Hora del evento en formato 12h (ej. 6:00 PM)",
      "subname": "Ubicación o nombre del lugar (ej. Jardín del Lago)"
    }
  ],
  "dresscode": "Recomendación de vestimenta basada en el lugar, clima, temática o estilo.",
  "dresscode_colors": ["4 colores en hexadecimal que hagan match con el dresscode, no uses ninguno de los colores de la paleta de colores"]
  "gifts": "Texto relacionado con la mesa de regalos. Si no se menciona nada, escribe un texto genérico elegante.",
  "notices": [
    "Avisos o recomendaciones adicionales. Ej: llegar a tiempo, evento sin niños, transporte disponible, etc. Agrega al menos tres"
  ]
}
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4", // O "gpt-3.5-turbo"
      messages: [
        { role: "system", content: systemInstructions },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
    });

    const content = completion.choices[0].message.content;

    const Invitation = JSON.parse(content);

    res.status(200).json({
      ok: true,
      msg: "Get invitation By AI",
      data: Invitation
    });
  } catch (error) {
    console.error("OpenAI Error:", error);
    res.status(500).json({
      ok: false,
      msg: "Error generating invitation",
      error: error.message
    });
  }
};

module.exports = { generateInvitation };