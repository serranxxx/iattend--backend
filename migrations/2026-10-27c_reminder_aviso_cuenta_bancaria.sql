-- Recordatorios: `aviso_cambio_cuenta_bancaria` aprobado en Meta, y los
-- cuerpos guardados con el formato de WhatsApp (*negritas*) tal como están en
-- Meta, que es lo que pinta la vista previa.
-- Correr en el SQL editor de Supabase (después de 2026-10-27b).

update public.reminder_templates
set meta_name = 'aviso_cambio_cuenta_bancaria',
    body = E'Hola {{1}}, te informamos un cambio en la invitación de {{2}}.\n\nLa cuenta bancaria publicada anteriormente fue cancelada. Si realizaste una transferencia a esa cuenta, es posible que haya sido rechazada y el monto devuelto a tu cuenta.\n\nLos datos de la nueva cuenta ya están actualizados en la invitación.',
    body_variables = array['guest_name', 'event_title'],
    footer = null,
    button_label = 'Ver invitación',
    button_url = 'https://www.iattend.events/{{1}}',
    button_variable = 'invitation_path',
    sort_order = 3,
    is_active = true
where slug = 'cambio-cuenta-bancaria';

update public.reminder_templates
set body = E'Hola *{{1}}*, te recordamos que tu invitación a *{{2}}* sigue esperando tu confirmación.\n\nLa fecha límite para confirmar es el *{{3}}*.\n\nPuedes confirmar desde el enlace en el botón de abajo.'
where slug = 'confirma-asistencia';

update public.reminder_templates
set body = E'Hoy es el día del evento *{{1}}*.\n\nTen siempre tu invitación a la mano.'
where slug = 'dia-del-evento';
