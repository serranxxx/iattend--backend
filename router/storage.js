const { Router } = require('express');
const supabase = require('../config/supabase');

const router = Router();

const BUCKET = 'user_images';
const TEMP_PREFIX = 'temp';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // un día

/**
 * Limpieza de los archivos temporales del Save the Date gratis.
 *
 * Mientras alguien arma su Save the Date sin cuenta todavía no existe un
 * evento, así que sus fotos y videos van a `temp/<id>/`. Si crea su cuenta se
 * mueven a la carpeta del evento; si no, quedan huérfanos y este barrido los
 * borra al día siguiente.
 *
 * Se llama sin sesión (el visitante anónimo lo dispara al entrar) y por eso
 * está acotado a `temp/`: no puede tocar la carpeta de ningún evento.
 */
async function sweepTempFolders() {
    const { data: folders, error } = await supabase.storage
        .from(BUCKET)
        .list(TEMP_PREFIX, { limit: 1000 });

    if (error) throw new Error(error.message);

    const cutoff = Date.now() - MAX_AGE_MS;
    const removed = [];

    for (const folder of folders ?? []) {
        // `list` devuelve las subcarpetas con id null y sin fecha útil, así que
        // la edad se decide con los archivos que hay dentro.
        if (folder.id !== null) continue;

        const inner = `${TEMP_PREFIX}/${folder.name}`;
        const paths = await listAllFiles(inner);
        if (paths.length === 0) continue;

        const newest = Math.max(...paths.map((f) => new Date(f.created_at || 0).getTime()));
        if (newest > cutoff) continue;

        const { error: removeError } = await supabase.storage
            .from(BUCKET)
            .remove(paths.map((f) => f.path));

        if (removeError) {
            console.error('temp-sweep: no se pudo borrar', inner, removeError.message);
            continue;
        }
        removed.push(inner);
    }

    return removed;
}

// Recorre la carpeta y sus subcarpetas conocidas (video, audio)
async function listAllFiles(prefix) {
    const out = [];
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (error || !data) return out;

    for (const entry of data) {
        if (entry.id === null) {
            const nested = await listAllFiles(`${prefix}/${entry.name}`);
            out.push(...nested);
            continue;
        }
        out.push({ path: `${prefix}/${entry.name}`, created_at: entry.created_at });
    }
    return out;
}

/**
 * Mueve la carpeta temporal a la del evento (adopción del Save the Date).
 *
 * Va por el backend a propósito: con la sesión del navegador el `move` falla
 * con "Object not found" porque las políticas del bucket no dejan a un usuario
 * tocar objetos fuera de su carpeta, y `temp/` no es de nadie.
 */
router.post('/adopt-temp', async (req, res) => {
    const { folder, invitationID } = req.body ?? {};

    if (!/^temp\/[A-Za-z0-9._-]+$/.test(String(folder || ''))) {
        return res.status(400).json({ ok: false, msg: 'Carpeta temporal inválida' });
    }
    if (!/^[0-9a-f-]{36}$/i.test(String(invitationID || ''))) {
        return res.status(400).json({ ok: false, msg: 'invitationID inválido' });
    }

    try {
        const { data: invitation } = await supabase
            .from('invitations')
            .select('id')
            .eq('id', invitationID)
            .maybeSingle();

        if (!invitation) return res.status(404).json({ ok: false, msg: 'La invitación no existe' });

        const files = await listAllFiles(folder);
        const moved = [];

        for (const file of files) {
            const to = file.path.replace(`${folder}/`, `${invitationID}/`);
            const { error } = await supabase.storage.from(BUCKET).move(file.path, to);
            if (error) {
                console.error('adopt-temp: no se pudo mover', file.path, error.message);
                continue;
            }
            moved.push({ from: file.path, to });
        }

        return res.status(200).json({ ok: true, moved });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
});

router.post('/temp-sweep', async (_req, res) => {
    try {
        const removed = await sweepTempFolders();
        return res.status(200).json({ ok: true, removed: removed.length, folders: removed });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
});

module.exports = router;
