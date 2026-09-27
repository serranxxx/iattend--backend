-- Slides del onboarding wizard ("Conoce I attend": /checkout, /invitations,
-- /preview de iattend-vite).
-- Correr en el SQL editor de Supabase (o psql con service role).
--
-- Reemplaza los textos que vivían en iattend-vite
-- src/pages/PreviewMood/OnboardingWizard.jsx. Cada fila es un slide; `kind`
-- elige la demo interactiva que se pinta a la izquierda (la editora de la
-- invitación, la tabla de invitados, el seating chart…). `image` es un slide
-- sin demo: solo una imagen, para escenarios futuros sin tocar código.
--
-- Lectura: anon, solo los activos (el wizard la lee directo con la anon key,
-- como `gift_brands`). Escritura: solo service role, detrás de validarAdmin en
-- /api/admin/onboarding-slides.

create table if not exists public.onboarding_slides (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in (
                       'invitation', 'save_the_date', 'guests', 'rsvp', 'passes',
                       'seating', 'side_events', 'photo_wall', 'lia', 'image'
                     )),
  eyebrow            text,
  title              text not null,
  subtitle           text,
  description        text,
  -- Versión corta para celular; si está vacía se usa `description`.
  description_mobile text,
  -- Texto del botón de la demo, en los slides que tienen uno (confirmar un
  -- invitado, agregar una mesa…). Vacío = sin botón.
  cta_label          text,
  -- Plan del catálogo (`plans.id`) al que es exclusivo: pinta el badge
  -- "Exclusivo en PRO". Null = sin badge.
  exclusive_plan     text references public.plans(id) on update cascade on delete set null,
  -- Solo para kind = 'image'.
  image_url          text,
  sort_order         smallint not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid
);

create index if not exists onboarding_slides_activos_idx
  on public.onboarding_slides (sort_order)
  where is_active;

create or replace function public.set_onboarding_slides_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_onboarding_slides_updated_at on public.onboarding_slides;
create trigger trg_onboarding_slides_updated_at
  before update on public.onboarding_slides
  for each row
  execute function public.set_onboarding_slides_updated_at();

alter table public.onboarding_slides enable row level security;

drop policy if exists onboarding_slides_lectura_publica on public.onboarding_slides;
create policy onboarding_slides_lectura_publica
  on public.onboarding_slides
  for select
  to anon, authenticated
  using (is_active);

-- Postgres revisa el GRANT antes que las policies (ver invitation_versions).
grant select on public.onboarding_slides to anon, authenticated;

-- ------------------------------------------------------------------ semilla ---
-- Los mismos textos que tenía el wizard, con acentos corregidos, más Save the
-- Date y Photo Wall. Solo se siembra si la tabla está vacía.

insert into public.onboarding_slides
  (kind, sort_order, eyebrow, title, subtitle, description, description_mobile, cta_label, exclusive_plan)
