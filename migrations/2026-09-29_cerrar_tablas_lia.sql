-- Cierra las tablas de Lia a la anon key y a usuarios logueados.
--
-- 2026-09-15_ai_logs_lectura_anon.sql abrió ai_agent_logs, ai_daily_usage y
-- ai_pending_actions con `using (true)` para que Admin → Analítica las leyera
-- desde el navegador, y ai_conversations ya era legible así. La anon key va en
-- el bundle: cualquiera podía descargar todas las conversaciones de todos los
-- organizadores (nombres de invitados, resúmenes de WhatsApp, RSVPs) y las
-- acciones pendientes.
--
-- Ahora la analítica lee por GET /api/admin/lia/datos (validarAdmin) y todo lo
-- demás de Lia pasa por el backend con la service role, que no depende de
-- GRANTs ni policies. Correr después de desplegar el backend y el front que
-- ya usan ese endpoint; antes, la analítica de Lia se quedaría vacía.

do $$
declare
  r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('ai_conversations', 'ai_agent_logs', 'ai_daily_usage', 'ai_pending_actions')
      and roles && array['anon', 'authenticated', 'public']::name[]
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.ai_conversations   enable row level security;
alter table public.ai_agent_logs      enable row level security;
alter table public.ai_daily_usage     enable row level security;
alter table public.ai_pending_actions enable row level security;

revoke all on public.ai_conversations   from anon, authenticated;
revoke all on public.ai_agent_logs      from anon, authenticated;
revoke all on public.ai_daily_usage     from anon, authenticated;
revoke all on public.ai_pending_actions from anon, authenticated;

-- Verificación: las cuatro deben salir sin privilegios para anon/authenticated
-- select table_name, grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in ('ai_conversations','ai_agent_logs','ai_daily_usage','ai_pending_actions')
--   and grantee in ('anon','authenticated');
