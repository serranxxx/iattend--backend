-- Límite de storage de "Subidos" por invitación y compra de espacio extra.
-- Correr en el SQL editor de Supabase (o psql con service role).
--
-- Qué cuenta (bucket user_images): las fotos y videos de la invitación
-- ({id}/… y {id}/video/…) y sus stickers PNG (inv-{id}/…). NO cuenta:
--   · el Photo Wall (bucket event-photos): son fotos de los invitados;
--   · el audio de la canción ({id}/audio/…): no se ve en Subidos;
--   · Eventos Flash (flash-{id}/…) y el Save the Date temporal.
--
-- Base: 10 MB (storage_limit_mb). Espacio extra: 10 → 30 MB por 100 créditos
-- I attend, descontados en la misma transacción (comprar_storage_extra). El
-- costo y los MB los decide el backend (POST /api/storage/upgrade).

alter table public.invitations
  add column if not exists storage_limit_mb smallint not null default 10;

-- Bytes usados en Subidos por una invitación. La lee el editor con la anon
-- key para el medidor y antes de subir: solo devuelve un número.
create or replace function public.invitation_storage_usage(p_invitation_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, storage
as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)
  from storage.objects o
  where o.bucket_id = 'user_images'
    and (
      (o.name like p_invitation_id::text || '/%' and o.name not like p_invitation_id::text || '/audio/%')
      or o.name like 'inv-' || p_invitation_id::text || '/%'
    );
$$;

grant execute on function public.invitation_storage_usage(uuid) to anon, authenticated;

-- Compra de espacio extra: descuenta los créditos y sube el límite en una
-- sola transacción, con la invitación bloqueada.
create or replace function public.comprar_storage_extra(
  p_invitation_id uuid,
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
  from public.invitations
  where id = p_invitation_id
  for update;

  if not found then
    return json_build_object('success', false, 'code', 'NOT_FOUND');
  end if;

  if v_limit >= p_new_limit_mb then
    return json_build_object('success', false, 'code', 'ALREADY_UPGRADED', 'storage_limit_mb', v_limit);
  end if;

  if coalesce(v_credits, 0) < p_cost then
    return json_build_object('success', false, 'code', 'NOT_ENOUGH_CREDITS', 'iattend_credits', coalesce(v_credits, 0));
  end if;

  update public.invitations
  set credits = credits - p_cost,
      storage_limit_mb = p_new_limit_mb
  where id = p_invitation_id;

  return json_build_object(
    'success', true,
    'storage_limit_mb', p_new_limit_mb,
    'iattend_credits', v_credits - p_cost
  );
end;
$function$;

-- Solo el backend (service role): con la anon key cualquiera podría gastar
-- los créditos de otro evento.
revoke all on function public.comprar_storage_extra(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.comprar_storage_extra(uuid, integer, integer) to service_role;
