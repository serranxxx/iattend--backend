const express = require('express');
const User = require('../models/user');
const invitation = require('../models/rsvp');


const getByID = async (req, res = express.response) => {

    const _id = req.params.id;
    try {
        const Invitation = await invitation.findById(_id);

        if (!Invitation) {
            return res.status(404).json({
                ok: false,
                msg: 'The invitation was not found',
                data: null
            });
        }

        res.json({
            ok: true,
            msg: "Get invitation By Id",
            data: Invitation
        })


    } catch (error) {
        console.log(error);
        return res.status(500).json({
            ok: false,
            msg: 'An error ocurred while querying the country'
        })
    }
}

const getByUserID = async (req, res) => {

    const user_id = req.params.id;

    try {
        // Buscar el usuario por ID
        const user = await User.findById(user_id);

        if (!user) {
            return res.status(404).json({
                ok: false,
                msg: 'User not found'
            });
        }

        // Extraer los IDs de las invitaciones
        const invitationIds = user.Invitations;

        // Buscar todas las invitaciones cuyos _id coincidan con los IDs extraídos
        const invitations = await invitation.find({
            _id: { $in: invitationIds }
        });
        // Devolver las invitaciones encontradas
        res.status(200).json({
            ok: true,
            msg: "Get invitations by user ID",
            data: invitations
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Internal Server Error'
        });
    }
};

const getAll = async (req, res = express.response) => {

    const data = await invitation.find({});
    res.json({
        ok: true,
        msg: 'Get all invitations',
        data: data
    })
}

const getNames = async (req, res = express.response) => {
    try {
        const { label } = req.body;

        // Validar que se haya proporcionado el campo label
        if (!label) {
            return res.status(400).json({
                ok: false,
                msg: 'Label is required'
            });
        }

        // Buscar invitaciones cuyo campo label coincida con el valor proporcionado
        const invitations = await invitation.find({ "generals.event.label" : label });

        // Extraer todos los eventNames de las invitaciones filtradas
        const names = invitations.map(invitation => invitation.generals.eventName);

        res.json({
            ok: true,
            msg: 'Get all event names',
            eventNames: names
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error getting event names'
        });
    }
};

const editInv = async (req, res = response) => {
    try {
        const _id = req.params.id; // Usar el _id directamente
        const updates = req.body; // Valores actualizados

        // Buscar y actualizar el documento por su _id
        const updatedItem = await invitation.findByIdAndUpdate(
            _id, // Usar el _id directamente
            { $set: updates }, // Valores a actualizar
            { new: true } // Devolver el documento actualizado
        );

        if (!updatedItem) {
            return res.status(404).json({
                ok: false,
                msg: 'Invitation not found',
            });
        }

        return res.json({
            ok: true,
            msg: 'Invitation updated',
            updatedItem, // Incluir el documento actualizado en la respuesta
        });
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({
            ok: false,
            msg: 'Internal server error',
        });
    }
};

const addToUser = async (userID, invitationID) => {
    try {
        // Buscar al usuario por su ID
        const user = await User.findById(userID);

        if (!user) {
            throw new Error('User not found');
        }

        // Agregar la nueva invitación al arreglo de invitaciones
        user.Invitations.push(invitationID);

        // Guardar el usuario actualizado en la base de datos
        await user.save();

        console.log(`Invitation ${invitationID} added to user ${userID}`);
    } catch (error) {
        console.error('Error adding invitation to user:', error.message);
    }
};

const newInvitation = async (req, res = response) => {
    try {
        // Crear y guardar la nueva invitación
        const item = new invitation(req.body);
        await item.save();

        // Extraer el userID del cuerpo de la solicitud
        const userID = req.body.userID;

        // Agregar el ID de la nueva invitación al usuario
        await addInvitationToUser(userID, item._id);

        res.status(201).json({
            ok: true,
            msg: 'New invitation added',
            invitationID: item._id
        });
    } catch (error) {
        console.error('Error adding new invitation:', error.message);
        res.status(500).json({
            ok: false,
            msg: 'Error adding new invitation'
        });
    }
};

/** ********************************************
        DELETE - delete invitations
********************************************** */

// const deleteInvitation = async (req, res = response) => {
//     try {
//         const userId = req.params.id; // Obtener el ID del parámetro de la URL

//         // Buscar y eliminar el documento por su ID
//         const deletedItem = await Bite.findByIdAndDelete({ userID: userId });

//         if (!deletedItem) {
//             return res.status(404).json({
//                 ok: false,
//                 msg: 'Item not found',
//             });
//         }

//         return res.json({
//             ok: true,
//             msg: 'invitation deleted',
//             deletedItem,
//         });
//     } catch (error) {
//         console.error('Error:', error);
//         return res.status(500).json({
//             ok: false,
//             msg: 'Internal server error',
//         });
//     }
// };


module.exports = {
    getByID,
    getByUserID,
    getAll,
    getNames,
    editInv,
    addToUser,
    newInvitation
}