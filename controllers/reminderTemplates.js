const { response } = require('express');
const supabase = require('../config/supabase');
const { processBatch } = require('../services/whatsappBulkWorker');

// Banco de recordatorios (plantillas de WhatsApp para comunicados a
// invitados). Ver migrations/2026-10-27_create_reminder_templates.sql y
// iattend-vite docs/recordatorios.md.

// Fuentes que puede tomar cada {{n}}. Los valores los resuelve la app por
// invitado (reminderVariables.js en iattend-vite); aquí solo se valida que
// la plantilla use fuentes conocidas. Si agregas una, agrégala en los dos.
const VARIABLES = ['guest_name', 'event_title', 'event_date', 'rsvp_deadline', 'invitation_path', 'link_image'];

const SEGMENTOS = ['todos', 'esperando', 'leyeron', 'confirmados', 'sinMesa'];
const CAMPOS_REGLA = ['state', 'tag', 'side', 'tier', 'table', 'read'];

const TEXTOS = ['name', 'description', 'body', 'footer', 'meta_name', 'language_code', 'button_label', 'button_url', 'button_variable', 'header_image_variable'];
const URL_HTTPS = /^https:\/\/\S+$/i;
const SLUG = /^[a-z0-9_-]+$/;
const MAX_LOTE = 500;
const MAX_PARAM = 1000;
// Mismo criterio que la app: solo números de México reciben WhatsApp.
const TELEFONO_MX = /^\+52\d+/;
// Ventana para no mandar el mismo recordatorio dos veces al mismo invitado.
const VENTANA_REPETIDO_MS = 20 * 60 * 60 * 1000;

