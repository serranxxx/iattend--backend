/*
    Storage de Supabase para Admin → Analítica → Storage
    host + /api/admin

    Lee el agregado de public.admin_storage_stats() (migración
    2026-10-28b_admin_storage_stats.sql) y lo acomoda para el tablero:
    total, por bucket, por tipo de archivo, por área (fotos de eventos,
    stickers, Flash, catálogo…), crecimiento por mes y uso por evento.
    Solo lectura.
*/

const { Router } = require('express');
const supabase = require('../config/supabase');
const { validarAdmin } = require('../middlewares/validar-admin');

const router = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Qué es cada carpeta de primer nivel.
const clasificar = (bucket, folder) => {
    if (bucket === 'user_images') {
        if (UUID.test(folder)) return { area: 'event_media', invitation_id: folder };
        if (folder.startsWith('inv-') && UUID.test(folder.slice(4))) return { area: 'stickers', invitation_id: folder.slice(4) };
        if (folder.startsWith('flash-')) return { area: 'flash', flash_id: folder.slice(6) };
        if (folder === 'temp') return { area: 'temp' };
        return { area: 'other_user' };
    }
    if (bucket === 'event-photos') return UUID.test(folder) ? { area: 'photo_wall', invitation_id: folder } : { area: 'photo_wall' };
    if (bucket === 'editor-assets') return { area: 'editor_catalog' };
    if (bucket === 'assets') return { area: 'iattend_assets' };
    if (bucket === 'land_page' || bucket === 'landing') return { area: 'landing' };
    if (bucket === 'side_events') return { area: 'side_events' };
    if (bucket === 'comprobantes-pago') return { area: 'payments' };
    if (bucket === 'personal') return { area: 'personal' };
    return { area: 'other' };
};

const sumar = (mapa, clave, fila, extra = {}) => {
    const cur = mapa.get(clave) ?? { ...extra, files: 0, bytes: 0 };
    cur.files += Number(fila.files) || 0;
    cur.bytes += Number(fila.bytes) || 0;
    mapa.set(clave, cur);
    return cur;
};

router.get('/storage', validarAdmin, async (req, res) => {
    try {
        const { data, error } = await supabase.rpc('admin_storage_stats');
        if (error) throw error;

        const buckets = new Map();
        const kinds = new Map();
        const areas = new Map();
        const months = new Map();
        const eventos = new Map();
        let files = 0;
        let bytes = 0;

        for (const fila of data ?? []) {
            files += Number(fila.files) || 0;
            bytes += Number(fila.bytes) || 0;
            sumar(buckets, fila.bucket_id, fila, { bucket: fila.bucket_id });
            sumar(kinds, fila.kind, fila, { kind: fila.kind });
            const { area, invitation_id, flash_id } = clasificar(fila.bucket_id, fila.folder);
            sumar(areas, area, fila, { area });
            sumar(months, fila.month, fila, { month: fila.month });

            const clave = invitation_id ? `inv:${invitation_id}` : flash_id ? `flash:${flash_id}` : null;
            if (clave) {
                const ev = sumar(eventos, clave, fila, { invitation_id: invitation_id ?? null, flash_id: flash_id ?? null, by_kind: {}, by_area: {} });
                ev.by_kind[fila.kind] = (ev.by_kind[fila.kind] ?? 0) + (Number(fila.bytes) || 0);
                ev.by_area[area] = (ev.by_area[area] ?? 0) + (Number(fila.bytes) || 0);
            }
        }

        // Nombre de los Flash (no son invitaciones; el front no los tiene).
        const flashIds = [...eventos.values()].map((e) => e.flash_id).filter(Boolean);
        const nombresFlash = {};
        if (flashIds.length) {
            const { data: flashes } = await supabase.from('side_events').select('id, name').in('id', flashIds);
            (flashes ?? []).forEach((f) => { nombresFlash[f.id] = f.name; });
        }

        const orden = (a, b) => b.bytes - a.bytes;
        return res.json({
            ok: true,
            total: { files, bytes },
            buckets: [...buckets.values()].sort(orden),
            kinds: [...kinds.values()].sort(orden),
            areas: [...areas.values()].sort(orden),
            months: [...months.values()].sort((a, b) => String(a.month).localeCompare(String(b.month))),
            events: [...eventos.values()]
                .map((e) => ({ ...e, flash_name: e.flash_id ? nombresFlash[e.flash_id] ?? null : null }))
                .sort(orden),
        });
    } catch (error) {
        console.error('[admin/storage]', error?.message ?? error);
        return res.status(500).json({ ok: false, msg: 'No se pudo leer el storage' });
    }
});

module.exports = router;
