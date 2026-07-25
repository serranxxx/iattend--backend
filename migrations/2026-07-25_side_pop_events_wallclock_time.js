// Migra side_events.body.hour y pop_events...content.information.date del
// formato legado (instante UTC, ej. "2026-09-19T20:00:00.000Z") al nuevo
// formato de hora de pared absoluta (ej. "2026-09-19 13:00:00" + un campo
// `timezone` explícito). Ver iattend-events/src/helpers/functions.ts y
// iattend-vite/src/helpers/assets/eventDateTime.js para el porqué.
//
// DRY-RUN POR DEFAULT: solo imprime qué cambiaría, no escribe nada.
// Para aplicar los cambios de verdad:
//   node migrations/2026-07-25_side_pop_events_wallclock_time.js --apply
//
// Requiere las mismas env vars que el resto del backend (SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY vía .env).

require("dotenv").config();
const supabase = require("../config/supabase");

const APPLY = process.argv.includes("--apply");

// Mismo mapeo que en iattend-events / iattend-vite — mantenerlo en sync
// si se agregan más estados.
const STATE_TIMEZONES = {
  "baja california": "America/Tijuana",
  "baja california sur": "America/Mazatlan",
  "sonora": "America/Hermosillo",
  "sinaloa": "America/Mazatlan",
  "quintana roo": "America/Cancun",
};

function normalizeStateKey(state) {
  return state
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function getTimezoneForState(state) {
  if (!state) return "America/Mexico_City";
  return STATE_TIMEZONES[normalizeStateKey(state)] ?? "America/Mexico_City";
}

function isAbsoluteInstant(raw) {
  return typeof raw === "string" && /[Zz]$|[+-]\d{2}:?\d{2}$/.test(raw.trim());
}

// Convierte un instante UTC real a la hora de pared "YYYY-MM-DD HH:mm:00"
// en el timezone dado, usando Intl (mismo mecanismo que el display fix).
function toWallClockString(isoString, timeZone) {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");

  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}:00`;
}

async function migrateSideEvents(report) {
  const { data, error } = await supabase.from("side_events").select("id, body");
  if (error) throw error;

  for (const row of data) {
    const hour = row.body?.hour;
    if (!isAbsoluteInstant(hour)) continue;

    const state = row.body?.address?.state;
    const timezone = getTimezoneForState(state);
    const newHour = toWallClockString(hour, timezone);
    if (!newHour) {
      report.skipped.push({ table: "side_events", id: row.id, reason: `hour inválido: ${hour}` });
      continue;
    }

    report.changes.push({
      table: "side_events",
      id: row.id,
      state,
      timezone,
      before: hour,
      after: newHour,
    });

    if (APPLY) {
      const { error: updateError } = await supabase
        .from("side_events")
        .update({ body: { ...row.body, hour: newHour, timezone } })
        .eq("id", row.id);
      if (updateError) {
        report.errors.push({ table: "side_events", id: row.id, error: updateError.message });
      }
    }
  }
}

async function migratePopEvents(report) {
  const { data, error } = await supabase.from("pop_events").select("id, body");
  if (error) throw error;

  for (const row of data) {
    const info = row.body?.content?.information;
    const date = info?.date;
    if (!isAbsoluteInstant(date)) continue;

    const state = info?.address?.state;
    const timezone = getTimezoneForState(state);
    const newDate = toWallClockString(date, timezone);
    if (!newDate) {
      report.skipped.push({ table: "pop_events", id: row.id, reason: `date inválido: ${date}` });
      continue;
    }

    report.changes.push({
      table: "pop_events",
      id: row.id,
      state,
      timezone,
      before: date,
      after: newDate,
    });

    if (APPLY) {
      const newBody = {
        ...row.body,
        content: {
          ...row.body.content,
          information: { ...info, date: newDate, timezone },
        },
      };
      const { error: updateError } = await supabase
        .from("pop_events")
        .update({ body: newBody })
        .eq("id", row.id);
      if (updateError) {
        report.errors.push({ table: "pop_events", id: row.id, error: updateError.message });
      }
    }
  }
}

async function main() {
  const report = { changes: [], skipped: [], errors: [] };

  await migrateSideEvents(report);
  await migratePopEvents(report);

  console.log(APPLY ? "=== APLICANDO CAMBIOS ===" : "=== DRY RUN (nada se escribió) ===");
  console.table(report.changes);

  if (report.skipped.length) {
    console.log("\nFilas saltadas:");
    console.table(report.skipped);
  }

  if (report.errors.length) {
    console.log("\nErrores al escribir:");
    console.table(report.errors);
  }

  console.log(
    `\n${report.changes.length} fila(s) ${APPLY ? "actualizadas" : "por actualizar"}, ${report.skipped.length} saltada(s), ${report.errors.length} error(es).`
  );

  if (!APPLY && report.changes.length) {
    console.log("\nEsto fue un dry-run. Para aplicar de verdad: node migrations/2026-07-25_side_pop_events_wallclock_time.js --apply");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
