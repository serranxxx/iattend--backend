const { response } = require('express');
const { randomUUID } = require('crypto');
const supabase = require('../config/supabase');

// CRUD del catálogo del panel lateral del editor (editor_categories /
// editor_assets, migración 2026-10-28_create_editor_catalog.sql). Lo usa
// Admin → Laboratorio → Elementos.
//
// Regla de oro: NADA de aquí toca las invitaciones. Cada invitación guarda
// una copia (la URL) de lo que soltó, no el id del catálogo. Por eso:
//   - ocultar (is_active = false) siempre es seguro;
//   - borrar un recurso solo se permite si ninguna invitación ni side event
//     usa su URL (RPC editor_asset_usage); si alguna lo usa, responde 409 y
//     el admin lo oculta en su lugar. El archivo nunca se borra si está en uso;
//   - las formas (kind 'shape', sin archivo) viven en código: solo se
//     ordenan u ocultan.

const BUCKET = 'editor-assets';
const UNIQUE_VIOLATION = '23505';
const PANELES = ['elements', 'photos'];
const KINDS = ['icon', 'shape', 'image'];
const TIPOS = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
};

const CAT_COLUMNAS = 'id, panel, parent_id, slug, name_es, name_en, kind, section_key, new_until, sort_order, is_active, created_at, updated_at';
const ASSET_COLUMNAS = 'id, category_id, name, tags, url, variant, tintable, default_w, aspect, sort_order, is_active, created_at, updated_at';

const slugDe = (raw) =>
    (raw ?? '')
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

const tagsDe = (raw) => {
    const lista = Array.isArray(raw) ? raw : (raw ?? '').toString().split(',');
    return [...new Set(lista.map((t) => t.toString().trim().toLowerCase()).filter(Boolean))];
};

// Un SVG del bucket es público: sin scripts, manejadores on*, ni
// javascript: en enlaces. La pieza lo pinta como mask/img (ahí no corren),
// pero alguien podría abrir la URL directo.
const limpiarSvg = (texto) =>
    texto
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
        .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
        .replace(/(href|xlink:href)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '');

// Ruta dentro de `editor-assets` si la URL es de ese bucket; null si es una
// URL heredada (bucket `assets`, /assets/itinerary/…), que nunca se borra.
const rutaEnBucket = (url) => {
    const marca = `/storage/v1/object/public/${BUCKET}/`;
    const i = (url ?? '').indexOf(marca);
    return i === -1 ? null : decodeURIComponent(url.slice(i + marca.length));
};

const usoDe = async (url) => {
    if (!url) return 0;
    const { data, error } = await supabase.rpc('editor_asset_usage', { asset_url: url });
    if (error) throw new Error(error.message);
    return Number(data) || 0;
};

const fallo = (res, error, msg = 'Error en el catálogo del editor') => {
    console.error(msg, error);
    return res.status(500).json({ ok: false, msg });
};

// ------------------------------------------------------------------ lectura ---

// Todo el catálogo, también lo oculto (el admin lo ve atenuado).
const listarCatalogo = async (req, res = response) => {
    try {
        const [cats, assets] = await Promise.all([
            supabase.from('editor_categories').select(CAT_COLUMNAS).order('panel').order('sort_order'),
            supabase.from('editor_assets').select(ASSET_COLUMNAS).order('sort_order'),
        ]);
        if (cats.error) throw cats.error;
        if (assets.error) throw assets.error;
        return res.json({ ok: true, categories: cats.data, assets: assets.data });
    } catch (error) {
        return fallo(res, error);
    }
};

// ---------------------------------------------------------------- categorías ---

