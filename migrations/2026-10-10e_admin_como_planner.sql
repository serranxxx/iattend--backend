-- Administración tiene exactamente las mismas funciones que un planner:
-- puede quedar como planner_id de una invitación (alta de eventos de
-- clientes, Eventos Flash, plantilla de prueba). El trigger solo aceptaba
-- role = 'planner'. Misma lista que iattend--backend/helpers/roles.js.
-- can_manage_invitation no cambia: Administración ya gestiona cualquier evento.

CREATE OR REPLACE FUNCTION public.check_invitation_planner()
RETURNS trigger AS $$
BEGIN
  IF NEW.planner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = NEW.planner_id AND role IN ('planner', 'Administration')
  ) THEN
    RAISE EXCEPTION 'user % is not a planner', NEW.planner_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;
