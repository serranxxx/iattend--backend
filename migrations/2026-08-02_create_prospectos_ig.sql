-- Tablero de Prospectos (Instagram) — Fase 1
-- Run manually against Supabase (SQL editor or CLI) — no migration tool in this repo.

CREATE TYPE prospecto_estado AS ENUM (
  'sin_asignar',
  'asignado',
  'mensaje_enviado',
  'en_conversacion',
  'finalizado',
  'volver_a_contactar'
);

CREATE TABLE prospectos_ig (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instagram_username text NOT NULL,
  instagram_url text NOT NULL,
  estado prospecto_estado NOT NULL DEFAULT 'sin_asignar',
  vendedor_id uuid REFERENCES vendedores(id),
  notas text,
  motivo_finalizado text,
  asignado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospectos_ig_instagram_username_key UNIQUE (instagram_username)
);

CREATE INDEX prospectos_ig_vendedor_estado_idx ON prospectos_ig (vendedor_id, estado);
