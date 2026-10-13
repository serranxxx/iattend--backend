-- Método de pago de la venta: transferencia (pide comprobante de cada abono) o
-- digital (Stripe / pago en línea: el comprobante es el propio cobro, no se pide).

alter table public.ventas
  add column if not exists metodo_pago text not null default 'transferencia';

alter table public.ventas drop constraint if exists ventas_metodo_pago_check;
alter table public.ventas
  add constraint ventas_metodo_pago_check check (metodo_pago in ('transferencia', 'digital'));

-- Las compras en línea (vendedor Ecommerce) son digitales. Hoy: Damián & Larissa.
update public.ventas v
set metodo_pago = 'digital'
from public.vendedores d
where d.id = v.vendedor_id and d.tipo = 'ecommerce';

-- Abonos sin comprobante: igual que antes, pero sin las ventas digitales.
drop view if exists public.ventas_comprobante_pendiente;
create view public.ventas_comprobante_pendiente as
select p.venta_id, count(*) as abonos_sin_comprobante
from public.pagos p
join public.ventas v on v.id = p.venta_id
where p.comprobante_url is null
  and v.metodo_pago <> 'digital'
group by p.venta_id;

grant select on public.ventas_comprobante_pendiente to anon, authenticated, service_role;
