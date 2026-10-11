-- Invitaciones de planner "para enviar después": el planner crea el evento sin
-- cliente todavía (user_id y user_email vacíos, planner_id = él), la arma y
-- cuando quiere se la manda a su cliente; en ese momento se crea la cuenta del
-- cliente y su user_id se pone en la invitación (controllers/planner.js →
-- asignarCliente). Hasta hoy user_id era obligatorio.
--
-- Correr ANTES de desplegar el backend con el alta "enviar después".

alter table public.invitations
  alter column user_id drop not null;
