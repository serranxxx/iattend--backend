-- Ventas de ecommerce: las compras de planes con Stripe se registran solas como
-- venta (webhook → controllers/ventasEcommerce.js), con el vendedor "Ecommerce".
-- Correr en el SQL editor de Supabase ANTES de desplegar el backend: sin el
-- vendedor, el webhook no registra la venta (el pago y el plan sí se procesan).

-- 1. Nuevo tipo de vendedor. Hoy la columna solo acepta interno/externo.
alter table public.vendedores drop constraint if exists vendedores_tipo_check;
alter table public.vendedores
  add constraint vendedores_tipo_check check (tipo in ('interno', 'externo', 'ecommerce'));

-- 2. El vendedor. El código de acceso no es de 6 dígitos, así que nadie puede
--    entrar con él al panel de vendedores (el login exige ese formato).
insert into public.vendedores (nombre, tipo, activo, descuento_max_pct, codigo_acceso, notas)
select 'Ecommerce', 'ecommerce', true, 0, 'ecommerce-' || gen_random_uuid()::text, 'Compras en línea con Stripe (se registran solas desde el webhook).'
where not exists (select 1 from public.vendedores where tipo = 'ecommerce');

-- 3. Stripe reintenta el webhook: el pago de una sesión solo se registra una vez.
create unique index if not exists pagos_stripe_referencia_unique
  on public.pagos (referencia)
  where metodo = 'stripe';
