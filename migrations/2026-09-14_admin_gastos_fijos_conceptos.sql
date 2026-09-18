-- Gastos fijos: de 5 rubros fijos a conceptos libres
-- Correr DESPUÉS de 2026-09-14_create_admin_gastos_fijos.sql, en el SQL editor
-- de Supabase (o psql con service role).
--
-- Los 5 rubros que traía la tabla (renta, nómina, software, marketing, otros)
-- eran una plantilla. El admin quiere nombrar sus propios gastos, así que pasan
-- a una lista libre en jsonb: [{ "nombre": "...", "monto": 0 }, ...].
--
-- `neto_venta` NO cambia: sigue siendo una columna propia porque no es un gasto,
-- es el divisor que convierte la meta en "ventas necesarias".

alter table public.admin_gastos_fijos
  add column if not exists conceptos jsonb not null default '[]'::jsonb;

-- Migra lo que ya estaba capturado en los 5 rubros a la lista libre, sin perder
-- los montos. Solo toca filas que todavía no tengan conceptos.
update public.admin_gastos_fijos
set conceptos = (
  select coalesce(jsonb_agg(c), '[]'::jsonb)
  from (
    values
      ('Renta y servicios', renta),
      ('Nómina y colaboradores', nomina),
      ('Software e infraestructura', software),
      ('Marketing y pauta', marketing),
      ('Otros gastos fijos', otros)
  ) as t(nombre, monto),
  lateral (select jsonb_build_object('nombre', t.nombre, 'monto', t.monto) as c) x
  -- Un rubro en 0 que nunca se usó no vale la pena arrastrarlo a la lista.
  where t.monto > 0
)
where conceptos = '[]'::jsonb;

alter table public.admin_gastos_fijos
  drop column if exists renta,
  drop column if exists nomina,
  drop column if exists software,
  drop column if exists marketing,
  drop column if exists otros;

-- Comprobación: debe devolver la fila de sep-2026 con sus 5 conceptos sumando 15318.
-- select anio, mes, conceptos, neto_venta,
--        (select sum((c->>'monto')::numeric) from jsonb_array_elements(conceptos) c) as meta
-- from public.admin_gastos_fijos order by anio desc, mes desc;
