-- Catálogo de planes, segunda parte: lo que de verdad se ve en cada pantalla.
-- Correr en el SQL editor de Supabase DESPUÉS de 2026-09-25_create_plans_catalog.sql.
--
-- La primera versión sembró `features` con la lista del selector de planes de
-- la app ("Invitación Paperless", "Diseño libre"…), que no se parece a lo que
-- muestran la landing ni el checkout. Esta migración siembra el copy real de
-- esas dos pantallas:
--
--   · `description`  → el párrafo de la tarjeta en iattend-next /about/pricing.
--                      Acepta links con la forma [texto](/ruta), que se pintan
--                      en negritas subrayadas como hoy.
--   · `highlights`   → la sección "Y además incluye" de esa misma tarjeta:
--                      [{ "title": "...", "note": "..." }].
--   · `features`     → el checklist del checkout (/checkout de iattend-vite),
--                      ahora con `group`: "invitation" ("Tu invitación") o
--                      "event" ("Gestión del evento"). Es también la lista que
--                      usan el selector de planes y el alta de invitación.
--
-- En cualquier texto, {credits} y {side_events} se sustituyen con los números
-- del plan, y una línea cuyo número queda en 0 se oculta sola (así "{side_events}
-- Side event" desaparece del Lite cuando su tope pasa a 0).
--
-- `name` pasa de "PRO" a "Pro": es el nombre que se pinta en la landing
-- ("Pro", "Comprar Pro") y en el checkout ("Plan Pro").

alter table public.plans
  add column if not exists description text,
  add column if not exists highlights jsonb not null default '[]'::jsonb
    check (jsonb_typeof(highlights) = 'array');

update public.plans set
  name = 'Pro',
  description = 'Incluye una [invitación digital](/about/invitacion-digital) para que te olvides de impresiones y reimpresiones. Un [gestor de invitados](/about/guest-management) para alejarte del Excel de 200 filas: sabes en tiempo real quién confirmó y quién no, sin perseguir a nadie. Y el [acomodo de mesas](/about/mapa-de-mesas) para que el seating chart no te quite el sueño. Y un [Side Event](/about/side-events) para ese momento extra que no puede faltar.',
  highlights = '[
    {"title": "Envíos automáticos por WhatsApp", "note": "invita a todos en minutos, sin copiar y pegar, sin arriesgar tu número."},
    {"title": "2 Side Events adicionales", "note": "porque tu boda son muchos momentos — la cena, el brunch, el civil, todo desde el mismo lugar."},
    {"title": "Pases digitales + Apple Wallet", "note": "para que nadie busque listas impresas el día del evento ni haga filas en la entrada."}
  ]'::jsonb,
  features = '[
    {"group": "invitation", "icon": "invitation",  "es": "Portada de invitación", "en": "Invitation cover"},
    {"group": "invitation", "icon": "dresscode",   "es": "Dresscode",             "en": "Dress code"},
    {"group": "invitation", "icon": "itinerary",   "es": "Itinerario",            "en": "Itinerary"},
    {"group": "invitation", "icon": "gifts",       "es": "Mesa de regalos",       "en": "Gift registry"},
    {"group": "invitation", "icon": "gallery",     "es": "Galería de fotos",      "en": "Photo gallery"},
    {"group": "event",      "icon": "guests",      "es": "Lista de invitados",    "en": "Guest list"},
    {"group": "event",      "icon": "tables",      "es": "Acomodo de mesas",      "en": "Seating chart"},
    {"group": "event",      "icon": "side_events", "es": "{side_events} Side events", "en": "{side_events} Side events"},
    {"group": "event",      "icon": "photo_wall",  "es": "Photo Wall",            "en": "Photo Wall"},
    {"group": "event",      "icon": "whatsapp",    "es": "Envíos por WhatsApp · {credits} créditos", "en": "WhatsApp sends · {credits} credits"},
    {"group": "event",      "icon": "passes",      "es": "Pases en Apple Wallet", "en": "Apple Wallet passes"},
    {"group": "event",      "icon": "lia",         "es": "Lia · asistente IA",    "en": "Lia · AI assistant"}
  ]'::jsonb
where id = 'pro';

update public.plans set
  description = 'Incluye una [invitación digital](/about/invitacion-digital) para que te olvides de las impresiones y reimpresiones. Un [gestor de invitados](/about/guest-management) para alejarte del Excel de 200 filas — sabes quién confirmó sin perseguir a nadie. [Acomodo de mesas](/about/mapa-de-mesas) para organizar el seating chart sin dolores de cabeza. Y un [Side Event](/about/side-events) para ese momento extra que no puede faltar.',
  highlights = '[]'::jsonb,
  features = '[
    {"group": "invitation", "icon": "invitation",  "es": "Portada de invitación", "en": "Invitation cover"},
    {"group": "invitation", "icon": "dresscode",   "es": "Dresscode",             "en": "Dress code"},
    {"group": "invitation", "icon": "itinerary",   "es": "Itinerario",            "en": "Itinerary"},
    {"group": "invitation", "icon": "gifts",       "es": "Mesa de regalos",       "en": "Gift registry"},
    {"group": "invitation", "icon": "gallery",     "es": "Galería de fotos",      "en": "Photo gallery"},
    {"group": "event",      "icon": "guests",      "es": "Lista de invitados",    "en": "Guest list"},
    {"group": "event",      "icon": "tables",      "es": "Acomodo de mesas",      "en": "Seating chart"},
    {"group": "event",      "icon": "side_events", "es": "{side_events} Side event", "en": "{side_events} Side event"}
  ]'::jsonb
where id = 'lite';

-- Paperless no está en el checkout ni en la landing; solo en el alta de
-- invitación. Conserva su lista, ahora agrupada.
update public.plans set
  description = 'La invitación digital esencial, simple y sin límites.',
  features = '[
    {"group": "invitation", "icon": "invitation", "es": "Invitación Paperless", "en": "Paperless invitation"},
    {"group": "invitation", "icon": "design",     "es": "Diseño libre",         "en": "Free design"},
    {"group": "invitation", "icon": "edits",      "es": "Ediciones ilimitadas", "en": "Unlimited edits"},
    {"group": "event",      "icon": "public",     "es": "Evento público",       "en": "Public event"},
    {"group": "event",      "icon": "rsvp",       "es": "Confirmación manual",  "en": "Manual confirmation"}
  ]'::jsonb
where id = 'paperless';

update public.plans set
  features = '[
    {"group": "invitation", "icon": "invitation", "es": "Save the Date", "en": "Save the Date"}
  ]'::jsonb
where id = 'free';
