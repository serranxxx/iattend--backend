const supabase = require('../config/supabase');

// ¿El Pop puede usar funciones Plus? RPC pop_es_plus (Pop marcado Plus,
// dueño con Pops Plus o Administración; un side event de boda siempre).
// Sin la migración 2026-11-23c, no se bloquea nada.
const popEsPlus = async (id) => {
    const { data, error } = await supabase.rpc('pop_es_plus', { p_side_event_id: Number(id) });
    if (error) {
        if (error.code === 'PGRST202' || error.code === '42883') return true;
        throw error;
    }
    return data === true;
};

module.exports = { popEsPlus };
