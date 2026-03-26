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


module.exports = { 
    updateInvitationActive,
    updateInvitationData,
    updateInvitationCredits,
    AddNewOwner,
    RemoveOwnerByIndex


};