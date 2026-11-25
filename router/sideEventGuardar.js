const express = require('express');
const supabase = require('../config/supabase');
const { validarAccesoEvento } = require('../middlewares/validar-acceso-evento');
const { funcionesPlusEnUso } = require('../helpers/planPops');
const { popEsPlus } = require('../helpers/popPlus');

const router = express.Router();

/*
  Guardar un side event / Pop desde su editor (vite `saveSideEvent` y
  `updateURLimage` de SideEvents.jsx): name, url_image y body.

  Antes el editor hacía el UPDATE directo a side_events con la anon key. Ahora
  pasa por aquí para poder validar en el servidor lo que se guarda (planes de
  Pops: Free / Pops Plus, ver iattend-vite/docs/editor-pops-planes-paso0.md).
  Cuando todo esté desplegado, migrations/2026-11-23d_side_events_guardar_backend.sql
  le quita a authenticated el UPDATE de esas tres columnas.

  La mezcla con cambios de otras pestañas (mezclarBody) se sigue haciendo en
  el editor, antes de llamar aquí: esta ruta guarda lo que recibe.

  Acceso: dueño, planner asignado o Administration (validarAccesoEvento; un
  side event de boda, con la regla de su invitación).
*/

const CAMPOS = ['name', 'url_image', 'body'];


// validarAccesoEvento lee el evento del body.
const conEvento = (req, _res, next) => {
    req.cambios = req.body?.cambios ?? {};
    req.body = { sideEventId: req.params.id };
    next();
};

// Lo que se puede guardar y con qué forma. Devuelve el error o null.
const revisar = (cambios) => {
    const llaves = Object.keys(cambios);
    if (!llaves.length) return 'Nada que guardar';
    const ajenas = llaves.filter(k => !CAMPOS.includes(k));
    if (ajenas.length) return `Campos no permitidos: ${ajenas.join(', ')}`;
    if ('name' in cambios && cambios.name !== null && (typeof cambios.name !== 'string' || cambios.name.length > 200)) {
        return 'name inválido';
    }
    if ('url_image' in cambios && cambios.url_image !== null && (typeof cambios.url_image !== 'string' || cambios.url_image.length > 2000)) {
        return 'url_image inválido';
    }
    if ('body' in cambios) {
        const b = cambios.body;
        if (!b || typeof b !== 'object' || Array.isArray(b)) return 'body inválido';
    }
    return null;
};

router.post(
    '/:id/guardar',
    conEvento,
    validarAccesoEvento,
    async (req, res) => {
        try {
            const cambios = req.cambios;
            const error = revisar(cambios);
            if (error) return res.status(400).json({ ok: false, msg: error });

            // Plan de Pops: un Pop Free no guarda NADA mientras use funciones
            // Plus (helpers/planPops.js). El editor ya lo sabe y ni lo manda;
            // esto es para quien se lo salte.
            if ('body' in cambios && !(await popEsPlus(req.params.id))) {
                const funciones = funcionesPlusEnUso(cambios.body);
                if (funciones.length) {
                    return res.status(402).json({ ok: false, code: 'POPS_PLUS', funciones, msg: 'No se pudo guardar porque usas funciones Plus' });
                }
            }

            const { error: errGuardar } = await supabase
                .from('side_events')
                .update(cambios)
                .eq('id', req.params.id);
            if (errGuardar) throw errGuardar;

            return res.json({ ok: true });
        } catch (err) {
            console.error('Error guardando el side event:', err);
            return res.status(500).json({ ok: false, msg: 'No se pudo guardar' });
        }
    }
);

// Plan del Pop para el editor: { plus } (true = puede usar funciones Plus).
router.get('/:id/plan', conEvento, validarAccesoEvento, async (req, res) => {
    try {
        const plus = await popEsPlus(req.params.id);
        // Prueba gratis de Pops+ del dueño (Admin): el Pop es Plus, pero el
        // editor sigue marcando con la insignia lo que es Plus y avisa cuándo
        // vence. Se decide por la cuenta del dueño (los Pops viejos traen
        // pops_plus = true por omisión y no dirían nada).
        let prueba = null;
        if (plus) {
            const { data: pop } = await supabase.from('side_events')
                .select('user_id, planner_id').eq('id', req.params.id).maybeSingle();
            const dueno = pop?.user_id || pop?.planner_id;
            if (dueno) {
                const { suscripcionDe, pruebaVigente } = require('../helpers/popsSuscripcion');
                prueba = pruebaVigente(await suscripcionDe(dueno).catch(() => null));
            }
        }
        return res.json({ ok: true, plus, prueba });
    } catch (err) {
        console.error('Error leyendo el plan del Pop:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo leer el plan' });
    }
});

module.exports = router;
