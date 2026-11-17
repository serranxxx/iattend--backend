-- Asiento de cada invitado dentro de su mesa (acomodo de mesas de iattend-vite,
-- modules/GuestManagement/Tables/asientos.js). 1…tables.size; null = sin
-- número (los que ya estaban sentados se acomodan en los libres al mostrarlos).
-- No hay índice único (mesa, asiento): intercambiar dos invitados son dos
-- updates y el front ya resuelve los choques.
alter table public.guests
    add column if not exists seat smallint;

alter table public.guests
    drop constraint if exists guests_seat_positivo;
alter table public.guests
    add constraint guests_seat_positivo check (seat is null or seat >= 1);

notify pgrst, 'reload schema';
