const supabase = require('../config/supabase');
const { genAI, AI_MODELS, calculateCost } = require('../config/ai.config');
const { generateSimpleId } = require('../helpers/simpleId');

const VALID_TYPES = ['female', 'male', 'child', 'undefined'];
const VALID_TIERS = ['A', 'B', 'C', 'D'];

const NORMALIZE_SYSTEM_PROMPT = `Eres un asistente que normaliza listas de invitados de boda subidas
en Excel para la plataforma I attend. Recibes filas crudas (columnas
arbitrarias, en cualquier idioma u orden) y debes devolver un array JSON
con un objeto por fila, siguiendo EXACTAMENTE este esquema:

{
  "name": "string",
  "phone_number": "string — tal cual viene en el Excel, sin agregar lada si no la trae",
  "tag": "string | null",
  "type": "female | male | child | undefined",
  "tier": "A | B | C | D | null",
  "side": "string (debe coincidir EXACTO con un elemento de owners) | null",
  "notes": "string | null",
  "meal": "string | null",
  "special_needs": "string | null",
  "companion_of": "string | null — nombre EXACTO de otro invitado en este mismo archivo al que acompaña"
}

Reglas de mapeo:
- tag: te dan una lista "tags" de tags ya existentes en el evento. Si el
  valor del Excel (ignorando mayúsculas/minúsculas, espacios y errores de
  tipeo triviales) es claramente el mismo tag que uno de esa lista, usa
  EXACTAMENTE ese tag existente (con su capitalización original) — no
  crees un duplicado. Si varias filas de este mismo archivo usan
  variaciones de escritura del mismo tag nuevo (ej. "amigos", "Amigos",
  "amigoss"), usa una única versión normalizada (Title Case) consistente
  para todas esas filas. No fusiones tags que sean genuinamente distintos
  aunque se parezcan (ej. "Amigos" y "Amigos Novia" NO son el mismo tag).
- type: mapea la columna de género/categoría a female | male | child | undefined.
- tier: NO es una decisión tuya de prioridad — solo traduce si el Excel ya
  trae una señal explícita de prioridad (números, "alta/baja", estrellas).
  Más alto → A, más bajo → D. Si no hay ninguna señal, usa null.
- side: matchea SOLO por nombre exacto contra el array owners que te dan
  como contexto. Un genérico "de parte del novio/la novia" sin nombre
  propio, o un nombre que no hace match, siempre es null. Nunca infieras
  por heurística de género o contexto.
- notes: null por default; cualquier anotación que no encaje en otro
  campo estructurado va aquí tal cual.
- phone_number: se sube tal cual viene, sin asumir lada.
- companion_of: solo si el Excel indica explícitamente que esta persona
  acompaña a otra persona presente en el mismo archivo.

Responde ÚNICAMENTE con el array JSON, sin texto adicional ni markdown.`;

function coerceRow(raw) {
    const type = VALID_TYPES.includes(raw?.type) ? raw.type : 'undefined';
    const tier = VALID_TIERS.includes(raw?.tier) ? raw.tier : null;

    return {
        name: String(raw?.name ?? '').trim(),
        phone_number: raw?.phone_number != null ? String(raw.phone_number).trim() : '',
        tag: raw?.tag || null,
        type,
        tier,
        side: raw?.side || null,
        notes: raw?.notes || null,
        meal: raw?.meal || null,
        special_needs: raw?.special_needs || null,
        companion_of: raw?.companion_of || null,
    };
}

