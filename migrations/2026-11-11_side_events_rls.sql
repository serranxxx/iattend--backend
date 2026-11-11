-- Acceso a side events y Pops solo para quien los gestiona.
--
-- Problema: el editor (iattend-vite /dashboard/side?pop=<id>, id numérico
-- secuencial) lee y guarda side_events / side_events_guests directo con la
-- sesión del usuario (rol authenticated), y en las migraciones no había RLS
-- ni políticas para esas tablas: cualquier cuenta podía abrir y editar un Pop
-- ajeno cambiando el número. Además consume_side_event_credits era
-- security definer, con grant a anon y sin chequeo de dueño.
--
-- Estado real visto el 2026-11-11 con la anon key (sin sesión):
--   · side_events y side_events_guests → 42501 permission denied (anon ya no
--     tiene grant). Lo que falta cerrar es el rol authenticated.
--   · side_event_publico / side_event_lector / can_manage_invitation responden
--     a anon sin grant sobre la tabla → son security definer y no les afecta
--     esta RLS (el dueño de la tabla la salta; aquí no se usa FORCE).
--   · consume_side_event_credits responde a anon (vacía créditos ajenos).
--
-- ANTES DE CORRER, en el SQL editor de Supabase (para saber qué hay):
--   select relname, relrowsecurity, relforcerowsecurity
--     from pg_class where relname in ('side_events', 'side_events_guests');
--   select tablename, policyname, permissive, roles, cmd, qual, with_check
--     from pg_policies where tablename in ('side_events', 'side_events_guests');
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name in ('side_events', 'side_events_guests')
--      and grantee in ('anon', 'authenticated') order by 1, 2;
--   select grantee, column_name, privilege_type from information_schema.column_privileges
--    where table_name = 'side_events' and grantee in ('anon', 'authenticated');
--
-- Cómo cierra sin borrar políticas que no conocemos: las políticas
-- permisivas se suman con OR (una "using (true)" vieja dejaría todo abierto),
-- pero las RESTRICTIVAS se aplican con AND sobre cualquier permisiva. Esta
-- migración pone las dos: una permisiva con la regla (para que el dueño
-- pase aunque no hubiera ninguna) y una restrictiva con la misma regla (para
-- que una permisiva abierta que ya exista no deje pasar a nadie más).
--
-- Regla (la misma de can_manage_invitation y de conOrganizador en
-- router/sideEventChat.js):
--   · side event de boda (invitation_id): quien gestiona esa invitación.
--   · Pop (sin invitation_id): user_id = yo, planner asignado (rol planner
--     activo) o Administration activo.
--   · Crear: solo side events de una invitación que gestiono (los Pops los
--     crea el backend con la service role, después del pago); Admin, todo.
--
-- Columnas: authenticated solo puede escribir lo que el editor escribe
-- (name, url_image, body, type, rsvp_deadline, legacy_link_enabled; al crear
-- invitation_id, date, name, url_image, body). credits, user_id, planner_id,
-- user_email, storage_limit_mb, public_code, is_test… solo el backend.
-- Los créditos del Pop se restan con consume_side_event_credits.
--
-- El backend usa la service role y no le afecta nada de esto.

begin;

-- 1. Reglas -----------------------------------------------------------------
-- Nombres propios a propósito: en producción ya existe una
-- can_manage_side_event(p_id bigint) que no está en las migraciones (salió de
-- docs/auditoria-rls-supabase.md de iattend-vite). No se toca, por si alguna
-- política la usa.

create or replace function public.es_admin_activo()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
     where p.user_id = auth.uid()
       and coalesce(p.active, true)
       and p.role = 'Administration'
  );
$$;

