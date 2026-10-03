-- Links de pago (Stripe Payment Links) de PRO a meses para /sales.
--
-- Van en configuracion_pagos como cualquier link, con plan = '{plan}_msi_{meses}'.
-- El front (modules/Sales/paymentUtils.js → installmentLinks) lee cualquier
-- fila con esa forma: para agregar otro plazo basta otra fila.
--
-- Cada link deja pagar HASTA esos meses: los rangos de monto de Stripe
-- (Settings → Payment methods → Meses sin intereses) no dejan elegir más.
--   PRO_msi_3  $4,269 → 3
--   PRO_msi_6  $4,399 → 3 o 6
--   PRO_msi_12 $4,719 → 3, 6 o 12
-- Lite no se vende a meses.

-- El check original de `plan` (creado fuera de este repo) no acepta las llaves
-- nuevas. Se reemplaza por uno que acepta: 'general' (transferencia), el plan
-- solo ('PRO', 'Lite'), con descuento ('PRO_10', que lee VendorNewSale) y a
-- meses ('PRO_msi_6'). Antes de correrlo, revisar el original con:
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'configuracion_pagos_plan_check';
alter table public.configuracion_pagos
  drop constraint if exists configuracion_pagos_plan_check;

alter table public.configuracion_pagos
  add constraint configuracion_pagos_plan_check
  check (plan = 'general' or plan ~ '^(PRO|Lite)(_[0-9]+|_msi_[0-9]+)?$');

insert into public.configuracion_pagos (plan, tipo, stripe_url, activo)
select v.plan, 'stripe_link', v.stripe_url, true
from (values
  ('PRO_msi_3',  'https://buy.stripe.com/7sYdR85SIaEVamb3zkd7q05'),
  ('PRO_msi_6',  'https://buy.stripe.com/6oUaEW6WM00h65V6Lwd7q04'),
  ('PRO_msi_12', 'https://buy.stripe.com/eVq28q3KA6oF65Vd9Ud7q03')
) as v(plan, stripe_url)
where not exists (
  select 1 from public.configuracion_pagos c
  where c.plan = v.plan and c.tipo = 'stripe_link'
);
