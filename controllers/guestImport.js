const supabase = require('../config/supabase');
const { genAI, anthropic, AI_MODELS, calculateCost } = require('../config/ai.config');
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
    // Un Pop no tiene invitación: llega solo side_events_id (validarAccesoEvento
    // ya revisó que quien llama lo gestiona). Sin lados ni etiquetas propias.
    const { invitation_id, side_events_id, owners, tags, rows } = req.body;

    if (!invitation_id && !side_events_id) {
        return res.status(400).json({ success: false, error: 'invitation_id o side_events_id es requerido' });
    }
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
            p_invitation_id: invitation_id || null,
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
            p_invitation_id: invitation_id || null,
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

// ── Mapeo de columnas ──────────────────────────────────────────────────
// La IA ya no recibe la lista completa: solo los encabezados, unas filas de
// muestra y los valores distintos de las columnas "de categoría" (pocos
// valores). Devuelve qué columna es cada dato y cómo traducir esos valores;
// el front lo aplica a todas las filas. Así no importa el tamaño de la lista
// (antes 100 KB o una respuesta cortada tronaban todo), sale más rápido y no
// se manda a Google la lista entera de nombres y teléfonos.
const CAMPOS_SIMPLES = ['phone_number', 'phone_code', 'tag', 'type', 'tier', 'side', 'meal', 'special_needs', 'companion_of'];
const MAX_MUESTRA = 6;
const MAX_ENCABEZADOS = 80;

const MAP_SYSTEM_PROMPT = `Eres un asistente que entiende listas de invitados subidas en Excel a la
plataforma de eventos I attend. NO recibes la lista completa: recibes los
encabezados de las columnas, unas filas de muestra y, para las columnas con
pocos valores distintos, esos valores. Tu trabajo es decir qué columna
corresponde a cada dato y cómo traducir los valores de categoría.

Devuelve EXACTAMENTE este JSON (usa el texto EXACTO del encabezado):
{
  "name": ["encabezado", ...],      // columna(s) que forman el nombre completo, en orden (ej. ["Nombre", "Apellido"]). [] si no hay.
  "phone_number": "encabezado" | null,
  "phone_code": "encabezado" | null, // solo si la lada viene en una columna aparte
  "tag": "encabezado" | null,        // grupo / etiqueta (familia, amigos, trabajo…)
  "type": "encabezado" | null,       // género o categoría (hombre / mujer / niño)
  "tier": "encabezado" | null,       // prioridad explícita
  "side": "encabezado" | null,       // de parte de quién (novio / novia…)
  "notes": ["encabezado", ...],      // columnas útiles que no encajan en otro campo
  "meal": "encabezado" | null,       // menú / comida
  "special_needs": "encabezado" | null, // alergias, silla de ruedas, etc.
  "companion_of": "encabezado" | null,  // nombre de la persona a la que acompaña
  "values": {
    "type": { "valor tal cual": "female" | "male" | "child" | "undefined" },
    "tier": { "valor tal cual": "A" | "B" | "C" | "D" | null },
    "side": { "valor tal cual": "owner exacto" | null },
    "tag":  { "valor tal cual": "Etiqueta normalizada" }
  }
}

Reglas:
- Una columna va en un solo campo. Ignora columnas vacías, de numeración
  (#, No.) o de estado ("confirmado", "enviado").
- tier: solo si hay una señal explícita de prioridad. Más alto → A, más bajo → D.
- side: traduce SOLO a un nombre EXACTO del array owners; un genérico
  ("novio", "novia") sin nombre propio que coincida, o sin owners, es null.
- tag: si un valor es claramente una etiqueta existente de "tags" (ignora
  mayúsculas, espacios y errores de tipeo), usa la existente tal cual; si no,
  normaliza en Title Case y usa la misma versión para variaciones del mismo
  valor. No fusiones etiquetas distintas ("Amigos" ≠ "Amigos Novia").
- En "values" incluye solo las columnas que elegiste para esos campos.
Responde ÚNICAMENTE con el JSON, sin texto adicional ni markdown.`;

const recortar = (v, n = 60) => String(v ?? '').slice(0, n);

