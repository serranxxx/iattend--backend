-- Planes de Pops por cuenta: Free / Pops Plus (suscripción).
-- Decisiones y reglas: iattend-vite/docs/editor-pops-planes-paso0.md.
--
-- 1. pops_suscripciones: el plan de cada cuenta. Solo la escribe el backend
--    (webhook de Stripe, service role); el usuario solo lee la suya. Sin
--    fila = Free.
-- 2. side_events.pops_plus: un Pop que es Plus por sí mismo, sin importar el
--    plan del dueño. Todos los Pops que ya existen (pagados o gratis por
--    beneficio) quedan Plus. La columna nace con default true porque hoy los
--    únicos caminos para crear un Pop son la compra y los Pops gratis; el
--    flujo nuevo de "Pop Free" tendrá que mandar pops_plus = false.
-- 3. Funciones: pops_plan_de(usuario) y pop_es_plus(side_event).
-- 4. Límites que no pasan por el editor (triggers, aplican también al
--    backend y al registro público):
--    · side_events_guests: 30 personas por Pop Free y 3 Pops Free activos
--      (= con al menos un invitado) por dueño.
--    · forms: en Free, 3 formularios y 2 preguntas por formulario. Una cuenta
--      con algún Pop Plus (p. ej. los que ya pagó) cuenta como Plus aquí, para
--      no trabar los formularios que ya usan esos Pops.

begin;

-- 1. Suscripciones ---------------------------------------------------------

create table if not exists public.pops_suscripciones (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  plan                   text not null default 'free' check (plan in ('free', 'plus')),
  status                 text,          -- status en Stripe (active, trialing, past_due, canceled…)
  current_period_end     timestamptz,   -- hasta cuándo está pagado
  cancel_at_period_end   boolean not null default false,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  updated_at             timestamptz not null default now()
);

alter table public.pops_suscripciones enable row level security;

drop policy if exists pops_suscripciones_propia on public.pops_suscripciones;
create policy pops_suscripciones_propia on public.pops_suscripciones
  for select to authenticated
  using (user_id = auth.uid() or public.es_admin_activo());

revoke all on public.pops_suscripciones from anon, authenticated;
grant select on public.pops_suscripciones to authenticated;

-- 2. Pops Plus por sí mismos ------------------------------------------------

alter table public.side_events
  add column if not exists pops_plus boolean not null default true;

-- 3. Funciones -------------------------------------------------------------

-- Plan vigente de una cuenta. Administración siempre es Plus.
-- past_due sigue contando mientras Stripe reintenta el cobro.
create or replace function public.pops_plan_de(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_user_id is null then 'free'
    when exists (select 1 from public.profiles p
                  where p.user_id = p_user_id and p.role = 'Administration' and coalesce(p.active, true))
      then 'plus'
    when exists (select 1 from public.pops_suscripciones s
                  where s.user_id = p_user_id and s.plan = 'plus'
                    and s.status in ('active', 'trialing', 'past_due')
                    and (s.current_period_end is null or s.current_period_end > now()))
      then 'plus'
    else 'free'
  end;
$$;

-- Dueño de un Pop: el cliente (user_id) o, si todavía no tiene ("enviar
-- después"), el planner.
create or replace function public.pop_es_plus(p_side_event_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select s.invitation_id is not null            -- side event de boda: sin planes de Pops
        or s.pops_plus
        or public.pops_plan_de(coalesce(s.user_id, s.planner_id)) = 'plus'
      from public.side_events s
     where s.id = p_side_event_id
  ), false);
$$;

revoke all on function public.pops_plan_de(uuid) from public;
revoke all on function public.pop_es_plus(bigint) from public;
grant execute on function public.pops_plan_de(uuid) to authenticated, service_role;
grant execute on function public.pop_es_plus(bigint) to authenticated, service_role;

-- 4a. Personas y Pops activos ---------------------------------------------

create or replace function public.pops_limite_invitados()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_side   public.side_events%rowtype;
  v_dueno  uuid;
  v_ya     integer;
  v_activos integer;
begin
  select * into v_side from public.side_events where id = new.side_events_id;
  if not found or v_side.invitation_id is not null or public.pop_es_plus(v_side.id) then
    return new;
  end if;

  select count(*) into v_ya from public.side_events_guests where side_events_id = v_side.id;
  if v_ya >= 30 then
    raise exception 'POP_LIMITE_PERSONAS' using errcode = 'P0001',
      hint = 'Un Pop Free admite hasta 30 personas (invitados + acompañantes).';
  end if;

  -- Primer invitado = el Pop se vuelve activo.
  if v_ya = 0 then
    v_dueno := coalesce(v_side.user_id, v_side.planner_id);
    select count(*) into v_activos
      from public.side_events s
     where s.invitation_id is null
       and not s.pops_plus
       and s.id <> v_side.id
       and coalesce(s.user_id, s.planner_id) = v_dueno
       and exists (select 1 from public.side_events_guests g where g.side_events_id = s.id);
    if v_activos >= 3 then
      raise exception 'POP_LIMITE_ACTIVOS' using errcode = 'P0001',
        hint = 'Con Free puedes tener hasta 3 Pops con invitados a la vez.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists pops_limite_invitados on public.side_events_guests;
create trigger pops_limite_invitados
  before insert on public.side_events_guests
  for each row execute function public.pops_limite_invitados();

-- 4b. Formularios ----------------------------------------------------------

create or replace function public.pops_limite_formularios()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_preguntas integer;
  v_formas    integer;
begin
  if public.pops_plan_de(new.user_id) = 'plus'
     or exists (select 1 from public.side_events s
                 where s.invitation_id is null and s.pops_plus
                   and (s.user_id = new.user_id or s.planner_id = new.user_id)) then
    return new;
  end if;

  select count(*) into v_preguntas
    from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) it
   where coalesce(it->>'kind', '') <> 'section';
  if v_preguntas > 2 then
    raise exception 'FORM_LIMITE_PREGUNTAS' using errcode = 'P0001',
      hint = 'Con Free un formulario lleva hasta 2 preguntas.';
  end if;

  if tg_op = 'INSERT' then
    select count(*) into v_formas from public.forms where user_id = new.user_id;
    if v_formas >= 3 then
      raise exception 'FORM_LIMITE_FORMULARIOS' using errcode = 'P0001',
        hint = 'Con Free puedes tener hasta 3 formularios.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists pops_limite_formularios on public.forms;
create trigger pops_limite_formularios
  before insert or update on public.forms
  for each row execute function public.pops_limite_formularios();

commit;

-- Comprobar:
--   select count(*) filter (where pops_plus), count(*) from side_events where invitation_id is null;
--   -- (todos los Pops que ya existen deben salir Plus)
--   select public.pops_plan_de(auth.uid());   -- desde la app: 'free' o 'plus'
