-- Giro libre de cada mesa en el acomodo (iattend-vite, modules/GuestManagement/
-- Tables/): grados (-180…180) que se suman a `vertical` (90° de la
-- rectangular). 0 = como siempre.
alter table public.tables
    add column if not exists rotation smallint not null default 0;

alter table public.tables
    drop constraint if exists tables_rotation_rango;
alter table public.tables
    add constraint tables_rotation_rango check (rotation between -180 and 180);

notify pgrst, 'reload schema';
