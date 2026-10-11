const supabase = require('../config/supabase');

// Invitación de prueba con la que nace toda cuenta de planner: una copia de
// esta plantilla (Camila & Rodrigo, con invitados, mesas, side events y Save
// the Date) para que conozca la plataforma con un evento completo.
// La plantilla vive en la cuenta theweddingcompanymty; no se modifica.
const PLANNER_TEMPLATE_ID = 'bf8acf70-7853-4867-b5a3-6c66f4cdb4d5';

const slugify = (texto) => String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'planner';

// `name` es el slug de la URL pública (iattend.events/wedding/<name>).
const nombreLibre = async (base) => {
    const { data } = await supabase
        .from('invitations')
        .select('name')
        .like('name', `${base}%`);
    const usados = new Set((data || []).map(r => r.name));
    if (!usados.has(base)) return base;
    for (let n = 2; ; n++) {
        if (!usados.has(`${base}-${n}`)) return `${base}-${n}`;
    }
};

const sinIdNiFechas = ({ id, created_at, updated_at, ...resto }) => resto;

/**
 * Copia la plantilla a la cuenta del planner. La copia queda a su nombre
 * (dueño y planner) y siempre con `is_test`: no cuenta en estadísticas.
 * Si algo falla a medio camino, borra lo que alcanzó a crear.
 * @returns {Promise<string>} id de la invitación nueva
 */
async function clonarPlantillaPlanner({ plannerId, plannerEmail, plannerName }) {
    const { data: plantilla, error: plantillaError } = await supabase
        .from('invitations')
        .select('*')
        .eq('id', PLANNER_TEMPLATE_ID)
        .single();
    if (plantillaError || !plantilla) {
        throw new Error(`No se encontró la plantilla de planners: ${plantillaError?.message || PLANNER_TEMPLATE_ID}`);
    }

    const name = await nombreLibre(`prueba-${slugify(plannerName || plannerEmail?.split('@')[0])}`);
    const data = {
        ...plantilla.data,
        generals: {
            ...plantilla.data?.generals,
            event: { ...plantilla.data?.generals?.event, name },
        },
    };

    const { data: nueva, error: invError } = await supabase
        .from('invitations')
        .insert({
            ...sinIdNiFechas(plantilla),
            data,
            name,
            user_id: plannerId,
            user_email: plannerEmail,
            planner_id: plannerId,
            mongo_id: null,
            is_test: true,
        })
        .select('id')
        .single();
    if (invError) throw new Error(`No se pudo crear la invitación de prueba: ${invError.message}`);

    const invitationId = nueva.id;

    try {
        // Mesas: los invitados las referencian por id.
        const { data: mesas, error: mesasError } = await supabase
            .from('tables').select('*').eq('invitation_id', PLANNER_TEMPLATE_ID);
        if (mesasError) throw mesasError;

        const mesaNueva = {};
        for (const mesa of mesas || []) {
            const { id, created_at, last_update_at, ...resto } = mesa;
            const { data: m, error } = await supabase
                .from('tables').insert({ ...resto, invitation_id: invitationId }).select('id').single();
            if (error) throw error;
            mesaNueva[id] = m.id;
        }

        // Invitados: primero titulares y luego acompañantes, cuyo
        // `companion_id` apunta al id del titular.
        const { data: invitados, error: invitadosError } = await supabase
            .from('guests').select('*').eq('invitation_id', PLANNER_TEMPLATE_ID).order('id');
        if (invitadosError) throw invitadosError;

        // Se insertan en bloque; el id nuevo se recupera por `password`, que es
        // único por invitado dentro de la invitación.
        const invitadoNuevo = {};
        const copiar = async (lista) => {
            if (!lista.length) return;
            const { data: nuevos, error } = await supabase
                .from('guests')
                .insert(lista.map(({ id, created_at, ...resto }) => ({
                    ...resto,
                    invitation_id: invitationId,
                    table: resto.table != null ? (mesaNueva[resto.table] ?? null) : null,
                    companion_id: resto.companion_id != null ? (invitadoNuevo[resto.companion_id] ?? null) : null,
                })))
                .select('id, password');
            if (error) throw error;
            const porPassword = Object.fromEntries(nuevos.map(n => [n.password, n.id]));
            lista.forEach(g => { invitadoNuevo[g.id] = porPassword[g.password]; });
        };
        await copiar((invitados || []).filter(g => g.companion_id == null));
        await copiar((invitados || []).filter(g => g.companion_id != null));

        // Side events (la plantilla no tiene invitados en ellos).
        const { data: sides, error: sidesError } = await supabase
            .from('side_events').select('*').eq('invitation_id', PLANNER_TEMPLATE_ID);
        if (sidesError) throw sidesError;
        if (sides?.length) {
            const { error } = await supabase.from('side_events').insert(
                sides.map(({ id, created_at, ...resto }) => ({ ...resto, invitation_id: invitationId }))
            );
            if (error) throw error;
        }

        const { data: std, error: stdError } = await supabase
            .from('save_the_dates').select('*').eq('invitation_id', PLANNER_TEMPLATE_ID).maybeSingle();
        if (stdError) throw stdError;
        if (std) {
            const { error } = await supabase
                .from('save_the_dates').insert({ ...sinIdNiFechas(std), invitation_id: invitationId });
            if (error) throw error;
        }

        // Notas del evento: pasan a ser del planner nuevo.
        const { data: notas, error: notasError } = await supabase
            .from('planner_notes').select('*').eq('invitation_id', PLANNER_TEMPLATE_ID);
        if (notasError) throw notasError;
        if (notas?.length) {
            const { error } = await supabase.from('planner_notes').insert(
                notas.map(n => ({ ...sinIdNiFechas(n), done_at: null, done: false, invitation_id: invitationId, planner_id: plannerId }))
            );
            if (error) throw error;
        }
    } catch (error) {
        await deshacer(invitationId);
        throw new Error(`No se pudo copiar la plantilla de planners: ${error.message}`);
    }

    return invitationId;
}

