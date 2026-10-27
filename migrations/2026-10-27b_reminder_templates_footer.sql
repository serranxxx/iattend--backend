-- Recordatorios: pie del mensaje, imagen de encabezado, texto real de la
-- plantilla `reminder` y alta de `event_day_reminder`.
-- Correr en el SQL editor de Supabase (después de 2026-10-27_create_reminder_templates.sql).
--
-- `footer` es el pie gris de la plantilla de Meta ("I attend - Your event,
-- handled."). Como `body`, solo sirve para la vista previa.
-- Todos los botones llevan al magic link del invitado:
-- https://www.iattend.events/{label}/{name}?password={password}
-- (button_url con {{1}} = invitation_path).

alter table public.reminder_templates
  add column if not exists footer text,
  -- Encabezado de imagen (opcional): fuente de la URL. Hoy solo 'link_image'
  -- = invitations.url_image (la imagen del link) o, si no hay, la portada.
  add column if not exists header_image_variable text;

update public.reminder_templates
set body = E'Hola {{1}}, te recordamos que tu invitación a {{2}} sigue esperando tu confirmación.\n\nLa fecha límite para confirmar es el {{3}}.\n\nPuedes confirmar desde el enlace en el botón de abajo.',
    body_variables = array['guest_name', 'event_title', 'rsvp_deadline'],
    footer = 'I attend - Your event, handled.',
    button_label = 'Confirmar',
    button_url = 'https://www.iattend.events/{{1}}',
    button_variable = 'invitation_path'
where slug = 'confirma-asistencia';

update public.reminder_templates
set footer = 'I attend - Your event, handled.',
    button_url = 'https://www.iattend.events/{{1}}',
    button_variable = 'invitation_path'
where slug = 'cambio-cuenta-bancaria';

insert into public.reminder_templates
  (slug, meta_name, language_code, name, description, body, body_variables, footer,
   header_image_variable, button_label, button_url, button_variable, suggestion, sort_order, is_active)
values
  ('dia-del-evento', 'event_day_reminder', 'es_MX',
   'Hoy es el día',
   'El día del evento, para que tengan su invitación a la mano.',
   E'Hoy es el día del evento {{1}}.\n\nTen siempre tu invitación a la mano.',
   array['event_title'],
   'I attend · Your event, handled.',
   'link_image',
   'Ver invitación', 'https://www.iattend.events/{{1}}', 'invitation_path',
   '{"segment":"confirmados","rules":[],"comb":"and","title":"Confirmados","reason":"Son quienes van a llegar hoy y necesitan su pase a la mano."}'::jsonb,
   2, true)
on conflict (slug) do nothing;

-- El ejemplo de cuenta bancaria pasa al final del banco.
update public.reminder_templates set sort_order = 3 where slug = 'cambio-cuenta-bancaria';
