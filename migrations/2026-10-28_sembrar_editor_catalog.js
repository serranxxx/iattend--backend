// Siembra editor_assets con lo que hoy usa el panel lateral del editor.
//
// Correr DESPUÉS de 2026-10-28_create_editor_catalog.sql.
//
// No mueve ni borra ningún archivo y no toca ninguna invitación:
//   - Íconos: los 16 de LAYER_ICONS (lucide) se convierten a SVG y se SUBEN
//     al bucket nuevo `editor-assets` (iconos/<Nombre>.svg). Las invitaciones
//     que ya tienen { kind: 'icon', icon: 'Heart' } siguen pintándose con el
//     componente de lucide; el SVG es solo para lo que se suelte de aquí en
//     adelante.
//   - Ilustraciones: apuntan a las rutas que ya existen
//     (/assets/itinerary/*.png, servidas por iattend-vite e iattend-events).
//   - Fotos (Portada, Cita, Dresscode): apuntan a las URLs públicas que ya
//     existen en el bucket `assets` (Covers/, Quote/, Dresscode/). Dresscode
//     se parte en Black Tie / Cocktail / Formal por el prefijo del archivo,
//     como hacía getDresscodesFromSupabase.
// Solo agrega lo que falte (por URL), así que se puede correr dos veces.
//
// DRY-RUN POR DEFAULT: solo imprime qué haría.
// Para aplicar de verdad:
//   node migrations/2026-10-28_sembrar_editor_catalog.js --apply
//
// Los SVG se arman con lucide-react de iattend-vite (ruta hermana). Si está
// en otro lado:
//   node migrations/2026-10-28_sembrar_editor_catalog.js --apply --vite=/ruta/a/iattend-vite

require("dotenv").config();
const path = require("path");
const supabase = require("../config/supabase");

const APPLY = process.argv.includes("--apply");
const argVite = process.argv.find((a) => a.startsWith("--vite="));
const VITE = argVite ? argVite.slice("--vite=".length) : path.resolve(__dirname, "../../iattend-vite");

const BUCKET = "editor-assets";

// Mismo orden que LAYER_ICONS (layerItems.js / SectionLayer.tsx), con tags
// para el buscador.
const ICONOS = [
  ["Heart", "corazón, amor"], ["Sparkles", "brillos, destellos"], ["Star", "estrella"],
  ["Flower", "flor"], ["Flower2", "flor"], ["Leaf", "hoja, planta"], ["Gem", "anillo, diamante, joya"],
  ["Moon", "luna, noche"], ["Sun", "sol, día"], ["Wine", "copa, vino, brindis"], ["Music", "música, canción"],
  ["Camera", "cámara, foto"], ["Church", "iglesia, ceremonia"], ["Infinity", "infinito"],
  ["Bird", "pájaro, ave"], ["Cake", "pastel, fiesta"],
];

const ILUSTRACIONES = [
  ["ball", "Disco", "disco, bola, fiesta"], ["couple", "Pareja", "pareja, novios, auto"],
  ["dance", "Baile", "baile, invitados"], ["dinner", "Cena", "cena, comida, plato"],
  ["drink", "Brindis", "copa, brindis, bebida"], ["tree", "Árbol", "árbol, jardín"],
];

// Lucide → SVG plano de un solo color (currentColor → negro: la pieza lo
// pinta con mask-image, así que solo importa la forma).
const svgDe = (nombre) => {
  const req = (m) => require(path.join(VITE, "node_modules", m));
  const React = req("react");
  const { renderToStaticMarkup } = req("react-dom/server");
  const lucide = req("lucide-react");
  const Icono = lucide[nombre] ?? lucide[`${nombre}Icon`];
  if (!Icono) throw new Error(`lucide-react no tiene ${nombre}`);
  const svg = renderToStaticMarkup(React.createElement(Icono, { size: 24, color: "#000000", strokeWidth: 1.6 }))
    .replace(/ class="[^"]*"/, "");
  return svg.includes("xmlns=") ? svg : svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
};

const categoria = async (panel, slug, extra) => {
  const { data } = await supabase.from("editor_categories").select("id").eq("panel", panel).eq("slug", slug).maybeSingle();
  if (data) return data.id;
  console.log(`  + categoría ${panel}/${slug}`);
  if (!APPLY) return `(nueva ${slug})`;
  const { data: nueva, error } = await supabase.from("editor_categories").insert({ panel, slug, ...extra }).select("id").single();
  if (error) throw error;
  return nueva.id;
};

