const express      = require('express')
const router       = express.Router()
const supabase = require('../config/supabase')
const { validarAccesoInvitacion } = require('../middlewares/validar-acceso-invitacion')

// Paquetes de Lia que se canjean por créditos I attend. Única fuente: el
// front los pide aquí y el canje solo acepta estos. 1 crédito de Lia = $0.01
// USD de modelo (consume_lia_credits); el saldo canjeado no caduca.
const LIA_PACKAGES = [
  { ai_credits: 50,  iattend_cost: 50  },
  { ai_credits: 100, iattend_cost: 80  },
  { ai_credits: 150, iattend_cost: 120 },
]

// GET /api/ai/credits/packages/list — debe ir ANTES de /:invitationId
router.get('/packages/list', (_req, res) => {
  res.json({ success: true, packages: LIA_PACKAGES })
})

// POST /api/ai/credits/purchase — canjea créditos I attend por créditos de Lia
router.post('/purchase', validarAccesoInvitacion, async (req, res) => {
  const { invitation_id, ai_credits } = req.body
  const pkg = LIA_PACKAGES.find(p => p.ai_credits === Number(ai_credits))

  if (!pkg) {
    return res.status(400).json({ success: false, code: 'BAD_PACKAGE', message: 'Ese paquete no existe' })
  }

  try {
    const { data, error } = await supabase.rpc('canjear_creditos_lia', {
      p_invitation_id: invitation_id,
      p_ai_credits:    pkg.ai_credits,
      p_iattend_cost:  pkg.iattend_cost,
    })
    if (error) throw error

    if (!data?.success) {
      const message = data?.code === 'NOT_ENOUGH_CREDITS'
        ? 'No tienes suficientes créditos I attend'
        : 'No se pudo completar el canje'
      return res.status(data?.code === 'NOT_ENOUGH_CREDITS' ? 402 : 400).json({ success: false, code: data?.code, message })
    }

    res.json({ success: true, ...data })
  } catch (err) {
    console.error('[credits/purchase] error:', err.message)
    res.status(500).json({ success: false, message: 'No se pudo completar el canje' })
  }
})

// GET /api/ai/credits/:invitationId
router.get('/:invitationId', validarAccesoInvitacion, async (req, res) => {
  const { invitationId } = req.params
  try {
    const { data, error } = await supabase
      .rpc('get_or_create_daily_usage', { p_invitation_id: invitationId })

    if (error) throw error

    res.json({
      success:           true,
      credits_remaining: data.total_available,
      free_remaining:    data.free_remaining,
      free_limit:        data.free_limit,
      paid_balance:      data.paid_balance,
      pct_free_used:     data.free_limit > 0
        ? Math.round(100 * (data.free_limit - data.free_remaining) / data.free_limit)
        : 0,
      resets_at:         data.resets_at,
      total_spend_usd:   data.total_spend_usd,
    })
  } catch (err) {
    console.error('[credits] error:', err.message)
    res.status(500).json({ success: false, error: 'No se pudo leer el saldo de Lia' })
  }
})

module.exports = router