const contarVariables = (body = '') => {
    const numeros = [...String(body).matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
    return numeros.length ? Math.max(...numeros) : 0;
};

const prepararSugerencia = (s) => {
    if (s === null) return { valor: {} };
    if (typeof s !== 'object' || Array.isArray(s)) return { error: 'suggestion debe ser un objeto' };
    const valor = {};
    if (s.segment !== undefined && s.segment !== null) {
        if (!SEGMENTOS.includes(s.segment)) return { error: 'Segmento de la sugerencia no válido' };
        valor.segment = s.segment;
    }
    if (s.rules !== undefined) {
        if (!Array.isArray(s.rules)) return { error: 'rules debe ser una lista' };
        const malas = s.rules.find(r => !CAMPOS_REGLA.includes(r?.field) || !['es', 'no'].includes(r?.op) || typeof r?.value !== 'string');
        if (malas) return { error: 'Hay una regla de la sugerencia no válida' };
        valor.rules = s.rules.map(r => ({ field: r.field, op: r.op, value: r.value }));
    }
    if (s.comb !== undefined) valor.comb = s.comb === 'or' ? 'or' : 'and';
    for (const campo of ['title', 'reason']) {
        if (typeof s[campo] === 'string' && s[campo].trim()) valor[campo] = s[campo].trim().slice(0, 300);
    }
    return { valor };
};

// Valida el body y devuelve { error } o { valor } con solo los campos presentes.
const prepararCambios = (body, actual = null) => {
    const cambios = {};

    if (body.slug !== undefined || !actual) {
        const slug = String(body.slug ?? '').trim().toLowerCase();
        if (!SLUG.test(slug)) return { error: 'La llave solo admite minúsculas, números, - y _' };
        cambios.slug = slug;
    }

    for (const campo of TEXTOS) {
        if (body[campo] === undefined) continue;
        if (body[campo] !== null && typeof body[campo] !== 'string') return { error: `${campo} debe ser texto` };
        cambios[campo] = body[campo]?.trim() || null;
    }

    const final = { ...(actual ?? {}), ...cambios };
    if (!final.name) return { error: 'El nombre es requerido' };
    if (!final.meta_name) return { error: 'El nombre de la plantilla en Meta es requerido' };
    if (!final.body) return { error: 'El texto del mensaje es requerido' };
    if ('language_code' in cambios && !cambios.language_code) cambios.language_code = 'es_MX';

    if (body.body_variables !== undefined) {
        if (!Array.isArray(body.body_variables)) return { error: 'body_variables debe ser una lista' };
        cambios.body_variables = body.body_variables.map(v => String(v ?? ''));
    }
    const variables = cambios.body_variables ?? final.body_variables ?? [];
    if (variables.some(v => !VARIABLES.includes(v))) return { error: 'Cada {{n}} del texto necesita un dato asignado' };
    if (variables.length !== contarVariables(final.body)) {
        return { error: `El texto tiene ${contarVariables(final.body)} variables y hay ${variables.length} asignadas` };
    }

    const imagenVariable = 'header_image_variable' in cambios ? cambios.header_image_variable : final.header_image_variable;
    if (imagenVariable && !VARIABLES.includes(imagenVariable)) return { error: 'El dato de la imagen no es válido' };

    const botonVariable = 'button_variable' in cambios ? cambios.button_variable : final.button_variable;
    if (botonVariable && !VARIABLES.includes(botonVariable)) return { error: 'El dato del botón no es válido' };
    const botonUrl = 'button_url' in cambios ? cambios.button_url : final.button_url;
    if (botonUrl && /\{\{1\}\}/.test(botonUrl) && !botonVariable) return { error: 'La URL del botón tiene {{1}}: asígnale un dato' };

    if (body.suggestion !== undefined) {
        const { error, valor } = prepararSugerencia(body.suggestion);
        if (error) return { error };
        cambios.suggestion = valor;
    }

    if (body.is_active !== undefined) {
        if (typeof body.is_active !== 'boolean') return { error: 'is_active debe ser booleano' };
        cambios.is_active = body.is_active;
    }

    if (body.sort_order !== undefined) {
        if (!Number.isInteger(body.sort_order) || body.sort_order < 0) return { error: 'sort_order no válido' };
        cambios.sort_order = body.sort_order;
    }

    return { valor: cambios };
};

const errorDeLlave = (error) => (error?.code === '23505' ? 'Ya existe un recordatorio con esa llave' : error?.message);

// GET /api/admin/reminder-templates — todas, activas o no.
const listarPlantillas = async (req, res = response) => {
    const { data, error } = await supabase
        .from('reminder_templates')
        .select('*')
        .order('sort_order', { ascending: true });

    if (error) return res.status(500).json({ ok: false, msg: error.message });
    return res.status(200).json({ ok: true, templates: data || [], variables: VARIABLES });
};

const crearPlantilla = async (req, res = response) => {
    try {
        const { error: validacion, valor } = prepararCambios(req.body || {});
        if (validacion) return res.status(400).json({ ok: false, msg: validacion });

        if (valor.sort_order === undefined) {
            const { data: ultimo } = await supabase
                .from('reminder_templates')
                .select('sort_order')
                .order('sort_order', { ascending: false })
                .limit(1)
                .maybeSingle();
            valor.sort_order = (ultimo?.sort_order ?? 0) + 1;
        }

        const { data, error } = await supabase
            .from('reminder_templates')
            .insert({ ...valor, updated_by: req.adminUserId })
            .select('*')
            .single();

        if (error) return res.status(error.code === '23505' ? 409 : 500).json({ ok: false, msg: errorDeLlave(error) });
        return res.status(201).json({ ok: true, template: data });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

const actualizarPlantilla = async (req, res = response) => {
    try {
        const { data: actual, error: errorLectura } = await supabase
            .from('reminder_templates')
            .select('*')
            .eq('id', req.params.id)
            .maybeSingle();

        if (errorLectura) return res.status(500).json({ ok: false, msg: errorLectura.message });
        if (!actual) return res.status(404).json({ ok: false, msg: 'Recordatorio no encontrado' });

        const { error: validacion, valor } = prepararCambios(req.body || {}, actual);
        if (validacion) return res.status(400).json({ ok: false, msg: validacion });
        if (!Object.keys(valor).length) return res.status(400).json({ ok: false, msg: 'No hay cambios que guardar' });

        const { data, error } = await supabase
            .from('reminder_templates')
            .update({ ...valor, updated_by: req.adminUserId })
            .eq('id', req.params.id)
            .select('*')
            .maybeSingle();

        if (error) return res.status(error.code === '23505' ? 409 : 500).json({ ok: false, msg: errorDeLlave(error) });
        return res.status(200).json({ ok: true, template: data });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

const eliminarPlantilla = async (req, res = response) => {
    const { error } = await supabase.from('reminder_templates').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ ok: false, msg: error.message });
    return res.status(200).json({ ok: true });
};

// Body: { ids: [...] } en el orden nuevo. Reescribe sort_order 1..n.
const reordenarPlantillas = async (req, res = response) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ ok: false, msg: 'ids es requerido' });

    try {
        const resultados = await Promise.all(ids.map((id, index) =>
            supabase.from('reminder_templates').update({ sort_order: index + 1, updated_by: req.adminUserId }).eq('id', id)
        ));
        const fallo = resultados.find(r => r.error);
        if (fallo) return res.status(500).json({ ok: false, msg: fallo.error.message });
        return res.status(200).json({ ok: true });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

// Payload de Graph API. Los valores llegan ya resueltos desde la app; aquí
// se arma la plantilla con el nombre y el idioma de la tabla, no del cliente.
const armarPayload = (plantilla, telefono, bodyParams, buttonParam, headerImage) => {
    const components = [];
    if (plantilla.header_image_variable) {
        components.push({
            type: 'header',
            parameters: [{ type: 'image', image: { link: headerImage } }],
        });
    }
    if (bodyParams.length) {
        components.push({
            type: 'body',
            parameters: bodyParams.map(text => ({ type: 'text', text })),
        });
    }
    if (plantilla.button_variable) {
        components.push({
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: buttonParam }],
        });
    }
    return {
        messaging_product: 'whatsapp',
        to: telefono,
        type: 'template',
        template: {
            name: plantilla.meta_name,
            language: { code: plantilla.language_code || 'es_MX' },
            components,
        },
    };
};

