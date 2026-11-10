// ── Stripe price IDs ─────────────────────────────────────────────────────────
// Price IDs que cobra la app y el mapa price → acción del webhook. Mirror of
// frontend PRICE_IDS in src/components/Payment/functions.js — update both when
// changing prices in Stripe. El catálogo de productos y la regla de meses sin
// intereses viven en stripe.catalog.js.

const PRICE_IDS = {
  // Credits
  CREDITS_3:        'price_1T1DRoAAdNlITNVbLwiUVWAj',
  CREDITS_50:       'price_1Tl9qVAAdNlITNVbzMviUvKo',   // $150
  CREDITS_100:      'price_1Tl9oiAAdNlITNVby13ZND99',   // $200
  CREDITS_200:      'price_1Tl9tfAAdNlITNVbTIy9P6X9',   // $300
  CREDITS_1:        'price_1T1H17AAdNlITNVbrTS94Xdr',   // inactive — keep for webhook history

  // Plans
  PLAN_PAPERLESS:   'price_1SkRvtAAdNlITNVbj8BA6F2Q',
  PLAN_LITE:        'price_1Tl9jyAAdNlITNVbm0hq6omU',   // $2,899
  PLAN_PRO:         'price_1UaFaqAAdNlITNVb73fqH4yd',   // $3,999 — "PRO - Contado" (sin meses)
  PLAN_PRO_MESES:   'price_1UaH1yAAdNlITNVbqdsGJJtf',   // $4,499 — "PRO a meses" (cualquier plazo)

  // Promos (temporales; hoy se venden por Payment Link)
  PRO_20_OFF:       'price_1UaFY1AAdNlITNVbWr0IC7SR',   // $3,199
  PRO_MSI_PROMO:    'price_1UaHg5AAdNlITNVbpmncSmHc',   // $4,000 a meses (Buen Fin)

  // Pops
  POP:              'price_1UPBMpAAdNlITNVbsMytTDx4',   // $549 (lookup_key flash_event)
  BUCKET_5_POPS:    'price_1UaH4PAAdNlITNVbL15skW9Y',   // $2,249 (solo contado)
  BUCKET_10_POPS:   'price_1UaHjdAAdNlITNVbv6j6JQKZ',   // $4,000 (contado o a meses)

  // Upgrade
  UPGRADE_TO_PRO:   'price_1TlC4RAAdNlITNVbjcRtexSy',

  // Side events
  SIDE_EVENT:       'price_1Tl9kwAAdNlITNVbqroYr991',   // $300
  SIDE_EVENT_ALT:   'price_1T1WY5AAdNlITNVbGrRJx77i',
};

// ── Legacy: solo lectura ─────────────────────────────────────────────────────
// Precios de productos o precios archivados en Stripe. No se venden; quedan
// para que el webhook siga resolviendo pagos de sesiones abiertas antes del
// cambio (o si se reprocesa un pago viejo).
const LEGACY_PRICE_IDS = {
  PLAN_PRO_TEST:    'price_1TO1kjAAdNlITNVbmfuaY1nm',   // pro - test
  // Producto PRO original (prod_ThrgpCsSZO0OMO)
  PRO_ORIGINAL:     'price_1Tl9fQAAdNlITNVb953oCZLs',   // $3,999
  PRO_ORIGINAL_3499:'price_1SkRxCAAdNlITNVbB0AB16LN',   // $3,499
  PRO_ORIG_MSI_A:   'price_1UMYAGAAdNlITNVb0zVeyvfn',   // $4,269
  PRO_ORIG_MSI_B:   'price_1UMYAZAAdNlITNVb6zYYD5w1',   // $4,399
  PRO_ORIG_MSI_C:   'price_1UMYAuAAdNlITNVb5wbJynLz',   // $4,719
  PRO_ORIG_MSI_3:   'price_1UP9yXAAdNlITNVbWGfRcHXg',   // $4,349
  PRO_ORIG_MSI_6:   'price_1UP9ysAAdNlITNVbvhFJ46TU',   // $4,499
  PRO_ORIG_MSI_12:  'price_1UP9zVAAdNlITNVbHvAgKL0R',   // $4,799
  // Un producto por plazo (10 nov 2026, archivados el mismo día)
  PRO_3_MESES:      'price_1UaFawAAdNlITNVbVUKNNDOO',   // $4,349 (era pro_msi_3)
  PRO_6_MESES:      'price_1UaFbAAAdNlITNVb5rZP3BPt',   // $4,499 (pro_msi_6)
  PRO_12_MESES:     'price_1UaFbGAAdNlITNVbO8YUryWU',   // $4,799 (pro_msi_12)
  PRO_MSI_PROMO_OLD:'price_1Ua6UjAAdNlITNVbmb5Jz64F',   // $3,199.20
  PRO_MSI_PROMO_3999:'price_1UYqUXAAdNlITNVb74nl51hN',  // $3,999 (lookup pro_promo_3999)
  BUCKET_5_OLD:     'price_1UaF3tAAdNlITNVbtOJvbjYq',   // $2,200
  BUCKET_5_3MSI:    'price_1UaF4DAAdNlITNVbRh1q4NiT',   // $2,370
  BUCKET_5_6MSI:    'price_1UaF4UAAdNlITNVbYMERH6f6',   // $2,430
  BUCKET_10_OLD:    'price_1UaF4aAAdNlITNVbvZ3h2Hkn',   // $3,850
  BUCKET_10_3MSI:   'price_1UaF4qAAdNlITNVbZkkxzT6y',   // $4,170
  BUCKET_10_6MSI:   'price_1UaF4wAAdNlITNVb5Mjjpl5m',   // $4,320
  BUCKET_10_12MSI:  'price_1UaF58AAdNlITNVb7GhFSbuR',   // $4,560
  BUCKET_10_3999:   'price_1UaH63AAdNlITNVbhFKdky3h',   // $3,999
};

