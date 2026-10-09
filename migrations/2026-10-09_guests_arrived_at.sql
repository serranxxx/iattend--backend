-- Lector de pases (/scanner en iattend-vite): hora de llegada de cada invitado.
-- Se llena al escanear el pase o al registrar a mano, y vuelve a NULL al quitar
-- el registro. Sirve para mostrar "llegó 20:41" y para el aviso de pase duplicado.
-- Los invitados que ya estaban en 'asistente' antes de esta columna quedan con NULL
-- (el lector los muestra como llegados, sin hora).

alter table public.guests
  add column if not exists arrived_at timestamptz;
