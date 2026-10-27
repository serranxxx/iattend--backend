-- Recordatorios: nueva versión de `aviso_cambio_cuenta_bancaria` en Meta —
-- variables en negritas y pie "I attend · Your event, handled".
-- Correr en el SQL editor de Supabase (después de 2026-10-27c).

update public.reminder_templates
set body = E'Hola *{{1}}*, te informamos un cambio en la invitación de *{{2}}*.\n\nLa cuenta bancaria publicada anteriormente fue cancelada. Si realizaste una transferencia a esa cuenta, es posible que haya sido rechazada y el monto devuelto a tu cuenta.\n\nLos datos de la nueva cuenta ya están actualizados en la invitación.',
    footer = 'I attend · Your event, handled'
where slug = 'cambio-cuenta-bancaria';
