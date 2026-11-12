-- Pop en línea: lo privado (enlace, códigos, material) pasa de la columna
-- side_events.acceso a su propia tabla. Correr en el SQL editor de Supabase.
--
-- Por qué: la RPC pública side_event_publico (la que lee la página del
-- invitado con la anon key) devuelve la fila de side_events casi completa,
-- así que la columna `acceso` salía en ella antes de confirmar. En una tabla
-- aparte no la ve: solo la lee quien gestiona el Pop (RLS) y el backend
-- (GET /api/side-events/:clave/acceso, solo a confirmados).

create table if not exists public.side_event_acceso (
  side_event_id bigint primary key references public.side_events(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.side_event_acceso enable row level security;

revoke all on public.side_event_acceso from anon;
grant select, insert, update, delete on public.side_event_acceso to authenticated;

drop policy if exists side_event_acceso_gestion on public.side_event_acceso;
create policy side_event_acceso_gestion on public.side_event_acceso
  for all to authenticated
  using (public.puede_gestionar_side_event(side_event_id))
  with check (public.puede_gestionar_side_event(side_event_id));

-- Lo que ya estaba en la columna se copia a la tabla…
insert into public.side_event_acceso (side_event_id, data)
select id, acceso from public.side_events where acceso is not null
on conflict (side_event_id) do update set data = excluded.data, updated_at = now();

-- …y la columna se quita (deja de salir en la RPC pública).
alter table public.side_events drop column if exists acceso;

notify pgrst, 'reload schema';
