-- Ventas de Paperless en Admin › Ventas.
--
-- Hasta hoy ventas.plan solo aceptaba PRO / Lite / Flash y registrarVentaEcommerce
-- descartaba a propósito las compras de Paperless: el pago y la invitación sí
-- quedaban, pero no había venta y Admin › Ventas no la veía. Las ventas manuales
-- de invitaciones Paperless se capturaron como "Lite" porque el formulario solo
-- ofrecía PRO / Lite.
--
-- Paperless no comisiona (ventasCalculos.js: COMISION_POR_PLAN.Paperless = 0).
-- Correr ANTES de desplegar el backend que ya registra Paperless (si no, el
-- insert del webhook choca con el check y solo deja el error en el log).

-- 1. El check de plan acepta Paperless.
alter table public.ventas drop constraint if exists ventas_plan_check;
alter table public.ventas
  add constraint ventas_plan_check check (plan in ('PRO', 'Lite', 'Paperless', 'Flash'));

-- 2. Compra en línea de Paperless que se perdió (la única en Stripe live):
--    cs_live_a0A3ncuJ…, 25 nov 2026, $849, invitación 6690fd96-… (vpedroz4).
--    Mismo registro que haría registrarVentaEcommerce. La comisión de Stripe del
--    pago (pagos.comision_stripe) la llena conciliarComisionesStripe la próxima
--    vez que se abra Admin › Ventas.
with nueva as (
  insert into public.ventas (invitation_id, vendedor_id, plan, precio_acordado, descuento_pct, fecha_venta, metodo_pago, notas)
  select '6690fd96-4f54-4d20-b558-ddeff9dda0dd', d.id, 'Paperless', 849, 0, '2026-11-25T14:37:26Z', 'digital', 'Compra en línea (Stripe)'
  from public.vendedores d
  where d.tipo = 'ecommerce'
    and not exists (select 1 from public.ventas v where v.invitation_id = '6690fd96-4f54-4d20-b558-ddeff9dda0dd')
  limit 1
  returning id
)
insert into public.pagos (venta_id, monto, fecha, metodo, referencia, nota)
select id, 849, '2026-11-25T14:37:26Z', 'stripe',
       'cs_live_a0A3ncuJcmoipZwA2XqBfynJlQ6gHgJK1WeiTden2XfeVdOUhvJOWDuIr5', 'Pago en línea (Stripe)'
from nueva
where not exists (
  select 1 from public.pagos p
  where p.metodo = 'stripe' and p.referencia = 'cs_live_a0A3ncuJcmoipZwA2XqBfynJlQ6gHgJK1WeiTden2XfeVdOUhvJOWDuIr5'
);

-- 3. (CONFIRMAR ANTES DE CORRER) Ventas manuales capturadas como "Lite" cuya
--    invitación es Paperless: vannia&roberto ($850, ene 2026) y luisa&luis
--    ($990, jul 2026), las dos de Paulina Pérez. No cambia ninguna comisión ni
--    bono: las dos están bajo el mínimo de $1,000, así que ya no entraban en
--    "primeras 3 del mes" ni en los hitos. Solo cambian de Lite a Paperless en
--    los conteos y gráficas.
-- update public.ventas v
-- set plan = 'Paperless'
-- from public.invitations i
-- where i.id = v.invitation_id
--   and i.plan = 'paperless'
--   and v.plan = 'Lite';