function limpiarMapeo(raw, encabezados, owners) {
    const existe = (h) => typeof h === 'string' && encabezados.includes(h);
    const usados = new Set();
    const tomar = (h) => {
        if (!existe(h) || usados.has(h)) return null;
        usados.add(h);
        return h;
    };
    const lista = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(tomar).filter(Boolean);

    const mapeo = { name: lista(raw?.name) };
    CAMPOS_SIMPLES.forEach((campo) => { mapeo[campo] = tomar(raw?.[campo]); });
    mapeo.notes = lista(raw?.notes);

    const valores = raw?.values || {};
    const objeto = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
    const filtrar = (o, valido) => Object.fromEntries(
        Object.entries(objeto(o)).filter(([, v]) => valido(v)).map(([k, v]) => [String(k), v])
    );
    mapeo.values = {
        type: filtrar(valores.type, (v) => VALID_TYPES.includes(v)),
        tier: filtrar(valores.tier, (v) => v === null || VALID_TIERS.includes(v)),
        side: filtrar(valores.side, (v) => v === null || (owners || []).includes(v)),
        tag: filtrar(valores.tag, (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 60),
    };
    return mapeo;
}

async function mapColumns(req, res) {
    const { invitation_id, side_events_id, owners, tags, headers, sample, values } = req.body;

    if (!invitation_id && !side_events_id) {
        return res.status(400).json({ success: false, error: 'invitation_id o side_events_id es requerido' });
    }
    if (!Array.isArray(headers) || headers.length === 0) {
        return res.status(400).json({ success: false, error: 'headers debe traer al menos una columna' });
    }

    const encabezados = headers.slice(0, MAX_ENCABEZADOS).map((h) => recortar(h, 80));
    const muestra = (Array.isArray(sample) ? sample : []).slice(0, MAX_MUESTRA).map((fila) =>
        Object.fromEntries(encabezados.map((h) => [h, recortar(fila?.[h])]))
    );
    const distintos = Object.fromEntries(
        Object.entries(values && typeof values === 'object' ? values : {})
            .filter(([h]) => encabezados.includes(h))
            .map(([h, vs]) => [h, (Array.isArray(vs) ? vs : []).slice(0, 40).map((v) => recortar(v, 40))])
    );

    const startedAt = Date.now();
    const log = (modelo, extra) => supabase.rpc('log_ai_interaction', {
        p_invitation_id: invitation_id || null,
        p_model: modelo,
        p_tool_called: 'bulk_import_map',
        p_duration_ms: Date.now() - startedAt,
        ...extra,
    }).then(() => {}, () => {});

    const contexto = JSON.stringify({
        owners: owners || [],
        tags: tags || [],
        encabezados,
        muestra,
        valores_distintos: distintos,
    });
    const leerJSON = (texto) => {
        const limpio = String(texto || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
        return JSON.parse(limpio);
    };

    // Gemini primero (el de siempre); si falla (sin saldo, caído), Haiku.
    // Es una llamada chica: unas cuantas columnas, no la lista.
    const proveedores = [
        async () => {
            const model = genAI.getGenerativeModel({
                model: AI_MODELS.GEMINI,
                generationConfig: { responseMimeType: 'application/json' },
            });
            const result = await model.generateContent({
                systemInstruction: MAP_SYSTEM_PROMPT,
                contents: [{ role: 'user', parts: [{ text: contexto }] }],
            });
            const usage = result.response.usageMetadata;
            return { modelo: AI_MODELS.GEMINI, json: leerJSON(result.response.text()), tin: usage?.promptTokenCount || 0, tout: usage?.candidatesTokenCount || 0 };
        },
        async () => {
            const msg = await anthropic.messages.create({
                model: AI_MODELS.HAIKU,
                max_tokens: 2000,
                system: MAP_SYSTEM_PROMPT,
                messages: [{ role: 'user', content: contexto }],
            });
            const texto = msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
            return { modelo: AI_MODELS.HAIKU, json: leerJSON(texto), tin: msg.usage?.input_tokens || 0, tout: msg.usage?.output_tokens || 0 };
        },
    ];

    const errores = [];
    for (const llamar of proveedores) {
        try {
            const { modelo, json, tin, tout } = await llamar();
            const mapeo = limpiarMapeo(json, encabezados, owners);
            log(modelo, { p_tokens_in: tin, p_tokens_out: tout, p_cost_usd: calculateCost(modelo, tin, tout), p_success: true });
            return res.json({ success: true, mapping: mapeo });
        } catch (err) {
            errores.push(err.message);
            console.error('Error en POST /api/guests/import/map:', err.message);
        }
    }
    log(AI_MODELS.GEMINI, { p_tokens_in: 0, p_tokens_out: 0, p_cost_usd: 0, p_success: false, p_error_message: errores.join(' | ') });
    return res.status(502).json({ success: false, error: 'No se pudieron leer las columnas' });
}

// Invitados que ya tiene el evento (solo nombre y teléfono), para marcar
// posibles duplicados antes de importar. Con la service role: la tabla de
// invitados de un Pop no se lee con la anon key.
async function existingGuests(req, res) {
    const { invitation_id, side_events_id } = req.body;
    try {
        const consulta = side_events_id
            ? supabase.from('side_events_guests').select('name, phone_number').eq('side_events_id', side_events_id)
            : supabase.from('guests').select('name, phone_number').eq('invitation_id', invitation_id);
        const { data, error } = await consulta.limit(10000);
        if (error) throw error;
        return res.json({ success: true, guests: data ?? [] });
    } catch (err) {
        console.error('Error en POST /api/guests/import/existentes:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

// ── Confirmar ──────────────────────────────────────────────────────────
// Cada fila puede traer `companion_index` (índice en este mismo arreglo de la
// persona a la que acompaña). Todo va en una sola RPC (`importar_invitados`):
// o se guardan invitados y acompañantes, o nada — antes, si fallaba el paso
// de acompañantes, los invitados ya quedaban y al reintentar se duplicaban.
// Sin la migración, cae al camino de dos pasos de antes.
const MAX_FILAS = 3000;

const faltaFuncion = (error) =>
    error?.code === 'PGRST202' || error?.code === '42883' || /could not find the function/i.test(error?.message || '');

async function confirmImport(req, res) {
    const { invitation_id, side_events_id, rows } = req.body;
    const target_table = side_events_id ? 'side_events_guests' : 'guests';

    // Side event de boda: invitation_id + side_events_id. Pop: solo side_events_id.
    if (!invitation_id && !side_events_id) {
        return res.status(400).json({ success: false, error: 'invitation_id o side_events_id es requerido' });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ success: false, error: 'rows debe ser un array con al menos una fila' });
    }
    if (rows.length > MAX_FILAS) {
        return res.status(400).json({ success: false, error: `Máximo ${MAX_FILAS} invitados por archivo` });
    }

    try {
        const preparadas = rows.map((raw, i) => {
            const row = coerceRow(raw);
            if (!row.name) throw new Error(`La fila ${i + 1} no tiene nombre`);
            const ci = Number.isInteger(raw?.companion_index) ? raw.companion_index : null;
            return {
                ...row,
                password: generateSimpleId(),
                companion_index: ci != null && ci >= 0 && ci < rows.length && ci !== i ? ci : null,
            };
        });

        // Formato viejo (front sin desplegar): companion_of por nombre.
        const primeraPorNombre = new Map();
        preparadas.forEach((r, i) => { if (!primeraPorNombre.has(r.name)) primeraPorNombre.set(r.name, i); });
        const sinTitular = [];
        preparadas.forEach((r) => {
            if (r.companion_index != null || !r.companion_of) return;
            const idx = primeraPorNombre.get(r.companion_of);
            if (idx == null) sinTitular.push(r.companion_of);
            else r.companion_index = idx;
        });

        const filas = preparadas.map(({ companion_of, special_needs, ...rest }) =>
            target_table === 'guests' ? { ...rest, special_needs } : rest
        );

        const { data, error } = await supabase.rpc('importar_invitados', {
            p_invitation_id: target_table === 'guests' ? invitation_id : null,
            p_side_events_id: target_table === 'side_events_guests' ? side_events_id : null,
            p_rows: filas,
        });

        if (!error) {
            return res.json({
                success: true,
                inserted_count: Array.isArray(data) ? data.length : filas.length,
                unmatched_companions: sinTitular,
            });
        }
        if (!faltaFuncion(error)) throw error;

        // Respaldo sin la migración 2026-11-12_importar_invitados.sql.
        const { data: inserted, error: insertError } = await supabase.rpc('bulk_create_guests', {
            p_invitation_id: target_table === 'guests' ? invitation_id : null,
            p_side_events_id: target_table === 'side_events_guests' ? side_events_id : null,
            p_target_table: target_table,
            p_rows: filas.map(({ companion_index, ...rest }) => rest),
        });
        if (insertError) throw insertError;

        const pairs = [];
        preparadas.forEach((r, i) => {
            if (r.companion_index == null) return;
            const guestId = inserted[i]?.id;
            const titularId = inserted[r.companion_index]?.id;
            if (guestId && titularId) pairs.push({ guest_id: guestId, companion_id: titularId });
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
            unmatched_companions: sinTitular,
        });
    } catch (err) {
        console.error('Error en POST /api/guests/import/confirm:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

module.exports = { normalizeGuests, mapColumns, existingGuests, confirmImport };
