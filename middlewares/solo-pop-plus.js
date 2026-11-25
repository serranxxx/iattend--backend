const { response } = require('express');
const { popEsPlus } = require('../helpers/popPlus');

// Funciones de Pops Plus que no se pueden "probar" (importar desde Excel con
// Lia, traer invitados de otro evento): si el body trae un side event que es
// un Pop Free, 402 POPS_PLUS. Una boda o un side event de boda pasan. Va
// después de validarAccesoEvento (que ya revisó que el evento es suyo).
const soloPopPlus = async (req, res = response, next) => {
    try {
        const sideEventId = req.body?.sideEventId ?? req.body?.side_events_id ?? null;
        if (sideEventId && !(await popEsPlus(sideEventId))) {
            return res.status(402).json({ ok: false, code: 'POPS_PLUS', msg: 'Esta función es de Pops Plus' });
        }
        next();
    } catch (err) {
        console.error('Error revisando el plan del Pop:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo revisar el plan' });
    }
};

module.exports = { soloPopPlus };
