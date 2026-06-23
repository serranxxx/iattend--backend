// ── Stripe price IDs ─────────────────────────────────────────────────────────
// Single source of truth for the backend. Mirror of frontend PRICE_IDS in
// src/components/Payment/functions.js — update both when changing prices in Stripe.

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
  PLAN_PRO:         'price_1Tl9fQAAdNlITNVb953oCZLs',   // $3,999
  PLAN_PRO_TEST:    'price_1TO1kjAAdNlITNVbmfuaY1nm',   // legacy test ID kept for webhook history

  // Upgrade
  UPGRADE_TO_PRO:   'price_1TlC4RAAdNlITNVbjcRtexSy',

  // Side events
  SIDE_EVENT:       'price_1Tl9kwAAdNlITNVbqroYr991',   // $300
  SIDE_EVENT_ALT:   'price_1T1WY5AAdNlITNVbGrRJx77i',
};

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
  [PRICE_IDS.PLAN_PRO_TEST]:   { type: 'plan', value: 'pro' },

  [PRICE_IDS.UPGRADE_TO_PRO]:  { type: 'plan', value: 'pro' },

  [PRICE_IDS.SIDE_EVENT]:      { type: 'side', value: 'side_event' },
  [PRICE_IDS.SIDE_EVENT_ALT]:  { type: 'side', value: 'side_event' },
};

// Valid plan price IDs accepted by checkout routes
const PLAN_PRICES = [
  PRICE_IDS.PLAN_LITE,
  PRICE_IDS.PLAN_PRO,
  PRICE_IDS.PLAN_PRO_TEST,
];

module.exports = { PRICE_IDS, PRODUCTS, PLAN_PRICES };
