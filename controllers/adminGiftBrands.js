const { response } = require('express');
const supabase = require('../config/supabase');

const UNIQUE_VIOLATION = '23505';
const KINDS_VALIDOS = ['store', 'bank'];

const COLUMNAS = 'id, kind, name, slug, aliases, logo_url, background, text_color, sort_order, is_active, created_at, updated_at, created_by';

// Espejo de public.gift_brand_key() en SQL y del normalize() de
// classifyGiftCard.ts en iattend-events. Si cambia uno, cambian los tres.
const normalizarClave = (raw) =>
    (raw ?? '')
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/\s+/g, ' ')
        .trim();

// Une el conteo crudo del RPC (por clave normalizada) con el catálogo: una
// marca suma el uso de su slug y el de todos sus alias. Las claves que no
// resuelven a ninguna marca se devuelven aparte — son tarjetas que hoy se
// pintan sin logo en la invitación del invitado, y es justo lo que el admin
// necesita ver para saber qué alias falta dar de alta.
const cruzarUso = (marcas, filasUso) => {
    const porClave = new Map();
    (filasUso || []).forEach(u => porClave.set(u.brand_key, u));

    const reclamadas = new Set();

    const conUso = marcas.map(marca => {
        const claves = [marca.slug, ...(marca.aliases || [])];
        const ids = new Set();

        claves.forEach(clave => {
            const fila = porClave.get(clave);
            if (!fila) return;
            reclamadas.add(clave);
            (fila.invitation_ids || []).forEach(id => ids.add(id));
        });

        return { ...marca, invitation_count: ids.size, invitation_ids: [...ids] };
    });

    const huerfanas = (filasUso || [])
        .filter(u => !reclamadas.has(u.brand_key))
        .map(u => ({
            brand_key: u.brand_key,
            invitation_count: Number(u.invitation_count) || 0,
            invitation_ids: u.invitation_ids || [],
        }))
        .sort((a, b) => b.invitation_count - a.invitation_count);

    return { conUso, huerfanas };
};

const etiquetarInvitaciones = async (ids) => {
    if (!ids.length) return {};

    const { data, error } = await supabase
        .from('invitations')
        .select('id, name, label, owners')
        .in('id', ids);

    if (error) throw new Error(error.message);

    return (data || []).reduce((acc, inv) => {
        const owners = inv.owners;
        acc[inv.id] = Array.isArray(owners) && owners.length
            ? owners.join(' & ')
            : (inv.name || inv.label || inv.id);
        return acc;
    }, {});
};