const crearCategoria = async (req, res = response) => {
    try {
        const { panel, parent_id = null, name_es, name_en = null, kind, section_key = null, new_until = null } = req.body;
        if (!PANELES.includes(panel)) return res.status(400).json({ ok: false, msg: 'Panel inválido' });
        if (!KINDS.includes(kind)) return res.status(400).json({ ok: false, msg: 'Tipo inválido' });
        if (kind === 'shape') return res.status(400).json({ ok: false, msg: 'Las formas viven en código: no se crean categorías de formas' });
        if (!name_es?.trim()) return res.status(400).json({ ok: false, msg: 'Falta el nombre' });

        const slug = slugDe(req.body.slug || name_es);
        const { data: ultima } = await supabase
            .from('editor_categories').select('sort_order')
            .eq('panel', panel).order('sort_order', { ascending: false }).limit(1).maybeSingle();

        const { data, error } = await supabase
            .from('editor_categories')
            .insert({
                panel, parent_id, slug, kind, section_key, new_until,
                name_es: name_es.trim(), name_en: name_en?.trim() || null,
                sort_order: (ultima?.sort_order ?? 0) + 1,
                updated_by: req.adminUserId,
            })
            .select(CAT_COLUMNAS).single();

        if (error?.code === UNIQUE_VIOLATION) return res.status(409).json({ ok: false, msg: 'Ya existe una categoría con ese nombre en el panel' });
        if (error) throw error;
        return res.json({ ok: true, category: data });
    } catch (error) {
        return fallo(res, error);
    }
};

const actualizarCategoria = async (req, res = response) => {
    try {
        const permitidos = ['name_es', 'name_en', 'section_key', 'new_until', 'is_active', 'parent_id'];
        const cambios = Object.fromEntries(Object.entries(req.body).filter(([k]) => permitidos.includes(k)));
        if (cambios.name_es !== undefined && !cambios.name_es?.trim()) return res.status(400).json({ ok: false, msg: 'Falta el nombre' });

        const { data, error } = await supabase
            .from('editor_categories')
            .update({ ...cambios, updated_by: req.adminUserId })
            .eq('id', req.params.id)
            .select(CAT_COLUMNAS).single();
        if (error) throw error;
        return res.json({ ok: true, category: data });
    } catch (error) {
        return fallo(res, error);
    }
};

// Orden de un grupo de categorías: ids en el orden nuevo.
const ordenarCategorias = async (req, res = response) => {
    try {
        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
        await Promise.all(ids.map((id, i) =>
            supabase.from('editor_categories').update({ sort_order: i + 1, updated_by: req.adminUserId }).eq('id', id)));
        return res.json({ ok: true });
    } catch (error) {
        return fallo(res, error);
    }
};

// Solo categorías vacías: con recursos se ocultan (cada recurso podría estar
// en uso y el cascade los borraría).
const eliminarCategoria = async (req, res = response) => {
    try {
        const { count } = await supabase
            .from('editor_assets').select('id', { count: 'exact', head: true }).eq('category_id', req.params.id);
        const { count: hijas } = await supabase
            .from('editor_categories').select('id', { count: 'exact', head: true }).eq('parent_id', req.params.id);
        if (count || hijas) return res.status(409).json({ ok: false, msg: 'La categoría tiene contenido: ocúltala en vez de borrarla' });

        const { error } = await supabase.from('editor_categories').delete().eq('id', req.params.id);
        if (error) throw error;
        return res.json({ ok: true });
    } catch (error) {
        return fallo(res, error);
    }
};

// ------------------------------------------------------------------ recursos ---

// multipart: `file` + category_id, name, tags, default_w, aspect.
const crearAsset = async (req, res = response) => {
    try {
        const { category_id } = req.body;
        if (!req.file) return res.status(400).json({ ok: false, msg: 'Falta el archivo' });
        const ext = TIPOS[req.file.mimetype];
        if (!ext) return res.status(400).json({ ok: false, msg: 'Formato no permitido (PNG, JPG, WEBP o SVG)' });

        const { data: categoria, error: errCat } = await supabase
            .from('editor_categories').select('id, slug, kind').eq('id', category_id).single();
        if (errCat || !categoria) return res.status(400).json({ ok: false, msg: 'Categoría inválida' });
        if (categoria.kind === 'shape') return res.status(400).json({ ok: false, msg: 'Las formas viven en código' });

        const esSvg = ext === 'svg';
        const cuerpo = esSvg ? Buffer.from(limpiarSvg(req.file.buffer.toString('utf8'))) : req.file.buffer;
        const ruta = `${categoria.slug}/${randomUUID()}.${ext}`;
        const { error: errSubida } = await supabase.storage.from(BUCKET)
            .upload(ruta, cuerpo, { contentType: req.file.mimetype, upsert: false });
        if (errSubida) throw errSubida;
        const url = supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;

        const { data: ultimo } = await supabase
            .from('editor_assets').select('sort_order')
            .eq('category_id', category_id).order('sort_order', { ascending: false }).limit(1).maybeSingle();

        const nombre = (req.body.name || req.file.originalname.replace(/\.[^.]+$/, '')).trim();
        const { data, error } = await supabase
            .from('editor_assets')
            .insert({
                category_id,
                name: nombre,
                tags: tagsDe(req.body.tags),
                url,
                // Íconos SVG se pintan del color elegido.
                tintable: esSvg && categoria.kind === 'icon',
                default_w: Number(req.body.default_w) || (categoria.kind === 'icon' ? 14 : 26),
                aspect: Number(req.body.aspect) || 1,
                sort_order: (ultimo?.sort_order ?? 0) + 1,
                updated_by: req.adminUserId,
            })
            .select(ASSET_COLUMNAS).single();
        if (error) {
            await supabase.storage.from(BUCKET).remove([ruta]);
            throw error;
        }
        return res.json({ ok: true, asset: data });
    } catch (error) {
        return fallo(res, error, 'No se pudo subir el recurso');
    }
};

