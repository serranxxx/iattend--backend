// Roles con las funciones de un wedding planner: el planner y, con
// exactamente las mismas, Administración (alta de eventos de clientes,
// beneficios, Eventos Flash, quedar asignado como planner de un evento…).
// La base aplica la misma lista en el trigger invitations_check_planner
// (migrations/2026-10-10e_admin_como_planner.sql).
const ROLES_PLANNER = ['planner', 'Administration'];

const tieneFuncionesDePlanner = (role) => ROLES_PLANNER.includes(role);

module.exports = { ROLES_PLANNER, tieneFuncionesDePlanner };
