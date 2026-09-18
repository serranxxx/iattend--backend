-- Gastos fijos del mes (Admin Control Center)
-- Correr en el SQL editor de Supabase (o psql con service role).
--
-- Reemplaza la constante PUNTO_EQUILIBRIO_NETO = 15318 que vivía hardcodeada en
-- src/pages/Admin/SalesAdminPage.jsx del front. La meta de ingreso neto del mes
-- ahora es la suma de los 5 rubros de gasto fijo, editable desde la calculadora
-- de la pantalla Ventas y persistida por mes.
--
-- Una fila por (anio, mes). Sin RLS pública: se lee y escribe solo desde el
-- backend con service role, detrás del middleware validarAdmin.

create table if not exists public.admin_gastos_fijos (
  id          uuid primary key default gen_random_uuid(),
  anio        smallint not null,
  mes         smallint not null check (mes between 1 and 12),
  renta       numeric(12, 2) not null default 0,
  nomina      numeric(12, 2) not null default 0,
  software    numeric(12, 2) not null default 0,
  marketing   numeric(12, 2) not null default 0,
  otros       numeric(12, 2) not null default 0,
  neto_venta  numeric(12, 2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint admin_gastos_fijos_periodo_unique unique (anio, mes)
);

-- updated_at automático
create or replace function public.set_admin_gastos_fijos_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_admin_gastos_fijos_updated_at on public.admin_gastos_fijos;
create trigger trg_admin_gastos_fijos_updated_at
  before update on public.admin_gastos_fijos
  for each row
  execute function public.set_admin_gastos_fijos_updated_at();

-- RLS activo y sin policies: nadie llega con la anon key, solo el service role
-- del backend (que las omite). El front siempre pasa por /api/admin/gastos-fijos.
alter table public.admin_gastos_fijos enable row level security;

-- Semilla: reproduce la meta fija actual ($15,318) para septiembre 2026.
-- 4200 + 6500 + 1800 + 2100 + 718 = 15318
insert into public.admin_gastos_fijos (anio, mes, renta, nomina, software, marketing, otros, neto_venta)
values (2026, 9, 4200, 6500, 1800, 2100, 718, 2258)
on conflict (anio, mes) do nothing;
