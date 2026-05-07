const { generateWalletPass } = require('../services/wallet/walletService');

const generatePass = async (req, res) => {
    const { guestId, guestName, eventName, eventDate, eventTime, tableNumber, coverImageUrl, primaryColor, accentColor } = req.body;

    if (!guestId || !guestName || !eventName || !eventDate) {
        return res.status(400).json({
            ok: false,
            msg: 'Missing required fields: guestId, guestName, eventName, eventDate',
        });
    }

    try {
        const passBuffer = await generateWalletPass({ guestId, guestName, eventName, eventDate, eventTime, tableNumber, coverImageUrl, primaryColor, accentColor });

        if (!passBuffer || passBuffer.length < 100) {
            return res.status(500).json({
                ok: false,
                msg: 'Pass generation produced an empty or invalid buffer',
            });
        }

        res.set({
            'Content-Type': 'application/vnd.apple.pkpass',
            'Content-Disposition': `attachment; filename="pase-${guestId}.pkpass"`,
            'Content-Transfer-Encoding': 'binary',
            'Content-Length': passBuffer.length,
        });

        res.send(passBuffer);
    } catch (error) {
        console.error('Error generating wallet pass:', error);
        res.status(500).json({
            ok: false,
            msg: 'Error generating pass',
            error: error.message,
        });
    }
};

module.exports = { generatePass };
