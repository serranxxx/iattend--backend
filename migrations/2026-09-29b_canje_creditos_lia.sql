-- Canje de créditos I attend → créditos de Lia, y saldo pagado de Lia que ya
-- no se pierde.
--
-- Cómo funciona el saldo de Lia (1 crédito de Lia = $0.01 USD de modelo,
-- mínimo 1 por mensaje; ver consume_lia_credits):
--   · free_limit / free_used: 50 gratis al día, se reinician a la medianoche
--     de CDMX (una fila de ai_daily_usage por invitación y día).
--   · paid_balance: lo comprado. Vive en la fila del día y se copia a la fila
--     nueva al día siguiente.
--
-- Qué se corrige:
--   1. get_or_create_daily_usage solo copiaba el paid_balance de AYER: si el
--      organizador no abría Lia un día, lo comprado se perdía. Ahora se copia
--      de la última fila, sea del día que sea.
--   2. get_lia_credits_status, sin fila de hoy, reportaba total_available = 50
--      aunque hubiera saldo pagado. Ahora suma lo pagado.
--   3. La fila del día se crea con ON CONFLICT: dos peticiones simultáneas ya
--      no pueden duplicarla (índice único nuevo).
--   4. canjear_creditos_lia: descuenta invitations.credits y suma a
--      paid_balance en una sola transacción, con la invitación bloqueada.
--   5. Estas funciones son SECURITY DEFINER y Postgres las deja ejecutar a
--      PUBLIC por defecto: con la anon key cualquiera podía gastar el saldo
--      de Lia de otro evento (o, con el canje, sus créditos I attend). Solo el
--      backend (service_role) las llama.

-- 3. Una fila por invitación y día --------------------------------------------
create unique index if not exists ai_daily_usage_invitation_day_key
  on public.ai_daily_usage (invitation_id, usage_date);

-- 1. Fila del día, heredando el saldo pagado de la última -------------------
create or replace function public.get_or_create_daily_usage(p_invitation_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_today        date := (now() at time zone 'America/Mexico_City')::date;
  v_record       public.ai_daily_usage%rowtype;
  v_paid_balance integer;
begin
  select * into v_record
  from public.ai_daily_usage
  where invitation_id = p_invitation_id
    and usage_date = v_today;

  if not found then
    select paid_balance into v_paid_balance
    from public.ai_daily_usage
    where invitation_id = p_invitation_id
      and usage_date < v_today
    order by usage_date desc
    limit 1;

    insert into public.ai_daily_usage (invitation_id, usage_date, free_limit, free_used, paid_balance)
    values (p_invitation_id, v_today, 50, 0, coalesce(v_paid_balance, 0))
    on conflict (invitation_id, usage_date) do nothing;

    select * into v_record
    from public.ai_daily_usage
    where invitation_id = p_invitation_id
      and usage_date = v_today;
  end if;

  return json_build_object(
    'usage_date',      v_record.usage_date,
    'free_limit',      v_record.free_limit,
    'free_used',       v_record.free_used,
    'free_remaining',  v_record.free_limit - v_record.free_used,
    'paid_balance',    v_record.paid_balance,
    'total_available', (v_record.free_limit - v_record.free_used) + v_record.paid_balance,
    'total_spend_usd', v_record.total_spend_usd,
    'resets_at',       (v_today + interval '1 day')::text
  );
end;
$function$;

-- 2. Estado sin fila de hoy: los 50 gratis más lo pagado ---------------------
create or replace function public.get_lia_credits_status(p_invitation_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_today  date := (now() at time zone 'America/Mexico_City')::date;
  v_record public.ai_daily_usage%rowtype;
  v_paid   integer;
begin
  select * into v_record
  from public.ai_daily_usage
  where invitation_id = p_invitation_id
    and usage_date = v_today;

  if not found then
    select paid_balance into v_paid
    from public.ai_daily_usage
    where invitation_id = p_invitation_id
    order by usage_date desc
    limit 1;

    return json_build_object(
      'free_remaining',  50,
      'free_limit',      50,
      'paid_balance',    coalesce(v_paid, 0),
      'total_available', 50 + coalesce(v_paid, 0),
      'resets_at',       (v_today + interval '1 day')::text,
      'pct_free_used',   0,
      'total_spend_usd', 0
    );
  end if;

  return json_build_object(
    'free_remaining',  v_record.free_limit - v_record.free_used,
    'free_limit',      v_record.free_limit,
    'paid_balance',    v_record.paid_balance,
    'total_available', (v_record.free_limit - v_record.free_used) + v_record.paid_balance,
    'resets_at',       (v_today + interval '1 day')::text,
    'pct_free_used',   round(100.0 * v_record.free_used / nullif(v_record.free_limit, 0), 0),
    'total_spend_usd', v_record.total_spend_usd
  );
end;
$function$;

-- 4. Canje ---------------------------------------------------------------------
-- El backend valida que (p_ai_credits, p_iattend_cost) sea un paquete real
-- (router/ai.credits.route.js, LIA_PACKAGES); aquí solo se garantiza que el
-- descuento y el abono pasen juntos o no pase ninguno.
create or replace function public.canjear_creditos_lia(
  p_invitation_id uuid,
  p_ai_credits    integer,
  p_iattend_cost  integer
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_today   date := (now() at time zone 'America/Mexico_City')::date;
  v_credits integer;
  v_record  public.ai_daily_usage%rowtype;
begin
  if p_ai_credits is null or p_ai_credits <= 0 or p_iattend_cost is null or p_iattend_cost <= 0 then
    return json_build_object('success', false, 'code', 'BAD_PACKAGE');
  end if;

  -- Bloquea la invitación: dos canjes simultáneos se forman en fila.
  select credits into v_credits
  from public.invitations
  where id = p_invitation_id
  for update;

  if not found then
    return json_build_object('success', false, 'code', 'NOT_FOUND');
  end if;

  if coalesce(v_credits, 0) < p_iattend_cost then
    return json_build_object('success', false, 'code', 'NOT_ENOUGH_CREDITS', 'iattend_credits', coalesce(v_credits, 0));
  end if;

  update public.invitations
  set credits = credits - p_iattend_cost
  where id = p_invitation_id;

  perform public.get_or_create_daily_usage(p_invitation_id);

  update public.ai_daily_usage
  set paid_balance = paid_balance + p_ai_credits,
      updated_at   = now()
  where invitation_id = p_invitation_id
    and usage_date = v_today
  returning * into v_record;

  return json_build_object(
    'success',         true,
    'iattend_credits', v_credits - p_iattend_cost,
    'paid_balance',    v_record.paid_balance,
    'free_remaining',  v_record.free_limit - v_record.free_used,
    'total_available', (v_record.free_limit - v_record.free_used) + v_record.paid_balance
  );
end;
$function$;

-- 5. Solo el backend -------------------------------------------------------------
revoke execute on function public.get_or_create_daily_usage(uuid)                 from public, anon, authenticated;
revoke execute on function public.get_lia_credits_status(uuid)                    from public, anon, authenticated;
revoke execute on function public.consume_lia_credits(uuid, numeric)              from public, anon, authenticated;
revoke execute on function public.canjear_creditos_lia(uuid, integer, integer)    from public, anon, authenticated;
grant  execute on function public.get_or_create_daily_usage(uuid)                 to service_role;
grant  execute on function public.get_lia_credits_status(uuid)                    to service_role;
grant  execute on function public.consume_lia_credits(uuid, numeric)              to service_role;
grant  execute on function public.canjear_creditos_lia(uuid, integer, integer)    to service_role;
