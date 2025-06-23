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
Tu tarea es analizar la siguiente descripción y las palabras clave, y generar un JSON estructurado con la siguiente información. 
Si algún dato no se menciona, genera un contenido genérico, elegante y coherente con el resto.

El JSON debe tener los siguientes campos:

  {
    "palette": {
      "primary": "Color base principal, claro y legible, basado en la descripción de colores de la boda. Elige el color más claro. No debe ser chillante, debe ser en tonos pastel o suaves. Formato hexadecimal.",
        "secondary": "Color que complementa al primario. Si no se menciona un segundo color, usa el color base en un tono más oscuro. Si se menciona, asegúrate de que tenga alto contraste con el color base. Formato hexadecimal.",
          "accent": "Color del texto principal. Debe tener alto contraste y buena legibilidad sobre el color base. Si el color base es claro debe de ser oscuro y viceversa. En hexadecimal.",
            "buttons": "Color llamativo para botones o llamados a la acción. Debe armonizar con los demás colores. En hexadecimal.",
              "contrast": Booleano: si el color accent para el texto es legible y tiene un alto contraste con el color secondary es false, si no es true.
    },
    "greeting": {
      "title": "Título corto que da la bienvenida a la invitación.",
        "content": "Frase de bienvenida cálida y acorde al estilo del evento."
    },
    "quote": "Cita romántica o inspiradora que combine con la temática o tono del evento.",
      "family": {
      "active": false, // Booleano: true si se mencionan personas importantes, false si no se menciona nadie.
        "title": "Título que hace referencia a las personas mencionadas (Ej. Mis padres, Nuestra familia)",
          "members": [
            {
              "title": "Rol de la persona (ej. madre, padre, hermana, etc.)",
              "content": "Nombre completo o forma afectiva con la que se menciona."
            }
          ]
    },
    "itinerary": [
      {
        "name": "Nombre del evento (ej. Ceremonia, Recepción)",
        "time": "Hora del evento en formato 12h (ej. 6:00 PM)",
        "subname": "Ubicación o nombre del lugar (ej. Jardín del Lago)"
        "icon": "En base al evento, selecciona la palabra que más le haga sentido: Fiesta, Regalos, Pastél, Globos, Ubicación, Comida, Bebida, Iglesia, Actividad"
      }
    ],
      "dresscode": "Recomendación de vestimenta basada en el lugar, clima, temática o estilo.",
        "dresscode_colors": ["4 colores en hexadecimal que combinen con el dresscode, diferentes a los de la paleta de colores"],
          "gifts": "Texto relacionado con la mesa de regalos. Si no se menciona nada, escribe un texto genérico elegante.",
            "notices": [
              "Avisos o recomendaciones adicionales. Ej: llegar a tiempo, evento sin niños, transporte disponible, etc. Agrega al menos tres."
            ],
              "texture": "Basado en las palabras clave, elige una de estas opciones: Moderno, Viejo, Vintage, Clásico, Rústico, Simple",
                "separator": "Basado en las palabras clave, elige una de estas opciones: Formal, Floral, Detallado, Simple, Romántico, Sobrio.",
                    "destinations": "Si se menciona que el evento es en un destino distinto o turístico, incluye una frase sobre hospedaje o contacto para más información."
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