// Rollback a mano (PostgREST no tiene transacciones): solo toca filas de la
// invitación que se acaba de crear.
async function deshacer(invitationId) {
    const { data: sides } = await supabase.from('side_events').select('id').eq('invitation_id', invitationId);
    if (sides?.length) await supabase.from('side_events_guests').delete().in('side_events_id', sides.map(s => s.id));
    await supabase.from('side_events').delete().eq('invitation_id', invitationId);
    await supabase.from('guests').delete().eq('invitation_id', invitationId).not('companion_id', 'is', null);
    await supabase.from('guests').delete().eq('invitation_id', invitationId);
    await supabase.from('tables').delete().eq('invitation_id', invitationId);
    await supabase.from('save_the_dates').delete().eq('invitation_id', invitationId);
    await supabase.from('planner_notes').delete().eq('invitation_id', invitationId);
    await supabase.from('invitations').delete().eq('id', invitationId);
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Plantilla para una cuenta recién creada. El trigger de auth.users resincroniza
 * profiles un momento después del alta y puede pisar el rol; sin rol de planner,
 * el trigger check_invitation_planner rechaza la copia ("is not a planner").
 * Por eso se reafirma el rol justo antes de copiar y, si aun así lo rechaza,
 * se espera, se reafirma otra vez y se reintenta una vez.
 * @returns {Promise<string>} id de la invitación nueva
 */
async function clonarPlantillaNuevoPlanner({ plannerId, plannerEmail, plannerName, role = 'planner' }) {
    const reafirmarRol = () => supabase.from('profiles').update({ role }).eq('user_id', plannerId);
    await reafirmarRol();
    try {
        return await clonarPlantillaPlanner({ plannerId, plannerEmail, plannerName });
    } catch (error) {
        if (!/is not a planner/i.test(error.message)) throw error;
        await esperar(2500);
        await reafirmarRol();
        return clonarPlantillaPlanner({ plannerId, plannerEmail, plannerName });
    }
}

module.exports = { clonarPlantillaPlanner, clonarPlantillaNuevoPlanner, PLANNER_TEMPLATE_ID };
