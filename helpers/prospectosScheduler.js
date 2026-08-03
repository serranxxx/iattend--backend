const supabase = require('../config/supabase');

const DIAS_LIMITE = 10;
const INTERVALO_MS = 60 * 60 * 1000; // corre cada hora mientras el proceso esté vivo

const moverProspectosEstancados = async () => {
    const limite = new Date();
    limite.setDate(limite.getDate() - DIAS_LIMITE);

    const { data, error } = await supabase
        .from('prospectos_ig')
        .update({ estado: 'volver_a_contactar', updated_at: new Date().toISOString() })
        .eq('estado', 'en_conversacion')
        .lt('updated_at', limite.toISOString())
        .select('id');

    if (error) {
        console.error('[prospectos_ig] error moviendo prospectos estancados:', error);
        return;
    }

    if (data?.length) {
        console.log(`[prospectos_ig] ${data.length} prospecto(s) movidos a volver_a_contactar por ${DIAS_LIMITE}+ días sin actividad`);
    }
};

const iniciarReglaVolverAContactar = () => {
    moverProspectosEstancados();
    setInterval(moverProspectosEstancados, INTERVALO_MS);
};

module.exports = { iniciarReglaVolverAContactar };
