const supabase = require('../config/supabase');

/**
 * Resuelve el rol de admin a partir de un access_token de Supabase Auth
 * (la sesión que ya tiene el organizador logueado en el frontend).
 */
async function resolveAdminUserId(token) {
    if (!token) {
        return { ok: false, status: 401, msg: 'No hay token de sesión en la petición' };
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token);

    if (userError || !userData?.user) {
        return { ok: false, status: 401, msg: 'Token no válido' };
    }

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', userData.user.id)
        .maybeSingle();

    if (profileError) {
        return { ok: false, status: 500, msg: profileError.message };
    }

    if (profile?.role !== 'Administration') {
        return { ok: false, status: 403, msg: 'No tienes permisos de administrador' };
    }

    return { ok: true, userId: userData.user.id };
}

module.exports = { resolveAdminUserId };