select * from (values
  ('invitation', 1, 'Empecemos', 'Conoce I attend', null,
   'Dale vida a tu invitación en segundos. Cambia fotos, colores y textos, y observa la magia suceder aquí mismo —sin saber de diseño.',
   null, null, null),

  ('save_the_date', 2, 'Antes que nada', 'Save the Date', 'que aparten la fecha desde el día uno.',
   'Avisa a tus invitados meses antes, aunque todavía no tengas todos los detalles. Lo reciben en su celular, lo guardan en su calendario y te dejan su reacción.',
   'Avisa a tus invitados meses antes y deja que te respondan con una reacción.',
   'Reaccionar', null),

  ('guests', 3, 'Sin hojas de cálculo', 'Crea tu lista de invitados', 'y envía la invitación en automático.',
   'Olvídate de las hojas de Excel y de escribir mensajes uno por uno. Organiza a tus invitados aquí y envía su invitación con un solo clic —por WhatsApp, sin arriesgar tu número personal.',
   null, null, null),

  ('rsvp', 4, 'En tiempo real', 'Mira las confirmaciones llegar', 'sin preguntarle a nadie.',
   'Cada invitado confirma desde su invitación —tú solo ves los números moverse. Confirmados, pendientes y cancelados, siempre al día, sin revisar la plataforma a cada rato.',
   'Cada invitado confirma desde su invitación —tú solo ves los números moverse, sin revisar la plataforma a cada rato.',
   'Confirmar un invitado', null),

  ('passes', 5, 'Sin boletos físicos', 'Un pase digital para cada invitado', 'para que nada falle el día del evento.',
   'Olvídate de las listas impresas en la entrada. Cada invitado lleva su pase con código QR directo desde su celular —compatible con Apple Wallet, y siempre actualizado si algo cambia.',
   null, null, 'pro'),

  ('seating', 6, 'Arrastra y acomoda', 'Que el seating chart no te quite el sueño', 'acomoda mesas y sillas como quieras.',
   'Diseña el plano de tu salón, agrega mesas de cualquier forma y asigna a cada invitado con solo arrastrarlo. Ve en tiempo real cuántos lugares tienes ocupados y cuántos te faltan por llenar.',
   'Diseña el plano de tu salón y asigna a cada invitado con solo arrastrarlo.',
   'Agregar una mesa', null),

  ('side_events', 7, 'Más que un solo día', 'Conoce los side events', 'despedida, tornaboda, brunch —cada uno con su propia invitación.',
   'Crea una invitación distinta para cada evento alrededor de tu boda, con su propio dress code, ubicación y confirmación. Tus invitados solo ven los eventos a los que fueron invitados.',
   'Crea una invitación distinta para cada evento alrededor de tu boda, con su propio dress code y confirmación.',
   null, 'pro'),

  ('photo_wall', 8, 'Todos los ángulos', 'Photo Wall', 'las fotos de tus invitados, en vivo.',
   'Tus invitados suben sus fotos desde el celular y aparecen al instante en un muro compartido. Todos los momentos de la fiesta en un solo lugar, sin perseguir a nadie en el chat del grupo.',
   'Tus invitados suben sus fotos y aparecen al instante en un muro compartido.',
   'Subir una foto', 'pro'),

  ('lia', 9, 'Tu copiloto de boda', 'Conoce a Lia', 'tu asistente con el contexto completo de tu evento.',
   'Pregúntale lo que quieras —dress code, horarios, confirmaciones, logística— y responde al instante con la información real de tu invitación. Siempre disponible, sin buscar entre pestañas.',
   'Pregúntale lo que quieras —dress code, horarios, logística— y responde al instante con la información real de tu invitación.',
   null, 'pro')
) as semilla
where not exists (select 1 from public.onboarding_slides);

-- ------------------------------------------------------------------- config ---
-- Datos propios de cada demo, editables en Admin → Onboarding:
--   invitation    → { "invitation_id": uuid }   invitación demo que se pinta
--   save_the_date → { "url": "https://…" }        Save the Date real (iframe)
--   photo_wall    → { "photos": ["https://…"] }   fotos del muro (masonry)
alter table public.onboarding_slides
  add column if not exists config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object');

update public.onboarding_slides
set config = '{"invitation_id": "3cb0ab8b-41cb-428d-b383-ff9d5bbae17d"}'::jsonb
where kind = 'invitation' and config = '{}'::jsonb;

update public.onboarding_slides
set config = '{"url": "https://www.iattend.events/save-the-date/07147a8b-aee8-4de4-9270-cfe2255e8899"}'::jsonb,
    -- El Save the Date real trae sus propias reacciones: la demo ya no lleva botón.
    cta_label = null
where kind = 'save_the_date' and config = '{}'::jsonb;

update public.onboarding_slides
set config = jsonb_build_object('photos', jsonb_build_array(
  'https://jblcqcxckefmydvtrxbi.supabase.co/storage/v1/object/public/landing/wall-1.jpg',
  'https://jblcqcxckefmydvtrxbi.supabase.co/storage/v1/object/public/assets/Covers/cover_1.jpg',
  'https://jblcqcxckefmydvtrxbi.supabase.co/storage/v1/object/public/landing/dinner.jpg',
  'https://jblcqcxckefmydvtrxbi.supabase.co/storage/v1/object/public/landing/wall-2.jpg',
  'https://jblcqcxckefmydvtrxbi.supabase.co/storage/v1/object/public/assets/Covers/cover_3.jpg',
  'https://jblcqcxckefmydvtrxbi.supabase.co/storage/v1/object/public/assets/Covers/cover_10.jpg',
  'https://jblcqcxckefmydvtrxbi.supabase.co/storage/v1/object/public/assets/Covers/cover_2.jpg',
  'https://jblcqcxckefmydvtrxbi.supabase.co/storage/v1/object/public/assets/Covers/cover_9.jpg',
  'https://jblcqcxckefmydvtrxbi.supabase.co/storage/v1/object/public/assets/Covers/cover_8.jpg'
))
where kind = 'photo_wall' and config = '{}'::jsonb;

-- El seating chart se acomoda solo: ya no lleva botón "Agregar una mesa".
update public.onboarding_slides set cta_label = null where kind = 'seating';
