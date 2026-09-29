const supabase = require('../config/supabase');

// Compras de planes con Stripe → venta del vendedor "Ecommerce".
// Lo llama processingPayment (webhook checkout.session.completed) después de
// crear o activar la invitación. Nunca lanza: si algo falla, el pago y el plan
// ya quedaron procesados y solo se registra el error.
// Ver migrations/2026-09-29_ventas_ecommerce.sql.

// ventas.plan solo acepta estos (check constraint). Paperless no se registra.
const PLAN_DE_VENTA = { pro: 'PRO', lite: 'Lite' };

let vendedorEcommerceId = null;

const idVendedorEcommerce = async () => {
  if (vendedorEcommerceId) return vendedorEcommerceId;
  const { data, error } = await supabase
    .from('vendedores')
    .select('id')
    .eq('tipo', 'ecommerce')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  vendedorEcommerceId = data?.id ?? null;
  return vendedorEcommerceId;
};

async function registrarVentaEcommerce({ invitationId, planName, session }) {
  try {
    const plan = PLAN_DE_VENTA[String(planName).toLowerCase()];
    if (!plan || !invitationId || !session?.id) return;

    // Las sesiones de prueba de Stripe no son ventas (salvo que se pida para
    // probar en local).
    if (!session.livemode && process.env.ECOMMERCE_VENTAS_EN_TEST !== '1') return;

    const monto = Number(session.amount_total ?? 0) / 100;
    if (!(monto > 0)) return;

    // Stripe reintenta el webhook: si el pago de esta sesión ya está, no se repite.
    const { data: yaRegistrado } = await supabase
      .from('pagos')
      .select('id')
      .eq('metodo', 'stripe')
      .eq('referencia', session.id)
      .limit(1)
      .maybeSingle();
    if (yaRegistrado) return;

    const vendedorId = await idVendedorEcommerce();
    if (!vendedorId) {
      console.error('Venta ecommerce no registrada: falta el vendedor Ecommerce (correr 2026-09-29_ventas_ecommerce.sql)');
      return;
    }

    const subtotal = Number(session.amount_subtotal ?? session.amount_total ?? 0) / 100;
    const descuentoPct = subtotal > 0 ? Math.round(((subtotal - monto) / subtotal) * 100) : 0;
    const fecha = session.created ? new Date(session.created * 1000).toISOString() : new Date().toISOString();

    // Una venta por evento. Si ya tenía una (p. ej. Lite que sube a PRO), se
    // actualiza el plan y se suma lo cobrado en vez de crear otra.
    const { data: existente } = await supabase
      .from('ventas')
      .select('id, precio_acordado')
      .eq('invitation_id', invitationId)
      .order('fecha_venta', { ascending: false })
      .limit(1)
      .maybeSingle();

    let ventaId = existente?.id ?? null;

    if (ventaId) {
      const { error } = await supabase
        .from('ventas')
        .update({ plan, precio_acordado: Number(existente.precio_acordado || 0) + monto })
        .eq('id', ventaId);
      if (error) throw error;
    } else {
      const { data: venta, error } = await supabase
        .from('ventas')
        .insert({
          invitation_id: invitationId,
          vendedor_id: vendedorId,
          plan,
          precio_acordado: monto,
          descuento_pct: Math.max(0, descuentoPct),
          fecha_venta: fecha,
          notas: 'Compra en línea (Stripe)',
        })
        .select('id')
        .single();
      if (error) throw error;
      ventaId = venta.id;
    }

    // Pagado completo: el saldo de la venta queda en 0.
    const { error: pagoError } = await supabase.from('pagos').insert({
      venta_id: ventaId,
      monto,
      fecha,
      metodo: 'stripe',
      referencia: session.id,
      nota: existente ? `Upgrade en línea a ${plan}` : 'Pago en línea (Stripe)',
    });
    if (pagoError) throw pagoError;
  } catch (error) {
    console.error('No se pudo registrar la venta ecommerce:', error.message || error);
  }
}

module.exports = { registrarVentaEcommerce };
