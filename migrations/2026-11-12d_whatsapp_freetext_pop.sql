-- Buzón de WhatsApp de un Pop (side event sin invitación): lo que el
-- organizador contesta desde el buzón del Pop queda ligado a su side event.
-- whatsapp_freetext_dispatches solo tenía invitation_id.
-- Backend: controllers/whatsapp.js (sendWhatsappFreeText) y
-- controllers/conversacionesPop.js. Sin esta migración el buzón del Pop
-- enseña las respuestas, pero contestar desde ahí falla al guardar.

alter table public.whatsapp_freetext_dispatches
  add column if not exists side_event_id bigint references public.side_events(id) on delete set null;

alter table public.whatsapp_freetext_dispatches alter column invitation_id drop not null;

create index if not exists whatsapp_freetext_dispatches_side_event_idx
  on public.whatsapp_freetext_dispatches (side_event_id)
  where side_event_id is not null;

notify pgrst, 'reload schema';
