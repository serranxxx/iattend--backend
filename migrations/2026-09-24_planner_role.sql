-- Rol "planner": un usuario que administra varios eventos ajenos.
--
-- Cada evento sigue teniendo su dueño en invitations.user_id (la cuenta de
-- los novios, con su propio correo y contraseña). planner_id es un segundo
-- vínculo, opcional: el planner puede ver y editar el evento igual que el
-- dueño, sin quitarle nada al dueño. Un planner puede tener N eventos; un
-- evento tiene como máximo un planner.
--
-- Hoy profiles.role es texto libre sin constraint (valores reales: NULL,
-- 'Administration', 'sales', 'test'), así que 'planner' no necesita alterar
-- ningún tipo — solo empezar a usarse.

-- 1. Columna planner_id --------------------------------------------------
-- ON DELETE SET NULL: si se borra el perfil del planner, el evento queda
-- solo con su dueño en vez de desaparecer.
ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS planner_id uuid
  REFERENCES public.profiles(user_id) ON DELETE SET NULL;

-- Parcial: la gran mayoría de eventos no tendrá planner.
CREATE INDEX IF NOT EXISTS invitations_planner_id_idx
  ON public.invitations (planner_id)
  WHERE planner_id IS NOT NULL;

-- 2. Solo perfiles con role = 'planner' pueden asignarse ------------------
-- Una FK no puede filtrar por rol, por eso el trigger. Solo se valida al
-- asignar/cambiar: si después se le quita el rol a alguien, sus eventos no
-- se tocan, pero can_manage_invitation() deja de darle acceso.
CREATE OR REPLACE FUNCTION public.check_invitation_planner()
RETURNS trigger AS $$
BEGIN
  IF NEW.planner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = NEW.planner_id AND role = 'planner'
  ) THEN
    RAISE EXCEPTION 'user % is not a planner', NEW.planner_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS invitations_check_planner ON public.invitations;
CREATE TRIGGER invitations_check_planner
  BEFORE INSERT OR UPDATE OF planner_id ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.check_invitation_planner();

-- 3. Una sola regla de "quién puede gestionar este evento" -----------------
-- Dueño, planner asignado (con el rol vigente y activo) o Administration.
-- Las RPCs que hoy comparan user_id = auth.uid() pasan a usar esta función.
CREATE OR REPLACE FUNCTION public.can_manage_invitation(p_invitation_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.invitations i
    WHERE i.id = p_invitation_id
      AND (
        i.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.user_id = auth.uid()
            AND COALESCE(p.active, true)
            AND (
              p.role = 'Administration'
              OR (p.role = 'planner' AND i.planner_id = p.user_id)
            )
        )
      )
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.can_manage_invitation(uuid) TO anon, authenticated;

-- 4. RPCs de versiones: hoy solo dejan pasar al dueño ----------------------
-- Mismo cuerpo que 2026-08-06_create_invitation_versions.sql; solo cambia
-- el chequeo de permiso. Sin esto el planner no podría publicar.
CREATE OR REPLACE FUNCTION publish_invitation(
  p_invitation_id uuid,
  p_data jsonb
)
RETURNS invitation_versions AS $$
DECLARE
  v_version invitation_versions;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.can_manage_invitation(p_invitation_id) THEN
    RAISE EXCEPTION 'not authorized to publish invitation %', p_invitation_id;
  END IF;

  UPDATE invitations
  SET data = p_data, updated_at = now()
  WHERE id = p_invitation_id;

  INSERT INTO invitation_versions (invitation_id, data)
  VALUES (p_invitation_id, p_data)
  RETURNING * INTO v_version;

  RETURN v_version;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION get_invitation_versions(
  p_invitation_id uuid,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  invitation_id uuid,
  data jsonb,
  created_at timestamptz,
  total_count bigint
) AS $$
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.can_manage_invitation(p_invitation_id) THEN
    RAISE EXCEPTION 'not authorized to read versions of invitation %', p_invitation_id;
  END IF;

  RETURN QUERY
  SELECT v.id, v.invitation_id, v.data, v.created_at,
         COUNT(*) OVER() AS total_count
  FROM invitation_versions v
  WHERE v.invitation_id = p_invitation_id
  ORDER BY v.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 5. Uso (manual, no forma parte de la migración) --------------------------
-- Dar el rol:
--   UPDATE public.profiles SET role = 'planner' WHERE user_email = 'planner@ejemplo.com';
-- Asignarle eventos:
--   UPDATE public.invitations SET planner_id = '<user_id del planner>'
--   WHERE id IN ('<invitation_id_1>', '<invitation_id_2>');
-- Eventos que ve un planner (lo que haría InvitationsPage):
--   SELECT * FROM public.invitations
--   WHERE user_id = '<uid>' OR planner_id = '<uid>';
