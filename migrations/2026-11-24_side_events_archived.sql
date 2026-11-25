-- Archivar Pops (iattend-vite, Pops › Mis Pops: menú ⋯ → Archivar / Desarchivar;
-- handoff "App de Pops", §5). Lo escribe el backend
-- (router/sideEventArchivo.js: POST /api/side-events/:id/archivar).
-- null = no archivado. Un Pop archivado sale en el filtro "Archivo" y deja de
-- contar como Pop activo del plan Free.
alter table public.side_events
    add column if not exists archived_at timestamptz;

-- Tope de 3 Pops Free activos (migración 2026-11-23c): un Pop archivado ya no
-- ocupa lugar. Misma función que en 2026-11-23c con `archived_at is null`;
-- correr DESPUÉS de esa migración (si se vuelve a correr la 23c, se pierde
-- este filtro y hay que volver a correr esta).
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
       and s.archived_at is null
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

notify pgrst, 'reload schema';
