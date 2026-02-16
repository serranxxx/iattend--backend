const supabase = require("../config/supabase");

async function updateInvitationCredits(invitationId, creditsToAdd) {

  // 1️⃣ Buscar invitación actual
  const { data: invitation, error: fetchError } = await supabase
    .from("invitations")
    .select("credits")
    .eq("id", invitationId)
    .single();

  if (fetchError) {
    console.log("Error buscando invitación:", fetchError);
    return;
  }

  const currentCredits = invitation.credits || 0;
  const newCredits = currentCredits + creditsToAdd;

  // 2️⃣ Actualizar credits
  const { data, error } = await supabase
    .from("invitations")
    .update({ credits: newCredits })
    .eq("id", invitationId);

  if (error) {
    console.log("Error actualizando credits:", error);
  } 
}


function handleCredits(priceID) {

   switch (priceID) {
    case 'price_1T1DRoAAdNlITNVbLwiUVWAj': return 3;
    case 'price_1Sx8PvAAdNlITNVbchl6tJBW': return 50;
    case 'price_1Sx8QpAAdNlITNVbIod9MW44': return 100;
    case 'price_1Sx8RWAAdNlITNVbj7c85GlG': return 200;
    case 'price_1T1H17AAdNlITNVbrTS94Xdr': return 1;
   
    default:
        break;
   }
  }
  

module.exports = {
    updateInvitationCredits,
    handleCredits
}