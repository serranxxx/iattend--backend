const { response } = require('express');
const supabase = require('../config/supabase');

// Tablas de Lia que lee Admin → Eventos → Analítica. Antes se leían desde el
// navegador con la anon key, y eso dejaba todas las conversaciones de todos
// los organizadores (con nombres y mensajes de invitados) a la vista de
// cualquiera. Ahora solo el backend las lee, detrás de validarAdmin.
// Las columnas quedan fijas aquí: el cliente elige tabla, no columnas.
const TABLAS = {
    conversaciones: {
        tabla: 'ai_conversations',
        columnas: 'id,invitation_id,session_id,role,content,model_used,tokens_in,tokens_out,created_at',
        orden: 'created_at',
    },
    logs: {
        tabla: 'ai_agent_logs',
        columnas: 'id,invitation_id,model,tool_called,cost_usd,success,created_at',
        orden: 'created_at',
    },
    uso: {
        tabla: 'ai_daily_usage',
        columnas: 'invitation_id,usage_date,free_used,total_spend_usd',
        orden: 'usage_date',
    },
};

const PAGINA = 1000;

// PostgREST corta en 1000 filas en silencio: se pagina hasta el final.
const traerTodo = async ({ tabla, columnas, orden }) => {
    const acumulado = [];

    for (let desde = 0; ; desde += PAGINA) {
        const { data, error } = await supabase
            .from(tabla)
            .select(columnas)
            .order(orden, { ascending: true })
            .range(desde, desde + PAGINA - 1);

        if (error) throw error;

        acumulado.push(...data);
        if (data.length < PAGINA) break;
    }

    return acumulado;
};

const getDatosLia = async (req, res = response) => {
    const pedidas = String(req.query.tablas || Object.keys(TABLAS).join(','))
        .split(',')
        .map(t => t.trim())
        .filter(t => TABLAS[t]);

    if (!pedidas.length) {
        return res.status(400).json({ ok: false, msg: `tablas válidas: ${Object.keys(TABLAS).join(', ')}` });
    }

    try {
        const filas = await Promise.all(pedidas.map(t => traerTodo(TABLAS[t])));
        return res.json({ ok: true, ...Object.fromEntries(pedidas.map((t, i) => [t, filas[i]])) });
    } catch (error) {
        console.error('Error al leer datos de Lia:', error);
        return res.status(500).json({ ok: false, msg: 'No se pudieron leer los datos de Lia' });
    }
};

module.exports = { getDatosLia };
