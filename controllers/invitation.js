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


const updateInvitationFields = async (req, res = response) => {
    const { id, name, label, phone_number, owners, url_image } = req.body;

    if (!id) {
        return res.status(400).json({ ok: false, msg: 'id es requerido' });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (label !== undefined) updates.label = label;
    if (phone_number !== undefined) updates.phone_number = phone_number;
    if (owners !== undefined) updates.owners = owners;
    if (url_image !== undefined) updates.url_image = url_image;

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ ok: false, msg: 'No hay campos para actualizar' });
    }

    try {

        const { error } = await supabase
            .from('invitations')
            .update(updates)
            .eq('id', id);

        if (error) {
            return res.status(400).json({
                ok: false,
                msg: error.message
            });
        }

        res.status(200).json({
            ok: true,
            msg: 'Invitation fields updated successfully'
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            msg: error.message || 'Internal Server Error'
        });
    }
};


const AddNewOwner = async (req, res = response) => {
    const { id, name } = req.body;
  
    try {
      // 1. Obtener owners actuales
      const { data, error: fetchError } = await supabase
        .from('invitations')
        .select('owners')
        .eq('id', id)
        .single();
  
      if (fetchError) {
        return res.status(400).json({
          ok: false,
          msg: fetchError.message
        });
      }
  
      const currentOwners = data.owners || [];
  
      // 2. Evitar duplicados (opcional pero recomendado)
      if (currentOwners.includes(name)) {
        return res.status(400).json({
          ok: false,
          msg: 'Owner already exists'
        });
      }
  
      // 3. Actualizar
      const { error } = await supabase
        .from('invitations')
        .update({ owners: [...currentOwners, name] })
        .eq('id', id);
  
      if (error) {
        return res.status(400).json({
          ok: false,
          msg: error.message
        });
      }
  
      res.status(200).json({
        ok: true,
        msg: 'Owner added successfully'
      });
  
    } catch (error) {
      res.status(500).json({
        ok: false,
        msg: error.message || 'Internal Server Error'
      });
    }
  };


  const RemoveOwnerByIndex = async (req, res = response) => {
    const { id, index } = req.body;
  
    try {
      // 1. Obtener owners actuales
      const { data, error: fetchError } = await supabase
        .from('invitations')
        .select('owners')
        .eq('id', id)
        .single();
  
      if (fetchError) {
        return res.status(400).json({
          ok: false,
          msg: fetchError.message
        });
      }
  
      const currentOwners = data.owners || [];
  
      // 2. Validar index
      if (index < 0 || index >= currentOwners.length) {
        return res.status(400).json({
          ok: false,
          msg: 'Invalid index'
        });
      }
  
      // 3. Remover
      const updatedOwners = currentOwners.filter((_, i) => i !== index);
  
      // 4. Actualizar
      const { error } = await supabase
        .from('invitations')
        .update({ owners: updatedOwners })
        .eq('id', id);
  
      if (error) {
        return res.status(400).json({
          ok: false,
          msg: error.message
        });
      }
  
      res.status(200).json({
        ok: true,
        msg: 'Owner removed successfully'
      });
  
    } catch (error) {
      res.status(500).json({
        ok: false,
        msg: error.message || 'Internal Server Error'
      });
    }
  };


const createInvitationFromPreview = async (req, res) => {
    const { user_id, user_email, plan, data } = req.body;

    if (!user_id || !data) {
        return res.status(400).json({ ok: false, msg: 'user_id y data son requeridos' });
    }

    const planName = plan === 'pro' ? 'pro' : plan === 'lite' ? 'lite' : null;

    const invData = {
        ...data,
        generals: {
            ...data?.generals,
            event: { label: null, name: null },
        },
    };

    const payload = {
        user_id,
        user_email: user_email || '',
        plan: planName,
        label: null,
        name: null,
        phone_number: null,
        type: 'closed',
        active: planName !== null,
        credits: planName === 'pro' ? 300 : 0,
        tickets: 300,
        owners: [],
        url_image: null,
        data: invData,
    };

    try {
        const { data: inv, error } = await supabase
            .from('invitations')
            .insert(payload)
            .select('id')
            .single();

        if (error) return res.status(400).json({ ok: false, msg: error.message });
        return res.status(201).json({ ok: true, id: inv.id });
    } catch (err) {
        return res.status(500).json({ ok: false, msg: err.message || 'Internal Server Error' });
    }
};

const setPlan = async (req, res) => {
    const { id, plan } = req.body;

    if (!id || !plan) {
        return res.status(400).json({ ok: false, msg: 'id y plan son requeridos' });
    }

    const planName = plan === 'pro' ? 'pro' : 'lite';

    try {
        const { error } = await supabase
            .from('invitations')
            .update({
                plan: planName,
                credits: planName === 'pro' ? 300 : 0,
                active: true,
            })
            .eq('id', id);

        if (error) return res.status(400).json({ ok: false, msg: error.message });
        return res.status(200).json({ ok: true });
    } catch (err) {
        return res.status(500).json({ ok: false, msg: err.message || 'Internal Server Error' });
    }
};

module.exports = {
    updateInvitationActive,
    updateInvitationData,
    updateInvitationCredits,
    updateInvitationFields,
    AddNewOwner,
    RemoveOwnerByIndex,
    createInvitationFromPreview,
    setPlan,
};