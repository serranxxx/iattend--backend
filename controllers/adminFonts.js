const { response } = require('express');
const supabase = require('../config/supabase');

const UNIQUE_VIOLATION = '23505';
const GOOGLE_FONTS_CACHE_TTL_MS = 60 * 60 * 1000;

// Cache en memoria del catálogo completo de Google Fonts. Se usa el endpoint
// no oficial de metadata (sin API key) porque el proyecto no tiene una
// Google Fonts Developer API key configurada — hace el fetch desde el
// backend (no el frontend) para evitar depender de que ese endpoint
// devuelva CORS abierto a un origen de navegador.
let _googleFontsCache = { data: null, ts: 0 };

const buscarGoogleFonts = async (req, res = response) => {
    const { q, category } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);

    try {
        const now = Date.now();
        if (!_googleFontsCache.data || now - _googleFontsCache.ts > GOOGLE_FONTS_CACHE_TTL_MS) {
            const googleRes = await fetch('https://fonts.google.com/metadata/fonts');
            const text = await googleRes.text();
            const cleaned = text.replace(/^\)\]\}'/, '');
            const parsed = JSON.parse(cleaned);
            const list = (parsed.familyMetadataList || [])
                .map(f => ({ family: f.family, category: f.category || null }))
                .sort((a, b) => a.family.localeCompare(b.family));
            _googleFontsCache = { data: list, ts: now };
        }

        const term = String(q || '').trim().toLowerCase();
        const categories = String(category || '')
            .split(',')
            .map(c => c.trim())
            .filter(Boolean);

        const filtered = _googleFontsCache.data
            .filter(f => term.length < 2 || f.family?.toLowerCase().includes(term))
            .filter(f => categories.length === 0 || categories.includes(f.category));

        const total = filtered.length;
        const start = (page - 1) * pageSize;
        const fonts = filtered.slice(start, start + pageSize);

        return res.status(200).json({ fonts, total, page, pageSize });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

const listarFonts = async (req, res = response) => {
    try {
        const { data: fonts, error } = await supabase
            .from('fonts')
            .select('id, family, google_axis, category, source, active, installed_at, installed_by')
            .order('family', { ascending: true });

        if (error) {
            return res.status(500).json({ ok: false, msg: error.message });
        }

        const { data: usage, error: usageError } = await supabase.rpc('get_font_usage');

        if (usageError) {
            return res.status(500).json({ ok: false, msg: usageError.message });
        }

        const usageByFamily = (usage || []).reduce((acc, u) => {
            acc[u.font_family] = { invitation_count: u.invitation_count, invitation_ids: u.invitation_ids };
            return acc;
        }, {});

        const allInvitationIds = [...new Set((usage || []).flatMap(u => u.invitation_ids || []))];
        let invitationById = {};

        if (allInvitationIds.length) {
            const { data: invitations, error: invitationsError } = await supabase
                .from('invitations')
                .select('id, name, label, owners')
                .in('id', allInvitationIds);

            if (invitationsError) {
                return res.status(500).json({ ok: false, msg: invitationsError.message });
            }

            invitationById = (invitations || []).reduce((acc, inv) => {
                const owners = inv.owners;
                acc[inv.id] = Array.isArray(owners) && owners.length
                    ? owners.join(' & ')
                    : (inv.name || inv.label || inv.id);
                return acc;
            }, {});
        }

        const result = (fonts || []).map(f => {
            const usageRow = usageByFamily[f.family];
            return {
                ...f,
                invitation_count: usageRow?.invitation_count ?? 0,
                invitations: (usageRow?.invitation_ids || []).map(id => ({
                    id,
                    label: invitationById[id] || id,
                })),
            };
        });

        return res.status(200).json({ fonts: result });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

const FUENTES_VALIDAS = ['google_fonts', 'self_hosted', 'system'];

const instalarFont = async (req, res = response) => {
    const { family, google_axis, category, source } = req.body;

    if (!family || typeof family !== 'string' || !family.trim()) {
        return res.status(400).json({ ok: false, msg: 'family es requerido' });
    }

    if (source && !FUENTES_VALIDAS.includes(source)) {
        return res.status(400).json({ ok: false, msg: 'source inválido' });
    }

    try {
        const { data: font, error } = await supabase
            .from('fonts')
            .insert({
                family: family.trim(),
                google_axis: google_axis || null,
                category: category || null,
                source: source || 'google_fonts',
                installed_by: req.adminUserId,
            })
            .select('id, family, google_axis, category, source, active, installed_at, installed_by')
            .single();

        if (error) {
            if (error.code === UNIQUE_VIOLATION) {
                return res.status(409).json({ ok: false, msg: 'Esta font ya está instalada' });
            }
            return res.status(500).json({ ok: false, msg: error.message });
        }

        return res.status(201).json({ font });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

const actualizarFont = async (req, res = response) => {
    const { id } = req.params;
    const { active } = req.body;

    if (typeof active !== 'boolean') {
        return res.status(400).json({ ok: false, msg: 'active (boolean) es requerido' });
    }

    try {
        if (active === false) {
            const { data: font, error: fontError } = await supabase
                .from('fonts')
                .select('family')
                .eq('id', id)
                .maybeSingle();

            if (fontError) return res.status(500).json({ ok: false, msg: fontError.message });
            if (!font) return res.status(404).json({ ok: false, msg: 'Font no encontrada' });

            const { data: usage, error: usageError } = await supabase.rpc('get_font_usage');

            if (usageError) return res.status(500).json({ ok: false, msg: usageError.message });

            const usageRow = (usage || []).find(u => u.font_family === font.family);

            if (usageRow && usageRow.invitation_count > 0) {
                return res.status(409).json({
                    ok: false,
                    msg: `Font en uso en ${usageRow.invitation_count} invitación(es)`,
                    invitation_count: usageRow.invitation_count,
                });
            }
        }

        const { data, error } = await supabase
            .from('fonts')
            .update({ active })
            .eq('id', id)
            .select('id, family, google_axis, category, source, active, installed_at, installed_by')
            .maybeSingle();

        if (error) return res.status(500).json({ ok: false, msg: error.message });
        if (!data) return res.status(404).json({ ok: false, msg: 'Font no encontrada' });

        return res.status(200).json({ font: data });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

module.exports = {
    listarFonts,
    instalarFont,
    actualizarFont,
    buscarGoogleFonts,
}
