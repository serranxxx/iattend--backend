const Guest = require('../models/guests');
const { generarJWT } = require('../helpers/jwt');



const guestLogin = async (req, res = response) => {
    const { invitationID, guestID } = req.body;

    try {
        // Buscar la invitación por ID
        const invitacion = await Guest.findOne({ invitationID });
        console.log("invitacion: ", invitacion)

        if (!invitacion) {
            return res.json({
                ok: false,
                msg: 'Invitation not found',
                data: null
            });
        }

        // Buscar el invitado dentro del arreglo de guests
        const invitado = invitacion.guests.find(guest => guest.id === guestID);
        console.log('invitado: ', invitado)
        if (!invitado) {
            return res.json({
                ok: false,
                msg: 'Guest not found',
                data: null
            });
        }

        // Generar JWT
        const token = await generarJWT(invitado.id, invitado.name);
        console.log('token: ', token)

        res.json({
            ok: true,
            msg: 'Valid guest',
            data: {
                guestID: invitado.id,
                username: invitado.name,
                cards: invitado.available_cards,
                companions: invitado.companions,
                status: invitado.state,
                token: token,
                tickets: invitacion.tickets,
                type: invitacion.type
            }
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            ok: false,
            msg: 'An error occurred, please talk to the administrator',
            data: null
        });
    }
};


// Crear un nuevo invitado
const createGuest = async (req, res) => {
    try {
        const guest = new Guest(req.body);
        await guest.save();
        res.status(201).json({
            ok: true,
            msg: 'Guest created successfully',
            guest
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error creating guest',
            error: error.message
        });
    }
};

// Obtener todos los invitados
const getGuests = async (req, res) => {
    try {
        const guests = await Guest.find();
        res.status(200).json({
            ok: true,
            guests
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error retrieving guests',
            error: error.message
        });
    }
};

// Obtener un invitado por invitationID
const getGuestByInvitationId = async (req, res) => {

    const invitationID = req.params.id;
    try {
        const guest = await Guest.findOne({ invitationID });
        if (!guest) {
            return res.status(404).json({ message: 'Guest not found' });
        }
        res.status(200).json({
            ok: true,
            msg: "Guests by ID",
            guest
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error retrieving guest',
            error: error.message
        });
    }
};

// Actualizar un invitado por invitationID
const updateGuestByInvitationId = async (req, res) => {
    const invitationID = req.params.id;
    const updates = req.body;

    try {
        const guest = await Guest.findOneAndUpdate({ invitationID }, updates, { new: true, runValidators: true });

        if (!guest) {
            return res.status(404).json({ message: 'Guest not found' });
        }

        res.status(200).json({
            ok: true,
            msg: 'Guest updated successfully',
            guest
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error updating guest',
            error: error.message
        });
    }
};

// Eliminar un invitado por invitationID
const deleteGuestByInvitationId = async (req, res) => {
    const { invitationID } = req.params;
    try {
        const guest = await Guest.findOneAndDelete({ invitationID });
        if (!guest) {
            return res.status(404).json({ message: 'Guest not found' });
        }
        res.status(200).json({
            ok: true,
            msg: 'Guest deleted successfully',
            guest
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error deleting guest',
            error: error.message
        });
    }
};

// Editar un objeto dentro del arreglo guests por invitationID
const updateGuestInArray = async (req, res) => {
    const invitationID = req.params.id;
    const { id, guestUpdates } = req.body;

    try {
        const guest = await Guest.findOne({ invitationID });
        if (!guest) {
            return res.status(404).json({ message: 'Guest not found' });
        }

        const guestIndex = guest.guests.findIndex(g => g.id === id);
        if (guestIndex === -1) {
            return res.status(404).json({ message: 'Guest with provided id not found' });
        }

        guest.guests[guestIndex] = { ...guest.guests[guestIndex], ...guestUpdates, last_update_date: new Date() };

        await guest.save();

        res.status(200).json({
            ok: true,
            msg: 'Guest updated successfully',
            guest
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error updating guest within array',
            error: error.message
        });
    }
};

