-- Límite de storage de "Subidos" en los Pops y compra de espacio extra.
-- Correr en el SQL editor de Supabase (o psql con service role).
--
-- Igual que las invitaciones (2026-10-28c_storage_por_invitacion.sql), con el
-- mismo precio por MB (5 créditos: allá 10 → 30 MB por 100):
--   base 5 MB · 15 MB (+10 MB, 50 créditos) · 30 MB (+15 MB desde 15, 75).
-- Los créditos son los del Pop (side_events.credits). Qué cuenta: todo lo que
-- el Pop sube a su carpeta del bucket user_images (flash-{id}/…, fotos,
-- videos, PNG, vectores y la imagen del link), menos el audio de la canción
-- (flash-{id}/audio/…). El costo y los niveles los decide el backend
-- (router/storage.route.js, POST /api/storage/pop-upgrade).

alter table public.side_events
  add column if not exists storage_limit_mb smallint not null default 5;

-- Bytes usados por un Pop. La lee el editor con la anon key para el medidor y
-- antes de subir: solo devuelve un número.
create or replace function public.pop_storage_usage(p_side_event_id bigint)
returns bigint
language sql
stable
security definer
set search_path = public, storage
as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)
  from storage.objects o
  where o.bucket_id = 'user_images'
    and o.name like 'flash-' || p_side_event_id::text || '/%'
    and o.name not like 'flash-' || p_side_event_id::text || '/audio/%';
$$;

grant execute on function public.pop_storage_usage(bigint) to anon, authenticated;

-- Compra de espacio extra de un Pop: descuenta sus créditos y sube el límite
-- en una sola transacción, con el Pop bloqueado.
create or replace function public.comprar_storage_pop(
  p_side_event_id bigint,
  p_cost          integer,
  p_new_limit_mb  integer
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_credits integer;
  v_limit   integer;
begin
  if p_cost is null or p_cost <= 0 or p_new_limit_mb is null or p_new_limit_mb <= 0 then
    return json_build_object('success', false, 'code', 'BAD_PACKAGE');
  end if;

  select credits, storage_limit_mb into v_credits, v_limit
  from public.side_events
  where id = p_side_event_id and invitation_id is null
  for update;

  if not found then
    return json_build_object('success', false, 'code', 'NOT_FOUND');
  end if;

  if v_limit >= p_new_limit_mb then
    return json_build_object('success', false, 'code', 'ALREADY_UPGRADED', 'storage_limit_mb', v_limit);
  end if;

  if coalesce(v_credits, 0) < p_cost then
    return json_build_object('success', false, 'code', 'NOT_ENOUGH_CREDITS', 'credits', coalesce(v_credits, 0));
  end if;

  update public.side_events
  set credits = credits - p_cost,
      storage_limit_mb = p_new_limit_mb
  where id = p_side_event_id;

  return json_build_object(
    'success', true,
    'storage_limit_mb', p_new_limit_mb,
    'credits', v_credits - p_cost
  );
end;
$function$;

-- Solo el backend (service role): con la anon key cualquiera podría gastar
-- los créditos de otro Pop.
revoke all on function public.comprar_storage_pop(bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.comprar_storage_pop(bigint, integer, integer) to service_role;