async function normalizeGuests(req, res) {
    const { invitation_id, owners, tags, rows } = req.body;

    if (!invitation_id) return res.status(400).json({ success: false, error: 'invitation_id es requerido' });
    if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ success: false, error: 'rows debe ser un array con al menos una fila' });
    }

    const startedAt = Date.now();

    try {
        const model = genAI.getGenerativeModel({
            model: AI_MODELS.GEMINI,
            generationConfig: { responseMimeType: 'application/json' },
        });

        const contextText = `owners: ${JSON.stringify(owners || [])}\ntags: ${JSON.stringify(tags || [])}\n\nFilas del Excel:\n${JSON.stringify(rows)}`;

        const result = await model.generateContent({
            systemInstruction: NORMALIZE_SYSTEM_PROMPT,
            contents: [{ role: 'user', parts: [{ text: contextText }] }],
        });

        let parsed;
        try {
            parsed = JSON.parse(result.response.text());
        } catch (parseErr) {
            throw new Error('Gemini no devolvió un JSON válido: ' + parseErr.message);
        }

        if (!Array.isArray(parsed)) throw new Error('Gemini no devolvió un array');

        const normalizedRows = parsed.map((raw) => {
            const row = coerceRow(raw);
            const side = owners?.includes(row.side) ? row.side : null;
            return { ...row, side };
        });

        const usage = result.response.usageMetadata;
        const tokensIn = usage?.promptTokenCount || 0;
        const tokensOut = usage?.candidatesTokenCount || 0;
        const costUsd = calculateCost(AI_MODELS.GEMINI, tokensIn, tokensOut);

        await supabase.rpc('log_ai_interaction', {
            p_invitation_id: invitation_id,
            p_model: AI_MODELS.GEMINI,
            p_tokens_in: tokensIn,
            p_tokens_out: tokensOut,
            p_cost_usd: costUsd,
            p_tool_called: 'bulk_import_normalize',
            p_duration_ms: Date.now() - startedAt,
            p_success: true,
        });

        return res.json({ success: true, rows: normalizedRows });
    } catch (err) {
        console.error('Error en POST /api/guests/import/normalize:', err);

        await supabase.rpc('log_ai_interaction', {
            p_invitation_id: invitation_id,
            p_model: AI_MODELS.GEMINI,
            p_tokens_in: 0,
            p_tokens_out: 0,
            p_cost_usd: 0,
            p_tool_called: 'bulk_import_normalize',
            p_duration_ms: Date.now() - startedAt,
            p_success: false,
            p_error_message: err.message,
        }).catch(() => {});

        return res.status(500).json({ success: false, error: err.message });
    }
}

async function confirmImport(req, res) {
    const { invitation_id, side_events_id, rows } = req.body;
    const target_table = side_events_id ? 'side_events_guests' : 'guests';

    if (!invitation_id) return res.status(400).json({ success: false, error: 'invitation_id es requerido' });
    if (target_table === 'side_events_guests' && !side_events_id) {
        return res.status(400).json({ success: false, error: 'side_events_id es requerido para side_events_guests' });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ success: false, error: 'rows debe ser un array con al menos una fila' });
    }

    try {
        const preparedRows = rows.map((raw) => {
            const row = coerceRow(raw);
            if (!row.name) throw new Error('Todas las filas requieren name');
            return { ...row, password: generateSimpleId() };
        });

        const rowsForInsert = preparedRows.map(({ companion_of, special_needs, ...rest }) =>
            target_table === 'guests' ? { ...rest, special_needs } : rest
        );

        const { data: inserted, error: insertError } = await supabase.rpc('bulk_create_guests', {
            p_invitation_id: target_table === 'guests' ? invitation_id : null,
            p_side_events_id: target_table === 'side_events_guests' ? side_events_id : null,
            p_target_table: target_table,
            p_rows: rowsForInsert,
        });

        if (insertError) throw insertError;

        const nameToId = new Map();
        inserted.forEach((g) => {
            if (!nameToId.has(g.name)) nameToId.set(g.name, g.id);
        });

        const pairs = [];
        const unmatchedCompanions = [];
        preparedRows.forEach((row, index) => {
            if (!row.companion_of) return;
            const companionGuestId = inserted[index]?.id;
            const primaryId = nameToId.get(row.companion_of);
            if (!companionGuestId || !primaryId) {
                unmatchedCompanions.push(row.companion_of);
                return;
            }
            pairs.push({ guest_id: companionGuestId, companion_id: primaryId });
        });

        if (pairs.length > 0) {
            const { error: companionError } = await supabase.rpc('bulk_set_guest_companions', {
                p_target_table: target_table,
                p_pairs: pairs,
            });
            if (companionError) throw companionError;
        }

        return res.json({
            success: true,
            inserted_count: inserted.length,
            unmatched_companions: unmatchedCompanions,
        });
    } catch (err) {
        console.error('Error en POST /api/guests/import/confirm:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

module.exports = { normalizeGuests, confirmImport };
