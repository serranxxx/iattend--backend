-- Lectura de los registros de Lia desde el panel de administración.
--
-- PARA QUÉ: la pestaña Analítica → Lia ya lee `ai_conversations` con la anon
-- key y de ahí saca las preguntas, los temas y el modelo usado. Lo que NO puede
-- leer es el costo en dólares, que vive en `ai_agent_logs` / `ai_daily_usage`, y
-- las acciones que Lia propuso, en `ai_pending_actions`.
--
-- SÍNTOMA: hoy esas tres tablas devuelven CERO filas con la anon key y sin
-- error. No es un problema de GRANT (eso daría 42501): es RLS sin política que
-- contemple a `anon`, que filtra todo en silencio.
--
-- Correr en el SQL editor de Supabase. No toca datos: solo agrega políticas de
-- SELECT. Se pueden revocar con DROP POLICY sin consecuencias.
--
-- OJO con el alcance: esto expone los registros a cualquiera con la anon key,
-- igual que ya pasa con `ai_conversations`, `guests` e
-- `invitation_message_dispatches`. Si prefieres no ampliar esa superficie, la
-- alternativa es un endpoint en el backend detrás de `validarAdmin`, como se
-- hizo con `admin_gastos_fijos`. El panel funciona sin esto: la tarjeta de
-- costo se queda mostrando modelos y tokens.

alter table public.ai_agent_logs enable row level security;
alter table public.ai_daily_usage enable row level security;
alter table public.ai_pending_actions enable row level security;

drop policy if exists "lectura anon de ai_agent_logs" on public.ai_agent_logs;
create policy "lectura anon de ai_agent_logs"
    on public.ai_agent_logs for select to anon using (true);

drop policy if exists "lectura anon de ai_daily_usage" on public.ai_daily_usage;
create policy "lectura anon de ai_daily_usage"
    on public.ai_daily_usage for select to anon using (true);

drop policy if exists "lectura anon de ai_pending_actions" on public.ai_pending_actions;
create policy "lectura anon de ai_pending_actions"
    on public.ai_pending_actions for select to anon using (true);

-- Postgres revisa el GRANT antes que la policy, así que hace falta también.
grant select on public.ai_agent_logs to anon;
grant select on public.ai_daily_usage to anon;
grant select on public.ai_pending_actions to anon;

-- Comprobación: las tres deben devolver el mismo número que con service role.
--   select count(*) from public.ai_agent_logs;      -- esperado: 812
--   select count(*) from public.ai_daily_usage;     -- esperado: 205
--   select count(*) from public.ai_pending_actions; -- esperado: 69