-- Por columnas (no por id) para usarla en las políticas de side_events sin
-- volver a leer la tabla.
create or replace function public.puede_gestionar_side_event_fila(
  p_invitation_id uuid,
  p_user_id uuid,
  p_planner_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_invitation_id is not null then public.can_manage_invitation(p_invitation_id)
    else auth.uid() is not null and (
      p_user_id = auth.uid()
      or exists (
        select 1 from public.profiles p
         where p.user_id = auth.uid()
           and coalesce(p.active, true)
           and (p.role = 'Administration' or (p.role = 'planner' and p_planner_id = p.user_id))
      )
    )
  end;
$$;

create or replace function public.puede_gestionar_side_event(p_side_event_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.side_events s
     where s.id = p_side_event_id
       and public.puede_gestionar_side_event_fila(s.invitation_id, s.user_id, s.planner_id)
  );
$$;

revoke all on function public.es_admin_activo() from public;
revoke all on function public.puede_gestionar_side_event_fila(uuid, uuid, uuid) from public;
revoke all on function public.puede_gestionar_side_event(bigint) from public;
grant execute on function public.es_admin_activo() to anon, authenticated;
grant execute on function public.puede_gestionar_side_event_fila(uuid, uuid, uuid) to anon, authenticated;
grant execute on function public.puede_gestionar_side_event(bigint) to anon, authenticated;

-- 2. side_events ------------------------------------------------------------

alter table public.side_events enable row level security;

drop policy if exists side_events_gestion_select on public.side_events;
drop policy if exists side_events_gestion_insert on public.side_events;
drop policy if exists side_events_gestion_update on public.side_events;
drop policy if exists side_events_gestion_delete on public.side_events;
drop policy if exists side_events_solo_gestion_select on public.side_events;
drop policy if exists side_events_solo_gestion_insert on public.side_events;
drop policy if exists side_events_solo_gestion_update on public.side_events;
drop policy if exists side_events_solo_gestion_delete on public.side_events;

-- Permisivas
create policy side_events_gestion_select on public.side_events
  for select to authenticated
  using (public.puede_gestionar_side_event_fila(invitation_id, user_id, planner_id));

create policy side_events_gestion_insert on public.side_events
  for insert to authenticated
  with check (
    (invitation_id is not null and public.can_manage_invitation(invitation_id))
    or public.es_admin_activo()
  );

create policy side_events_gestion_update on public.side_events
  for update to authenticated
  using (public.puede_gestionar_side_event_fila(invitation_id, user_id, planner_id))
  with check (public.puede_gestionar_side_event_fila(invitation_id, user_id, planner_id));

-- Borrar: los de boda quien gestiona la invitación; un Pop (pagado) solo Admin.
create policy side_events_gestion_delete on public.side_events
  for delete to authenticated
  using (
    (invitation_id is not null and public.can_manage_invitation(invitation_id))
    or public.es_admin_activo()
  );

-- Restrictivas (anulan cualquier permisiva abierta que ya existiera)
create policy side_events_solo_gestion_select on public.side_events
  as restrictive for select to public
  using (public.puede_gestionar_side_event_fila(invitation_id, user_id, planner_id));

create policy side_events_solo_gestion_insert on public.side_events
  as restrictive for insert to public
  with check (
    (invitation_id is not null and public.can_manage_invitation(invitation_id))
    or public.es_admin_activo()
  );

create policy side_events_solo_gestion_update on public.side_events
  as restrictive for update to public
  using (public.puede_gestionar_side_event_fila(invitation_id, user_id, planner_id))
  with check (public.puede_gestionar_side_event_fila(invitation_id, user_id, planner_id));

create policy side_events_solo_gestion_delete on public.side_events
  as restrictive for delete to public
  using (
    (invitation_id is not null and public.can_manage_invitation(invitation_id))
    or public.es_admin_activo()
  );

-- Grants por columna. anon no lee ni escribe la tabla (la página pública va
-- por side_event_publico; el lector, por side_event_lector y el backend).
revoke all on public.side_events from anon;
revoke insert, update on public.side_events from authenticated;
grant select, delete on public.side_events to authenticated;
-- Solo las columnas que existan (legacy_link_enabled llega con
-- 2026-11-01b_side_events_public_code.sql; si no corrió, no truena aquí).
do $$
declare
  v_insert text;
  v_update text;
begin
  select string_agg(quote_ident(column_name), ', ') into v_insert
    from information_schema.columns
   where table_schema = 'public' and table_name = 'side_events'
     and column_name in ('invitation_id', 'date', 'name', 'url_image', 'body');
  select string_agg(quote_ident(column_name), ', ') into v_update
    from information_schema.columns
   where table_schema = 'public' and table_name = 'side_events'
     and column_name in ('name', 'url_image', 'body', 'type', 'rsvp_deadline', 'legacy_link_enabled');
  execute format('grant insert (%s) on public.side_events to authenticated', v_insert);
  execute format('grant update (%s) on public.side_events to authenticated', v_update);
end;
$$;

-- 3. side_events_guests -----------------------------------------------------

alter table public.side_events_guests enable row level security;

drop policy if exists side_events_guests_gestion on public.side_events_guests;
drop policy if exists side_events_guests_solo_gestion on public.side_events_guests;

create policy side_events_guests_gestion on public.side_events_guests
  for all to authenticated
  using (public.puede_gestionar_side_event(side_events_id::bigint))
  with check (public.puede_gestionar_side_event(side_events_id::bigint));

create policy side_events_guests_solo_gestion on public.side_events_guests
  as restrictive for all to public
  using (public.puede_gestionar_side_event(side_events_id::bigint))
  with check (public.puede_gestionar_side_event(side_events_id::bigint));

-- El invitado entra, confirma y elige avatar por el backend
-- (router/sideEventInvitado.js); anon no toca la tabla.
revoke all on public.side_events_guests from anon;
grant select, insert, update, delete on public.side_events_guests to authenticated;

-- 4. Créditos del Pop -------------------------------------------------------
-- Antes: cualquiera (también anon) restaba créditos de cualquier Pop.
-- Ahora solo quien gestiona el Pop; si no, 42501 (el editor lo trata como
-- error y no cae a escribir credits directo, que ya tampoco tiene grant).

create or replace function public.consume_side_event_credits(p_side_event_id bigint, p_amount integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_credits integer;
begin
  if not public.puede_gestionar_side_event(p_side_event_id) then
    raise exception 'not authorized for side event %', p_side_event_id using errcode = '42501';
  end if;

  update public.side_events
     set credits = greatest(coalesce(credits, 0) - abs(p_amount), 0)
   where id = p_side_event_id and invitation_id is null
  returning credits into v_credits;

  return v_credits;
end;
$$;

revoke all on function public.consume_side_event_credits(bigint, integer) from public, anon;
grant execute on function public.consume_side_event_credits(bigint, integer) to authenticated;

commit;

-- PRUEBA DE LOS TRES USUARIOS (después de correr; no cambia nada, termina en
-- rollback). Cambia <POP_ID> y el uuid de cada usuario (profiles.user_id) y
-- corre un bloque por usuario: dueño, planner asignado, admin y una cuenta
-- cualquiera. Los tres primeros deben dar true / 1 fila; la cuenta cualquiera,
-- false / 0 filas.
--
--   begin;
--   select set_config('request.jwt.claims', json_build_object('sub', '<UUID_USUARIO>', 'role', 'authenticated')::text, true);
--   set local role authenticated;
--   select public.puede_gestionar_side_event(<POP_ID>) as puede;
--   select id, name from public.side_events where id = <POP_ID>;                 -- lo que ve el editor
--   select count(*) from public.side_events_guests where side_events_id = <POP_ID>;
--   rollback;
--
-- Para un side event de boda, la regla es can_manage_invitation de su
-- invitación; conviene revisar que la de producción sea la de
-- 2026-09-24_planner_role.sql:
--   select pg_get_functiondef('public.can_manage_invitation(uuid)'::regprocedure);
--
-- DESPUÉS DE CORRER, comprobar:
--   · Con una cuenta normal, /dashboard/side?pop=<id de un Pop ajeno> no carga
--     (y la app regresa a /invitations).
--   · El dueño / su planner editan, guardan, agregan invitados y mandan
--     WhatsApp como siempre; un admin ve y edita todo.
--   · iattend.events/side-event/<código> y el lector (/scanner?pop=) siguen igual.
