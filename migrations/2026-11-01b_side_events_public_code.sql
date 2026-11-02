-- Links de side events / Pops difíciles de adivinar.
--
-- Antes el link público era iattend.events/side-event/<id> y con el número
-- se podía llegar a cualquier otro evento (87, 86…). Ahora cada evento tiene
-- un código al azar (`public_code`, 10 caracteres sin letras que se confunden)
-- y el link es iattend.events/side-event/<código>.
--
-- Para no romper los links que ya se mandaron, los eventos que existen hoy
-- siguen abriendo también con su número (`legacy_link_enabled = true`) hasta
-- que su organizador lo apague en "Imagen del link". Los nuevos nacen con
-- false: solo abren con su código.
--
-- Lo lee iattend-events/src/app/side-event/[side_event_id]/page.tsx; los
-- links se arman con helpers/invitation/sideEventLink.js (vite),
-- helpers/popEvent.js y services/wallet/datosPase.js (backend).

create extension if not exists pgcrypto with schema extensions;

-- 10 caracteres de un alfabeto de 32 (sin 0, 1, l, o): 32^10 ≈ 10^15.
create or replace function public.gen_public_code(len int default 10)
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
    abc constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
    b bytea := extensions.gen_random_bytes(len);
    r text := '';
    i int;
begin
    for i in 0..len - 1 loop
        r := r || substr(abc, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    return r;
end;
$$;

alter table public.side_events add column if not exists public_code text;
alter table public.side_events add column if not exists legacy_link_enabled boolean not null default false;

-- Los que ya existen (todavía sin código): su link viejo queda abierto y
-- reciben su código. Volver a correr esto no reabre los que ya se apagaron.
update public.side_events set legacy_link_enabled = true where public_code is null;
update public.side_events set public_code = public.gen_public_code() where public_code is null;

alter table public.side_events alter column public_code set default public.gen_public_code();
alter table public.side_events alter column public_code set not null;
create unique index if not exists side_events_public_code_key on public.side_events (public_code);