// Eliminar un objeto dentro del arreglo guests por invitationID
const deleteGuestInArray = async (req, res) => {
    const invitationID = req.params.id;
    const { id } = req.body;

    try {
        const guest = await Guest.findOne({ invitationID });
        if (!guest) {
            return res.status(404).json({ message: 'Guest not found' });
        }

        const guestIndex = guest.guests.findIndex(g => g.id === id);
        if (guestIndex === -1) {
            return res.status(404).json({ message: 'Guest with provided id not found' });
        }

        guest.guests.splice(guestIndex, 1);

        await guest.save();

        res.status(200).json({
            ok: true,
            msg: 'Guest updated successfully',
            guest
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error deleting guest within array',
            error: error.message
        });
    }
};

const getUpdatesByInvitationID = async (req, res) => {
    const invitationID = req.params.id;

    try {
        const guest = await Guest.findOne({ invitationID });
        if (!guest) {
            return res.status(404).json({ message: 'Guest not found' });
        }

        // Ordenar el arreglo guests por last_update_date en orden descendente
        const sortedGuests = guest.guests.sort((a, b) => new Date(b.last_update_date) - new Date(a.last_update_date));

        // Obtener los primeros 10 elementos
        const recentGuests = sortedGuests.slice(0, 10);

        res.status(200).json({
            ok: true,
            msg: "Updates by ID",
            recentGuests
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error retrieving recent guests',
            error: error.message
        });
    }
};

// Agregar un nuevo elemento a share
const addShareItem = async (req, res) => {
    const invitationID = req.params.id;
    const { email, password, id } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            ok: false,
            msg: 'Email and password are required'
        });
    }

    try {
        const guest = await Guest.findOne({ invitationID });
        if (!guest) {
            return res.status(404).json({ message: 'Guest not found' });
        }


        const newShareItem = {
            email,
            password,
            id
        };

        guest.share.push(newShareItem);
        await guest.save();

        res.status(200).json({
            ok: true,
            msg: 'Share item added successfully',
            share: guest.share
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error adding share item',
            error: error.message
        });
    }
};


// Eliminar un elemento de share por id
const deleteShareItemById = async (req, res) => {
    const invitationID = req.params.id;
    const { shareId } = req.body;

    try {
        const guest = await Guest.findOne({ invitationID });
        if (!guest) {
            return res.status(404).json({ message: 'Guest not found' });
        }

        guest.share = guest.share.filter(item => item.id !== shareId);
        await guest.save();

        res.status(200).json({
            ok: true,
            msg: 'Share item removed successfully',
            share: guest.share
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error removing share item',
            error: error.message
        });
    }
};

const shareLogin = async (req, res = response) => {
    const invitationID = req.params.id;
    const { password } = req.body;

    try {
        // Buscar la invitación por ID
        const guest = await Guest.findOne({ invitationID });
        if (!guest) {
            return res.status(404).json({ message: 'Guest not found' });
        }

        // Buscar el usuario dentro del arreglo de share usando el password
        const usuario = guest.share.find(share => share.password === password);


        if (!usuario) {
            return res.json({
                ok: false,
                msg: 'Incorrect password',
                data: null
            });
        }

        // Generar JWT
        const token = await generarJWT(usuario.id, usuario.email);
        console.log('token: ', token);

        res.json({
            ok: true,
            msg: 'Valid user',
            data: {
                token: token,
                user: usuario.email
            }

        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            ok: false,
            msg: 'An error occurred, please talk to the administrator',
            data: null
        });
    }
};






module.exports = {
    createGuest,
    guestLogin,
    getGuests,
    getGuestByInvitationId,
    updateGuestByInvitationId,
    deleteGuestByInvitationId,
    updateGuestInArray,
    deleteGuestInArray,
    getUpdatesByInvitationID,
    addShareItem,
    deleteShareItemById,
    shareLogin,
};