const listarGiftBrands = async (req, res = response) => {
    try {
        const { data: marcas, error } = await supabase
            .from('gift_brands')
            .select(COLUMNAS)
            .order('kind', { ascending: true })
            .order('sort_order', { ascending: true });

        if (error) return res.status(500).json({ ok: false, msg: error.message });

        const { data: uso, error: usoError } = await supabase.rpc('get_gift_brand_usage');

        if (usoError) return res.status(500).json({ ok: false, msg: usoError.message });

        const { conUso, huerfanas } = cruzarUso(marcas || [], uso);

        const todosLosIds = [...new Set([
            ...conUso.flatMap(m => m.invitation_ids),
            ...huerfanas.flatMap(h => h.invitation_ids),
        ])];

        const etiquetaPorId = await etiquetarInvitaciones(todosLosIds);

        const brands = conUso.map(({ invitation_ids, ...marca }) => ({
            ...marca,
            invitation_count: marca.invitation_count,
            invitations: invitation_ids.map(id => ({ id, label: etiquetaPorId[id] || id })),
        }));

        const orphans = huerfanas.map(h => ({
            ...h,
            invitations: h.invitation_ids.map(id => ({ id, label: etiquetaPorId[id] || id })),
        }));

        return res.status(200).json({ brands, orphans });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

// Valida y normaliza lo que llega del formulario. Devuelve { error } o { valor }.
const prepararAliases = (aliases, slug) => {
    if (aliases === undefined) return { valor: undefined };
    if (!Array.isArray(aliases)) return { error: 'aliases debe ser un arreglo' };

    const limpios = [...new Set(
        aliases.map(normalizarClave).filter(a => a && a !== slug)
    )];

    return { valor: limpios };
};

// Un alias no puede apuntar a dos marcas a la vez: la resolución quedaría
// indefinida y la tarjeta pintaría el logo equivocado.
const buscarColisiones = async (claves, idAExcluir = null) => {
    if (!claves.length) return null;

    let query = supabase.from('gift_brands').select('id, name, slug, aliases');
    if (idAExcluir) query = query.neq('id', idAExcluir);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    for (const otra of data || []) {
        const suyas = new Set([otra.slug, ...(otra.aliases || [])]);
        const choque = claves.find(c => suyas.has(c));
        if (choque) return { clave: choque, marca: otra.name };
    }

    return null;
};

const crearGiftBrand = async (req, res = response) => {
    const { kind, name, aliases, logo_url, background, text_color, sort_order } = req.body;

    if (!KINDS_VALIDOS.includes(kind)) {
        return res.status(400).json({ ok: false, msg: "kind debe ser 'store' o 'bank'" });
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ ok: false, msg: 'name es requerido' });
    }

    const nombre = name.trim();
    const slug = normalizarClave(nombre);

    if (!slug) {
        return res.status(400).json({ ok: false, msg: 'name no puede ser solo espacios o signos' });
    }

    const { valor: aliasLimpios, error: aliasError } = prepararAliases(aliases, slug);
    if (aliasError) return res.status(400).json({ ok: false, msg: aliasError });

    try {
        const colision = await buscarColisiones([slug, ...(aliasLimpios || [])]);
        if (colision) {
            return res.status(409).json({
                ok: false,
                msg: `"${colision.clave}" ya resuelve a la marca ${colision.marca}`,
            });
        }

        const { data: brand, error } = await supabase
            .from('gift_brands')
            .insert({
                kind,
                name: nombre,
                slug,
                aliases: aliasLimpios || [],
                logo_url: logo_url || null,
                background: background || null,
                text_color: text_color || null,
                sort_order: Number.isInteger(sort_order) ? sort_order : 0,
                created_by: req.adminUserId,
            })
            .select(COLUMNAS)
            .single();

        if (error) {
            if (error.code === UNIQUE_VIOLATION) {
                return res.status(409).json({ ok: false, msg: 'Ya existe una marca con ese nombre' });
            }
            return res.status(500).json({ ok: false, msg: error.message });
        }

        return res.status(201).json({ brand });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

// Cuántas invitaciones usan esta marca hoy (por slug o por cualquiera de sus alias).
const contarUso = async (marca) => {
    const { data: uso, error } = await supabase.rpc('get_gift_brand_usage');
    if (error) throw new Error(error.message);

    const claves = new Set([marca.slug, ...(marca.aliases || [])]);
    const ids = new Set();

    (uso || []).forEach(u => {
        if (claves.has(u.brand_key)) (u.invitation_ids || []).forEach(id => ids.add(id));
    });

    return ids.size;
};

const actualizarGiftBrand = async (req, res = response) => {
    const { id } = req.params;
    const { name, aliases, logo_url, background, text_color, sort_order, is_active } = req.body;

    try {
        const { data: marca, error: marcaError } = await supabase
            .from('gift_brands')
            .select(COLUMNAS)
            .eq('id', id)
            .maybeSingle();

        if (marcaError) return res.status(500).json({ ok: false, msg: marcaError.message });
        if (!marca) return res.status(404).json({ ok: false, msg: 'Marca no encontrada' });

        const cambios = {};

        if (logo_url !== undefined) cambios.logo_url = logo_url || null;
        if (background !== undefined) cambios.background = background || null;
        if (text_color !== undefined) cambios.text_color = text_color || null;
        if (sort_order !== undefined) {
            if (!Number.isInteger(sort_order)) {
                return res.status(400).json({ ok: false, msg: 'sort_order debe ser entero' });
            }
            cambios.sort_order = sort_order;
        }

        // El nombre es la llave que quedó escrita en cards[].brand / cards[].bank
        // de cada invitación. Renombrar una marca en uso dejaría esas tarjetas
        // apuntando a un nombre que ya no existe en el catálogo.
        const nombreNuevo = typeof name === 'string' ? name.trim() : undefined;
        const renombra = nombreNuevo !== undefined && nombreNuevo !== marca.name;

        if (renombra && !nombreNuevo) {
            return res.status(400).json({ ok: false, msg: 'name no puede quedar vacío' });
        }

        const { valor: aliasLimpios, error: aliasError } = prepararAliases(
            aliases,
            renombra ? normalizarClave(nombreNuevo) : marca.slug
        );
        if (aliasError) return res.status(400).json({ ok: false, msg: aliasError });

        const desactiva = is_active === false && marca.is_active;

        if (renombra || desactiva) {
            const usos = await contarUso(marca);

            if (usos > 0) {
                return res.status(409).json({
                    ok: false,
                    msg: renombra
                        ? `No se puede renombrar: en uso en ${usos} invitación(es)`
                        : `No se puede desactivar: en uso en ${usos} invitación(es)`,
                    invitation_count: usos,
                });
            }
        }

        if (renombra) {
            const slugNuevo = normalizarClave(nombreNuevo);
            if (!slugNuevo) {
                return res.status(400).json({ ok: false, msg: 'name no puede ser solo espacios o signos' });
            }
            cambios.name = nombreNuevo;
            cambios.slug = slugNuevo;
        }

        if (aliasLimpios !== undefined) cambios.aliases = aliasLimpios;
        if (is_active !== undefined) {
            if (typeof is_active !== 'boolean') {
                return res.status(400).json({ ok: false, msg: 'is_active debe ser boolean' });
            }
            cambios.is_active = is_active;
        }

        if (!Object.keys(cambios).length) {
            return res.status(200).json({ brand: marca });
        }

        const clavesNuevas = [
            ...(cambios.slug ? [cambios.slug] : []),
            ...(cambios.aliases || []),
        ];

        const colision = await buscarColisiones(clavesNuevas, id);
        if (colision) {
            return res.status(409).json({
                ok: false,
                msg: `"${colision.clave}" ya resuelve a la marca ${colision.marca}`,
            });
        }

        const { data, error } = await supabase
            .from('gift_brands')
            .update(cambios)
            .eq('id', id)
            .select(COLUMNAS)
            .maybeSingle();

        if (error) {
            if (error.code === UNIQUE_VIOLATION) {
                return res.status(409).json({ ok: false, msg: 'Ya existe una marca con ese nombre' });
            }
            return res.status(500).json({ ok: false, msg: error.message });
        }

        return res.status(200).json({ brand: data });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

const eliminarGiftBrand = async (req, res = response) => {
    const { id } = req.params;

    try {
        const { data: marca, error: marcaError } = await supabase
            .from('gift_brands')
            .select(COLUMNAS)
            .eq('id', id)
            .maybeSingle();

        if (marcaError) return res.status(500).json({ ok: false, msg: marcaError.message });
        if (!marca) return res.status(404).json({ ok: false, msg: 'Marca no encontrada' });

        const usos = await contarUso(marca);

        if (usos > 0) {
            return res.status(409).json({
                ok: false,
                msg: `No se puede borrar: en uso en ${usos} invitación(es)`,
                invitation_count: usos,
            });
        }

        const { error } = await supabase.from('gift_brands').delete().eq('id', id);

        if (error) return res.status(500).json({ ok: false, msg: error.message });

        return res.status(200).json({ ok: true, id });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

module.exports = {
    listarGiftBrands,
    crearGiftBrand,
    actualizarGiftBrand,
    eliminarGiftBrand,
};
