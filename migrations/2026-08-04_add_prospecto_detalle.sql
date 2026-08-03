-- Tablero de Prospectos (Instagram) — Fase 2: detalle de tarjeta
-- Run manually against Supabase (SQL editor or CLI) — no migration tool in this repo.

ALTER TABLE prospectos_ig
  ADD COLUMN email text,
  ADD COLUMN telefono text,
  ADD COLUMN post_contexto jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN nivel_interes smallint;

ALTER TABLE prospectos_ig
  ADD CONSTRAINT prospectos_ig_nivel_interes_check CHECK (nivel_interes IS NULL OR nivel_interes BETWEEN 1 AND 5);
