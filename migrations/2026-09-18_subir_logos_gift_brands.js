// Sube los logos de marcas de mesa de regalos a Supabase Storage y llena
// gift_brands.logo_url.
//
// Hasta ahora los 12 logos vivían como PNG estáticos en
// iattend-events/public/assets/banks/ y la ruta se armaba a mano en el
// BRAND_META de classifyGiftCard.ts. Esto los mueve al bucket público
// `assets` (carpeta GiftBrands/), igual que las texturas, para que una marca
// creada desde /admin pueda traer su propio logo sin tocar el repo.
//
// Correr DESPUÉS de 2026-09-18_create_gift_brands.sql.
//
// DRY-RUN POR DEFAULT: solo imprime qué subiría, no escribe nada.
// Para aplicar de verdad:
//   node migrations/2026-09-18_subir_logos_gift_brands.js --apply
//
// Si iattend-events no está en la ruta hermana por default:
//   node migrations/2026-09-18_subir_logos_gift_brands.js --apply --origen=/ruta/a/banks

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const supabase = require("../config/supabase");

const APPLY = process.argv.includes("--apply");

const argOrigen = process.argv.find((a) => a.startsWith("--origen="));
const ORIGEN = argOrigen
  ? argOrigen.slice("--origen=".length)
  : path.resolve(__dirname, "../../iattend-events/public/assets/banks");

const BUCKET = "assets";
const CARPETA = "GiftBrands";

// archivo en /public  ->  slug en gift_brands
const LOGOS = {
  "AMAZON.png": "amazon",
  "LIVERPOOL.png": "liverpool",
  "PALACIO.png": "palacio de hierro",
  "SEARS.png": "sears",
  "BANAMEX.png": "banamex",
  "BANORTE.png": "banorte",
  "BBVA.png": "bbva",
  "crelan.png": "crelan",
  "HSBC.png": "hsbc",
  "NU.png": "nu",
  "SANTANDER.png": "santander",
  "SCOTIABANK.png": "scotiabank",
};

// El slug lleva espacios ('palacio de hierro'); el path en Storage no.
const rutaStorage = (slug) => `${CARPETA}/${slug.replace(/\s+/g, "-")}.png`;

(async () => {
  console.log(APPLY ? "== APLICANDO ==" : "== DRY RUN (usa --apply para escribir) ==");
  console.log("origen:", ORIGEN, "\n");

  if (!fs.existsSync(ORIGEN)) {
    console.error(`No existe la carpeta de origen: ${ORIGEN}`);
    console.error("Pasá la ruta con --origen=/ruta/a/banks");
    process.exit(1);
  }

  const { data: marcas, error: errorMarcas } = await supabase
    .from("gift_brands")
    .select("id, slug, name, logo_url");

  if (errorMarcas) {
    console.error("No se pudo leer gift_brands:", errorMarcas.message);
    console.error("¿Corriste 2026-09-18_create_gift_brands.sql primero?");
    process.exit(1);
  }

  const porSlug = new Map((marcas || []).map((m) => [m.slug, m]));
  let subidos = 0;
  let omitidos = 0;

  for (const [archivo, slug] of Object.entries(LOGOS)) {
    const origen = path.join(ORIGEN, archivo);
    const marca = porSlug.get(slug);

    if (!marca) {
      console.log(`  ~ ${archivo}: no hay marca con slug "${slug}" — omitido`);
      omitidos++;
      continue;
    }

    if (!fs.existsSync(origen)) {
      console.log(`  ~ ${archivo}: no existe en el origen — omitido`);
      omitidos++;
      continue;
    }

    const destino = rutaStorage(slug);
    const bytes = fs.statSync(origen).size;

    if (!APPLY) {
      console.log(`  → ${archivo} (${(bytes / 1024).toFixed(1)} KB) → ${BUCKET}/${destino}  [${marca.name}]`);
      subidos++;
      continue;
    }

    const { error: errorUpload } = await supabase.storage
      .from(BUCKET)
      .upload(destino, fs.readFileSync(origen), {
        upsert: true,
        contentType: "image/png",
      });

    if (errorUpload) {
      console.error(`  ✗ ${archivo}: ${errorUpload.message}`);
      omitidos++;
      continue;
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(destino);

    const { error: errorUpdate } = await supabase
      .from("gift_brands")
      .update({ logo_url: pub.publicUrl })
      .eq("id", marca.id);

    if (errorUpdate) {
      console.error(`  ✗ ${archivo}: subió pero no se pudo guardar logo_url — ${errorUpdate.message}`);
      omitidos++;
      continue;
    }

    console.log(`  ✓ ${marca.name} → ${pub.publicUrl}`);
    subidos++;
  }

  console.log(`\n${APPLY ? "subidos" : "a subir"}: ${subidos} | omitidos: ${omitidos}`);

  if (!APPLY) console.log("\nNada se escribió. Volvé a correr con --apply.");
})();
