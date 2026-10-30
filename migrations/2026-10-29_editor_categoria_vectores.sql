-- Categoría "Vectores" del panel Elementos de los editores (invitación, side
-- events y Eventos Flash). Son SVG de un solo color: a diferencia de los PNG
-- (Ilustraciones), en la pieza se les cambia el color. Es una categoría
-- `icon` (los SVG que se suben a ella entran con tintable = true, ver
-- controllers/adminEditorCatalog.js); sus recursos se suben en Admin →
-- Laboratorio → Elementos. Va después de Ilustraciones. Idempotente.

insert into public.editor_categories (panel, slug, name_es, name_en, kind, sort_order)
select 'elements', 'vectores', 'Vectores', 'Vectors', 'icon', 4
where not exists (
  select 1 from public.editor_categories where panel = 'elements' and slug = 'vectores'
);
