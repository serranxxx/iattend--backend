const express = require('express');
const supabase = require('../config/supabase');
const { validarAccesoEvento } = require('../middlewares/validar-acceso-evento');

const router = express.Router();

/*
  Archivar y borrar un Pop desde Pops › Mis Pops (iattend-vite,
  pages/Board/PopsApp/PopsAppMisPops.jsx; handoff "App de Pops", §5).

  · POST   /api/side-events/:id/archivar  { archivado: boolean }
      → { ok, archived_at } (null = desarchivado).
      Columna side_events.archived_at (migrations/2026-11-24_side_events_archived.sql);
      sin la migración responde 409 { code: 'SIN_MIGRACION' }.
  · DELETE /api/side-events/:id
      Borra el Pop y sus invitados. Las tablas ligadas al Pop o a sus
      invitados se van en cascada o quedan con el id en null (chat,
      formulario, acceso, envíos de WhatsApp, ventas, planner_events). Las
      fotos / archivos de Storage (carpeta flash-<id>, pop-material) NO se
      borran aquí.

  Solo Pops (side event sin invitación): un side event de boda se gestiona
  desde su invitación. Acceso: dueño, planner asignado o Administration
  (validarAccesoEvento).
  Duplicar (solo Pops+) todavía no existe.
*/

// validarAccesoEvento lee el evento del body.
const conEvento = (req, _res, next) => {
    req.datos = req.body ?? {};
    req.body = { sideEventId: req.params.id };
    next();
};

// Después de validarAccesoEvento: que sea un Pop.
const soloPop = async (req, res, next) => {
    try {
        const { data, error } = await supabase
            .from('side_events')
            .select('id, invitation_id')
            .eq('id', req.params.id)
            .maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ ok: false, msg: 'Evento no encontrado' });
        if (data.invitation_id) return res.status(400).json({ ok: false, msg: 'Solo se pueden archivar o borrar Pops' });
        next();
    } catch (err) {
        console.error('Error revisando el Pop:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo revisar el Pop' });
    }
};

router.post('/:id/archivar', conEvento, validarAccesoEvento, soloPop, async (req, res) => {
    try {
        const archivado = req.datos.archivado;
        if (typeof archivado !== 'boolean') {
            return res.status(400).json({ ok: false, msg: 'archivado debe ser true o false' });
        }
        const archived_at = archivado ? new Date().toISOString() : null;
        const { error } = await supabase
            .from('side_events')
            .update({ archived_at })
            .eq('id', req.params.id);
        if (error?.code === '42703') {
            return res.status(409).json({ ok: false, code: 'SIN_MIGRACION', msg: 'Falta la columna archived_at' });
        }
        if (error) throw error;
        return res.json({ ok: true, archived_at });
    } catch (err) {
        console.error('Error archivando el Pop:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo archivar' });
    }
});

router.delete('/:id', conEvento, validarAccesoEvento, soloPop, async (req, res) => {
    try {
        const id = req.params.id;
        // Primero los invitados (por si su llave al Pop no es en cascada).
        const { error: errInvitados } = await supabase
            .from('side_events_guests')
            .delete()
            .eq('side_events_id', id);
        if (errInvitados) throw errInvitados;

        const { error } = await supabase.from('side_events').delete().eq('id', id);
        if (error?.code === '23503') {
            return res.status(409).json({ ok: false, code: 'EN_USO', msg: 'El Pop todavía tiene datos ligados' });
        }
        if (error) throw error;
        return res.json({ ok: true });
    } catch (err) {
        console.error('Error borrando el Pop:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo borrar' });
    }
});

module.exports = router;