// POST /api/whats/reminders/bulk
// Body: { invitationId, templateId, items: [{ guestId, bodyParams: [...], buttonParam, headerImage }] }
//
// Solo titulares (companion_id vacío) de esa invitación con número de México.
// El teléfono y el nombre salen de la base, no del cliente. Se descartan los
// que ya recibieron este mismo recordatorio en las últimas 20 h. Igual que el
// envío masivo de invitaciones: responde 202, la app reserva los créditos
// (accepted) y el worker reembolsa los fallidos al cerrar el lote.
const crearLoteRecordatorio = async (req, res = response) => {
    try {
        const { invitationId, templateId, items } = req.body || {};

        if (!invitationId || !templateId || !Array.isArray(items) || !items.length) {
            return res.status(400).json({ ok: false, msg: 'Missing required fields: invitationId, templateId, items[]' });
        }
        if (items.length > MAX_LOTE) {
            return res.status(400).json({ ok: false, msg: `Batch too large (max ${MAX_LOTE} items)` });
        }

        const { data: plantilla, error: errorPlantilla } = await supabase
            .from('reminder_templates')
            .select('*')
            .eq('id', templateId)
            .eq('is_active', true)
            .maybeSingle();

        if (errorPlantilla) return res.status(500).json({ ok: false, msg: errorPlantilla.message });
        if (!plantilla) return res.status(404).json({ ok: false, msg: 'Ese recordatorio ya no está disponible' });

        const esperadas = (plantilla.body_variables || []).length;
        const malformado = items.find(i =>
            !i?.guestId
            || !Array.isArray(i.bodyParams)
            || i.bodyParams.length !== esperadas
            || i.bodyParams.some(p => typeof p !== 'string' || !p.trim() || p.length > MAX_PARAM)
            || (plantilla.button_variable && (typeof i.buttonParam !== 'string' || !i.buttonParam.trim()))
            || (plantilla.header_image_variable && (typeof i.headerImage !== 'string' || !URL_HTTPS.test(i.headerImage.trim())))
        );
        if (malformado) {
            return res.status(400).json({ ok: false, msg: 'Every item requires guestId and all template params' });
        }

        const ids = [...new Set(items.map(i => Number(i.guestId)))];
        const { data: invitados, error: errorInvitados } = await supabase
            .from('guests')
            .select('id, name, phone_number, companion_id, invitation_id')
            .eq('invitation_id', invitationId)
            .in('id', ids);

        if (errorInvitados) return res.status(500).json({ ok: false, msg: errorInvitados.message });

        const validos = new Map(
            (invitados || [])
                .filter(g => (g.companion_id === null || g.companion_id === undefined) && TELEFONO_MX.test(g.phone_number || ''))
                .map(g => [Number(g.id), g])
        );

        const desde = new Date(Date.now() - VENTANA_REPETIDO_MS).toISOString();
        const { data: recientes } = await supabase
            .from('invitation_reminder_dispatches')
            .select('guest_id')
            .eq('invitation_id', invitationId)
            .eq('reminder_template_id', plantilla.id)
            .neq('status', 'failed')
            .gte('created_at', desde);
        const yaRecibieron = new Set((recientes || []).map(r => Number(r.guest_id)));

        const vistos = new Set();
        const aceptados = [];
        for (const item of items) {
            const guestId = Number(item.guestId);
            const invitado = validos.get(guestId);
            if (!invitado || yaRecibieron.has(guestId) || vistos.has(guestId)) continue;
            vistos.add(guestId);
            const telefono = invitado.phone_number.replace(/^\+/, '');
            aceptados.push({
                guest_id: guestId,
                guest_name: invitado.name || null,
                guest_phone: telefono,
                payload: armarPayload(plantilla, telefono, item.bodyParams.map(p => p.trim()), item.buttonParam?.trim(), item.headerImage?.trim()),
            });
        }

        if (!aceptados.length) {
            return res.status(400).json({ ok: false, msg: 'Ninguno de los invitados puede recibir este recordatorio' });
        }

        const { data: lote, error: errorLote } = await supabase
            .from('invitation_send_batches')
            .insert({
                invitation_id: invitationId,
                kind: 'reminder',
                reminder_template_id: plantilla.id,
                total: aceptados.length,
                status: 'processing',
                credits_reserved: aceptados.length,
            })
            .select()
            .single();

        if (errorLote) return res.status(500).json({ ok: false, msg: 'Error creating send batch', error: errorLote.message });

        const { error: errorItems } = await supabase
            .from('invitation_send_batch_items')
            .insert(aceptados.map(a => ({ ...a, batch_id: lote.id, invitation_id: invitationId, status: 'queued' })));

        if (errorItems) {
            await supabase.from('invitation_send_batches')
                .update({ status: 'completed', completed_at: new Date().toISOString() })
                .eq('id', lote.id);
            return res.status(500).json({ ok: false, msg: 'Error creating batch items', error: errorItems.message });
        }

        processBatch(lote.id).catch(e => console.error('[bulk] processBatch error:', e.message));

        return res.status(202).json({
            ok: true,
            msg: 'Batch accepted',
            data: { batchId: lote.id, total: aceptados.length, skipped: items.length - aceptados.length },
        });
    } catch (error) {
        console.error('Error creating reminder batch:', error.message);
        return res.status(500).json({ ok: false, msg: 'Error creating reminder batch', error: error.message });
    }
};

module.exports = {
    VARIABLES,
    listarPlantillas,
    crearPlantilla,
    actualizarPlantilla,
    eliminarPlantilla,
    reordenarPlantillas,
    crearLoteRecordatorio,
};
