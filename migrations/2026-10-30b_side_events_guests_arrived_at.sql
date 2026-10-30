-- Lector de pases (/scanner?flash=<id> en iattend-vite): hora de llegada de cada
-- invitado de un evento Flash, igual que guests.arrived_at (2026-10-09). Se llena
-- al escanear el pase o al registrar a mano, y vuelve a NULL al quitar el registro.
-- Sin esta columna el lector funciona igual, solo sin horas (fallback por 42703).

alter table public.side_events_guests
  add column if not exists arrived_at timestamptz;
