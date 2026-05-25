const express      = require('express')
const router       = express.Router()
const supabase = require('../config/supabase')

// GET /api/ai/credits/packages/list — debe ir ANTES de /:invitationId
router.get('/packages/list', (_req, res) => {
  res.json({
    success: true,
    packages: [
      { id: process.env.STRIPE_PRICE_AI_50,  credits: 50,  price_usd: 9.99,  label: '50 consultas' },
      { id: process.env.STRIPE_PRICE_AI_100, credits: 100, price_usd: 17.99, label: '100 consultas' },
      { id: process.env.STRIPE_PRICE_AI_200, credits: 200, price_usd: 29.99, label: '200 consultas' },
    ],
  })
})

// GET /api/ai/credits/:invitationId
router.get('/:invitationId', async (req, res) => {
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
      pct_free_used:     Math.round(
        100 * (data.free_limit - data.free_remaining) / data.free_limit
      ),
      resets_at:         data.resets_at,
      total_spend_usd:   data.total_spend_usd,
    })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