const actualizarAsset = async (req, res = response) => {
    try {
        const permitidos = ['name', 'tags', 'is_active', 'tintable', 'default_w', 'aspect', 'category_id'];
        const cambios = Object.fromEntries(Object.entries(req.body).filter(([k]) => permitidos.includes(k)));
        if (cambios.tags !== undefined) cambios.tags = tagsDe(cambios.tags);
        if (cambios.name !== undefined && !cambios.name?.trim()) return res.status(400).json({ ok: false, msg: 'Falta el nombre' });

        const { data, error } = await supabase
            .from('editor_assets')
            .update({ ...cambios, updated_by: req.adminUserId })
            .eq('id', req.params.id)
            .select(ASSET_COLUMNAS).single();
        if (error) throw error;
        return res.json({ ok: true, asset: data });
    } catch (error) {
        return fallo(res, error);
    }
};

const ordenarAssets = async (req, res = response) => {
    try {
        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
        await Promise.all(ids.map((id, i) =>
            supabase.from('editor_assets').update({ sort_order: i + 1, updated_by: req.adminUserId }).eq('id', id)));
        return res.json({ ok: true });
    } catch (error) {
        return fallo(res, error);
    }
};

// ¿Cuántas invitaciones / side events lo usan?
const usoAsset = async (req, res = response) => {
    try {
        const { data: asset, error } = await supabase.from('editor_assets').select('url').eq('id', req.params.id).single();
        if (error) throw error;
        return res.json({ ok: true, usage: await usoDe(asset.url) });
    } catch (error) {
        return fallo(res, error);
    }
};

// Borrar de verdad: solo si nadie lo usa. En uso → 409 (el admin lo oculta).
const eliminarAsset = async (req, res = response) => {
    try {
        const { data: asset, error } = await supabase.from('editor_assets').select('id, url, variant').eq('id', req.params.id).single();
        if (error) throw error;
        if (!asset.url) return res.status(409).json({ ok: false, msg: 'Las formas viven en código: solo se pueden ocultar' });

        const uso = await usoDe(asset.url);
        if (uso > 0) return res.status(409).json({ ok: false, usage: uso, msg: `Lo usan ${uso} invitaciones o eventos: ocúltalo en vez de borrarlo` });

        const { error: errBorrar } = await supabase.from('editor_assets').delete().eq('id', asset.id);
        if (errBorrar) throw errBorrar;

        // Solo archivos de este bucket; las URLs heredadas (assets,
        // /assets/itinerary/) no se tocan nunca.
        const ruta = rutaEnBucket(asset.url);
        if (ruta) await supabase.storage.from(BUCKET).remove([ruta]);
        return res.json({ ok: true });
    } catch (error) {
        return fallo(res, error);
    }
};

module.exports = {
    listarCatalogo,
    crearCategoria,
    actualizarCategoria,
    ordenarCategorias,
    eliminarCategoria,
    crearAsset,
    actualizarAsset,
    ordenarAssets,
    usoAsset,
    eliminarAsset,
};
