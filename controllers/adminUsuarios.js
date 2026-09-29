const { response } = require('express');
const supabase = require('../config/supabase');

// Edición de usuarios desde Admin → Usuarios. Solo nombre y rol: el correo es
// el login (auth.users) y no se cambia desde aquí.

// Los mismos que acepta createUser en controllers/auth.js. null = cliente.
const ROLES_ASIGNABLES = ['Administration', 'sales', 'planner', 'mkt', 'test'];

const editarUsuario = async (req, res = response) => {
    const { user_id } = req.params;
    const { full_name, role } = req.body || {};
    const cambios = {};

    if (full_name !== undefined) {
        if (typeof full_name !== 'string' || !full_name.trim()) {
            return res.status(400).json({ ok: false, msg: 'El nombre es requerido' });
        }
        cambios.full_name = full_name.trim();
    }

    if (role !== undefined) {
        const valor = role || null;
        if (valor !== null && !ROLES_ASIGNABLES.includes(valor)) {
            return res.status(400).json({ ok: false, msg: `Rol no válido: ${valor}` });
        }
        // Quitarse Administración a uno mismo lo dejaría fuera del admin.
        if (user_id === req.adminUserId && valor !== 'Administration') {
            return res.status(400).json({ ok: false, msg: 'No puedes quitarte el rol de Administración a ti mismo' });
        }
        cambios.role = valor;
    }

    if (!Object.keys(cambios).length) {
        return res.status(400).json({ ok: false, msg: 'No hay cambios' });
    }

    try {
        const { data: perfil, error } = await supabase
            .from('profiles')
            .update(cambios)
            .eq('user_id', user_id)
            .select('*')
            .maybeSingle();

        if (error) return res.status(500).json({ ok: false, msg: error.message });
        if (!perfil) return res.status(404).json({ ok: false, msg: 'Usuario no encontrado' });

        // El nombre también vive en los metadatos de la cuenta (se usa al
        // crearla); se mantiene igual para que no se desincronicen.
        if (cambios.full_name) {
            const { error: authError } = await supabase.auth.admin.updateUserById(user_id, {
                user_metadata: { full_name: cambios.full_name },
            });
            if (authError) console.error('No se pudo actualizar full_name en auth:', authError.message);
        }

        return res.status(200).json({ ok: true, perfil });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

module.exports = { editarUsuario };
