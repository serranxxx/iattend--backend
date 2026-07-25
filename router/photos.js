const express = require('express');
const multer = require('multer');
const { randomUUID } = require('crypto');
const supabase = require('../config/supabase');

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
});

// POST /api/photos/upload
router.post('/upload', upload.single('image'), async (req, res) => {
    try {
        const { event_id, guest_name, taken_at } = req.body;

        if (!guest_name || !guest_name.trim()) {
            return res.status(400).json({ error: 'guest_name es requerido' });
        }

        if (!event_id) {
            return res.status(400).json({ error: 'event_id es requerido' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'image es requerido' });
        }

        // Validar que el event_id exista en invitations
        const { data: invitation, error: invError } = await supabase
            .from('invitations')
            .select('id')
            .eq('id', event_id)
            .maybeSingle();

        if (invError) throw invError;
        if (!invitation) {
            return res.status(404).json({ error: 'Evento no encontrado' });
        }

        // Validar límite de 10 fotos por guest_name en este evento
        const { count, error: countError } = await supabase
            .from('event_photos')
            .select('id', { count: 'exact', head: true })
            .eq('event_id', event_id)
            .eq('guest_name', guest_name.trim());

        if (countError) throw countError;

        if (count >= 10) {
            return res.status(403).json({
                error: 'Has alcanzado el límite de 10 fotos para este evento',
            });
        }

        const photo_id = randomUUID();
        const storage_path = `${event_id}/${photo_id}.webp`;

        // Subir archivo a Supabase Storage
        const { error: uploadError } = await supabase.storage
            .from('event-photos')
            .upload(storage_path, req.file.buffer, {
                contentType: 'image/webp',
                upsert: false,
            });

        if (uploadError) throw uploadError;

        // Obtener URL pública
        const { data: urlData } = supabase.storage
            .from('event-photos')
            .getPublicUrl(storage_path);

        const public_url = urlData.publicUrl;

        // Calcular expires_at: now + 30 días
        const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        // Insertar registro en event_photos
        const { data: photo, error: insertError } = await supabase
            .from('event_photos')
            .insert({
                id: photo_id,
                event_id,
                guest_name: guest_name.trim(),
                storage_path,
                public_url,
                taken_at: taken_at || null,
                uploaded_at: new Date().toISOString(),
                expires_at,
            })
            .select()
            .single();

        if (insertError) throw insertError;

        return res.status(201).json(photo);
    } catch (err) {
        console.error('Error en POST /api/photos/upload:', err);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// GET /api/photos/likes/event/:event_id  — batch load all likes for an event
router.get('/likes/event/:event_id', async (req, res) => {
    try {
        const { event_id } = req.params;

        const { data: photos, error: photosError } = await supabase
            .from('event_photos')
            .select('id')
            .eq('event_id', event_id);

        if (photosError) throw photosError;
        if (!photos?.length) return res.json([]);

        const photoIds = photos.map(p => p.id);

        const { data, error } = await supabase
            .from('photo_likes')
            .select('photo_id, guest_name, created_at')
            .in('photo_id', photoIds);

        if (error) throw error;
        return res.json(data ?? []);
    } catch (err) {
        console.error('Error en GET /api/photos/likes/event/:event_id:', err);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// GET /api/photos/:event_id
router.get('/:event_id', async (req, res) => {
    try {
        const { event_id } = req.params;

        const { data, error } = await supabase
            .from('event_photos')
            .select('*')
            .eq('event_id', event_id)
            .order('uploaded_at', { ascending: false });

        if (error) throw error;

        return res.json(data);
    } catch (err) {
        console.error('Error en GET /api/photos/:event_id:', err);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// POST /api/photos/:photo_id/like  — toggle like/unlike
router.post('/:photo_id/like', async (req, res) => {
    try {
        const { photo_id } = req.params;
        const { guest_name } = req.body;

        if (!guest_name?.trim()) {
            return res.status(400).json({ error: 'guest_name es requerido' });
        }

        const { data: existing } = await supabase
            .from('photo_likes')
            .select('id')
            .eq('photo_id', photo_id)
            .eq('guest_name', guest_name.trim())
            .maybeSingle();

        if (existing) {
            await supabase.from('photo_likes').delete().eq('id', existing.id);
            const { count } = await supabase
                .from('photo_likes')
                .select('id', { count: 'exact', head: true })
                .eq('photo_id', photo_id);
            return res.json({ liked: false, count: count ?? 0 });
        } else {
            await supabase.from('photo_likes').insert({ photo_id, guest_name: guest_name.trim() });
            const { count } = await supabase
                .from('photo_likes')
                .select('id', { count: 'exact', head: true })
                .eq('photo_id', photo_id);
            return res.json({ liked: true, count: count ?? 0 });
        }
    } catch (err) {
        console.error('Error en POST /api/photos/:photo_id/like:', err);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// DELETE /api/photos/:photo_id
router.delete('/:photo_id', async (req, res) => {
    try {
        const { photo_id } = req.params;
        const { user_id } = req.body;

        // Obtener la foto con su event_id
        const { data: photo, error: fetchError } = await supabase
            .from('event_photos')
            .select('id, event_id, storage_path')
            .eq('id', photo_id)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!photo) {
            return res.status(404).json({ error: 'Foto no encontrada' });
        }

        // Validar que el event_id pertenece al usuario autenticado
        if (user_id) {
            const { data: invitation, error: invError } = await supabase
                .from('invitations')
                .select('id')
                .eq('id', photo.event_id)
                .eq('user_id', user_id)
                .maybeSingle();

            if (invError) throw invError;
            if (!invitation) {
                return res.status(403).json({ error: 'No tienes permiso para eliminar esta foto' });
            }
        }

        // Eliminar archivo de Storage
        const { error: storageError } = await supabase.storage
            .from('event-photos')
            .remove([photo.storage_path]);

        if (storageError) throw storageError;

        // Eliminar registro de la tabla
        const { error: deleteError } = await supabase
            .from('event_photos')
            .delete()
            .eq('id', photo_id);

        if (deleteError) throw deleteError;

        return res.status(204).send();
    } catch (err) {
        console.error('Error en DELETE /api/photos/:photo_id:', err);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;