const PRO = { type: 'plan', value: 'pro' };
const LEGACY_PRODUCTS = Object.fromEntries([
  ...['PLAN_PRO_TEST', 'PRO_ORIGINAL', 'PRO_ORIGINAL_3499', 'PRO_ORIG_MSI_A', 'PRO_ORIG_MSI_B', 'PRO_ORIG_MSI_C',
    'PRO_ORIG_MSI_3', 'PRO_ORIG_MSI_6', 'PRO_ORIG_MSI_12', 'PRO_3_MESES', 'PRO_6_MESES', 'PRO_12_MESES', 'PRO_MSI_PROMO_OLD', 'PRO_MSI_PROMO_3999']
    .map((k) => [LEGACY_PRICE_IDS[k], PRO]),
  ...['BUCKET_5_OLD', 'BUCKET_5_3MSI', 'BUCKET_5_6MSI'].map((k) => [LEGACY_PRICE_IDS[k], { type: 'pops', value: 5 }]),
  ...['BUCKET_10_OLD', 'BUCKET_10_3MSI', 'BUCKET_10_6MSI', 'BUCKET_10_12MSI', 'BUCKET_10_3999'].map((k) => [LEGACY_PRICE_IDS[k], { type: 'pops', value: 10 }]),
]);

// Catalog used by webhook handler to resolve priceId → action
const PRODUCTS = {
  [PRICE_IDS.CREDITS_3]:       { type: 'credits', value: 3 },
  [PRICE_IDS.CREDITS_50]:      { type: 'credits', value: 50 },
  [PRICE_IDS.CREDITS_100]:     { type: 'credits', value: 100 },
  [PRICE_IDS.CREDITS_200]:     { type: 'credits', value: 200 },
  [PRICE_IDS.CREDITS_1]:       { type: 'credits', value: 1 },

  [PRICE_IDS.PLAN_PAPERLESS]:  { type: 'plan', value: 'paperless' },
  [PRICE_IDS.PLAN_LITE]:       { type: 'plan', value: 'lite' },
  [PRICE_IDS.PLAN_PRO]:        { type: 'plan', value: 'pro' },
  [PRICE_IDS.PLAN_PRO_MESES]:  { type: 'plan', value: 'pro' },
  [PRICE_IDS.PRO_20_OFF]:      { type: 'plan', value: 'pro' },
  [PRICE_IDS.PRO_MSI_PROMO]:   { type: 'plan', value: 'pro' },

  // Pops gratis que se le suman a la cuenta (planner_benefits.free_flash_events).
  [PRICE_IDS.POP]:             { type: 'pops', value: 1 },
  [PRICE_IDS.BUCKET_5_POPS]:   { type: 'pops', value: 5 },
  [PRICE_IDS.BUCKET_10_POPS]:  { type: 'pops', value: 10 },

  [PRICE_IDS.UPGRADE_TO_PRO]:  { type: 'plan', value: 'pro' },

  [PRICE_IDS.SIDE_EVENT]:      { type: 'side', value: 'side_event' },
  [PRICE_IDS.SIDE_EVENT_ALT]:  { type: 'side', value: 'side_event' },

  ...LEGACY_PRODUCTS,
};

// Valid plan price IDs accepted by checkout routes (contado; a meses se pide
// con lookupKey, config/stripe.installments.js)
const PLAN_PRICES = [
  PRICE_IDS.PLAN_LITE,
  PRICE_IDS.PLAN_PRO,
];

module.exports = { PRICE_IDS, LEGACY_PRICE_IDS, PRODUCTS, PLAN_PRICES };