const urlsExistentes = async (categoryId) => {
  if (String(categoryId).startsWith("(")) return new Set();
  const { data } = await supabase.from("editor_assets").select("url").eq("category_id", categoryId);
  return new Set((data ?? []).map((r) => r.url));
};

const agregar = async (categoryId, filas) => {
  const ya = await urlsExistentes(categoryId);
  const nuevas = filas.filter((f) => !ya.has(f.url));
  console.log(`    ${nuevas.length} nuevos (${filas.length - nuevas.length} ya estaban)`);
  if (!APPLY || !nuevas.length) return;
  const { error } = await supabase.from("editor_assets").insert(nuevas.map((f) => ({ category_id: categoryId, ...f })));
  if (error) throw error;
};

const listar = async (carpeta) => {
  const { data, error } = await supabase.storage.from("assets").list(carpeta, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (error) throw error;
  return (data ?? []).filter((f) => f.name && !f.name.startsWith("."));
};
const urlAssets = (ruta) => supabase.storage.from("assets").getPublicUrl(ruta).data.publicUrl;

(async () => {
  console.log(APPLY ? "APLICANDO" : "DRY-RUN (agrega --apply para escribir)");

  // ── Íconos ──
  console.log("Íconos");
  const iconos = await categoria("elements", "iconos", { name_es: "Íconos", name_en: "Icons", kind: "icon", sort_order: 1 });
  const filasIconos = [];
  for (const [i, [nombre, tags]] of ICONOS.entries()) {
    const ruta = `iconos/${nombre}.svg`;
    const url = supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;
    if (APPLY) {
      const { error } = await supabase.storage.from(BUCKET)
        .upload(ruta, Buffer.from(svgDe(nombre)), { contentType: "image/svg+xml", upsert: true });
      if (error) throw error;
    } else {
      svgDe(nombre); // que truene en dry-run si falta alguno
    }
    filasIconos.push({ name: nombre, tags: tags.split(", "), url, tintable: true, default_w: 14, aspect: 1, sort_order: i + 1 });
  }
  await agregar(iconos, filasIconos);

  // ── Ilustraciones ──
  console.log("Ilustraciones");
  const ilus = await categoria("elements", "ilustraciones", { name_es: "Ilustraciones", name_en: "Illustrations", kind: "image", sort_order: 3 });
  await agregar(ilus, ILUSTRACIONES.map(([archivo, nombre, tags], i) => ({
    name: nombre, tags: tags.split(", "), url: `/assets/itinerary/${archivo}.png`, default_w: 26, aspect: 1, sort_order: i + 1,
  })));

  // ── Fotos: Portada y Cita ──
  for (const [slug, carpeta, name_es, name_en, section_key, orden] of [
    ["portada", "Covers", "Portada", "Cover", "cover", 1],
    ["cita", "Quote", "Cita", "Quote", "quote", 2],
  ]) {
    console.log(`Fotos · ${name_es}`);
    const id = await categoria("photos", slug, { name_es, name_en, kind: "image", section_key, sort_order: orden });
    const archivos = await listar(carpeta);
    await agregar(id, archivos.map((f, i) => ({ name: f.name.replace(/\.[^.]+$/, ""), url: urlAssets(`${carpeta}/${f.name}`), aspect: 1.33, sort_order: i + 1 })));
  }

  // ── Fotos: Dresscode, partido por prefijo ──
  console.log("Fotos · Dresscode");
  const dress = await categoria("photos", "dresscode", { name_es: "Dresscode", name_en: "Dress code", kind: "image", section_key: "dresscode", sort_order: 3 });
  const archivosDress = await listar("Dresscode");
  for (const [prefijo, slug, name_es, name_en, orden] of [
    ["black_tie", "dresscode-black-tie", "Black Tie", "Black Tie", 1],
    ["cocktail", "dresscode-cocktail", "Cocktail", "Cocktail", 2],
    ["formal", "dresscode-formal", "Formal", "Formal", 3],
  ]) {
    console.log(`  · ${name_es}`);
    const id = await categoria("photos", slug, { name_es, name_en, kind: "image", section_key: "dresscode", parent_id: String(dress).startsWith("(") ? null : dress, sort_order: orden });
    const archivos = archivosDress.filter((f) => f.name.startsWith(prefijo));
    await agregar(id, archivos.map((f, i) => ({ name: f.name.replace(/\.[^.]+$/, ""), url: urlAssets(`Dresscode/${f.name}`), aspect: 1.33, sort_order: i + 1 })));
  }

  console.log("Listo.");
})().catch((e) => { console.error(e); process.exit(1); });
