-- Lo que Stripe se queda de cada pago en línea (comisión del cargo + MSI +
-- Stripe Climate, con IVA), para que el ingreso neto del Admin sea lo que llega
-- a la cuenta. Lo llena el backend (helpers/comisionStripe.js): el webhook al
-- registrar el pago y el listado de ventas del Admin concilia los que faltan.
-- comision_stripe_final = false mientras sea estimada (el cargo de MSI llega un
-- día después).
alter table public.pagos
  add column if not exists comision_stripe numeric(10,2),
  add column if not exists comision_stripe_final boolean not null default false;
