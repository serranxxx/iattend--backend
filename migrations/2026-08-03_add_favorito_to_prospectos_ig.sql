-- Tablero de Prospectos (Instagram) — favoritos
-- Run manually against Supabase (SQL editor or CLI) — no migration tool in this repo.

ALTER TABLE prospectos_ig ADD COLUMN favorito boolean NOT NULL DEFAULT false;
