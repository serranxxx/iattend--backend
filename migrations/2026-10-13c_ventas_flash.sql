-- Ventas de Eventos Flash: una venta puede ser de una invitación o de un Flash
-- (side event sin invitación). Plan 'Flash'. No pagan comisión a vendedores;
-- si se compran con Stripe, solo se descuenta lo de Stripe (pagos.comision_stripe).

alter table public.ventas alter column invitation_id drop not null;

alter table public.ventas
  add column if not exists side_event_id bigint references public.side_events (id) on delete set null;

-- Una venta es de una invitación o de un Flash.
alter table public.ventas drop constraint if exists ventas_evento_check;
alter table public.ventas
  add constraint ventas_evento_check check (invitation_id is not null or side_event_id is not null);

-- Un Flash solo tiene una venta.
create unique index if not exists ventas_side_event_unique
  on public.ventas (side_event_id)
  where side_event_id is not null;

-- El check de plan aceptaba solo PRO / Lite. Se quita el que haya (no tiene
-- nombre versionado) y se pone uno con Flash.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.ventas'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%plan%'
  loop
    execute format('alter table public.ventas drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.ventas
  add constraint ventas_plan_check check (plan in ('PRO', 'Lite', 'Flash'));
