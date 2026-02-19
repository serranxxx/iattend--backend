const supabase = require("../config/supabase");

const updateInvitationActive = async (req, res = response) => {
    const { id, active } = req.body;

    try {

        const { error } = await supabase
            .from('invitations')
            .update({ active })
            .eq('id', id);

        if (error) {
            return res.status(400).json({
                ok: false,
                msg: error.message
            });
        }

        res.status(200).json({
            ok: true,
            msg: 'Active updated successfully'
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            msg: error.message || 'Internal Server Error'
        });
    }
};

const updateInvitationCredits = async (req, res = response) => {
    const { id, credits } = req.body;

    try {

        const { error } = await supabase
            .from('invitations')
            .update({ credits })
            .eq('id', id);

        if (error) {
            return res.status(400).json({
                ok: false,
                msg: error.message
            });
        }

        res.status(200).json({
            ok: true,
            msg: 'Credits updated successfully'
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            msg: error.message || 'Internal Server Error'
        });
    }
};

const updateInvitationData = async (req, res = response) => {
    const { id, data } = req.body;

    try {

        const { error } = await supabase
            .from('invitations')
            .update({ data })
            .eq('id', id);

        if (error) {
            return res.status(400).json({
                ok: false,
                msg: error.message
            });
        }

        res.status(200).json({
            ok: true,
            msg: 'Invitation data updated successfully'
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            msg: error.message || 'Internal Server Error'
        });
    }
};


module.exports = { 
    updateInvitationActive,
    updateInvitationData,
    updateInvitationCredits


};