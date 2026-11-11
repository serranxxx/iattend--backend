-- Espacio de "Subidos" de los Pops: la base sube de 5 a 10 MB.
-- Correr en el SQL editor de Supabase (o psql con service role).
--
-- Antes (2026-11-01_storage_pops.sql): base 5 MB · 15 MB · 30 MB.
-- Ahora: base 10 MB · 20 MB (+10 MB, 50 créditos) · 30 MB (+20 MB desde 10,
-- 100 créditos). El precio por MB no cambia (5 créditos del Pop); los niveles
-- y el costo los decide el backend (router/storage.route.js, POP_STORAGE).

-- Los Pops nuevos nacen con 10 MB.
alter table public.side_events
  alter column storage_limit_mb set default 10;

-- Los que ya existen con menos de 10 MB (la base vieja) suben a 10. Los que
-- ya compraron 15 o 30 MB se quedan como están (desde 15 pueden subir a 20 o 30).
update public.side_events
  set storage_limit_mb = 10
  where storage_limit_mb < 10;
