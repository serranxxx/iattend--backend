const { response } = require('express');
const bcrypt = require('bcryptjs');
const { generarJWT, getIdUserByToken } = require('../helpers/jwt');
const user = require('../models/user');



/** ********************************************
        PUT - Log IN User
********************************************** */
const loginUsuario = async (req, res = response) => {
    const { Email, Password } = req.body;

    try {
        const usuario = await user.findOne({ Email });

        if (!usuario) {
            return res.json({
                ok: false,
                msg: 'User not found',
                data: null
            });
        }

        // Confirm password
        const validPassword = await bcrypt.compare(Password, usuario.Password);

        if (!validPassword) {
            return res.json({
                ok: false,
                msg: 'Invalid password',
                data: null
            });
        }

        // Generate JWT
        const token = await generarJWT(usuario._id, usuario.Name); // Utilizar usuario._id
        console.log(token)

        console.log(usuario)

        res.json({
            ok: true,
            msg: 'Valid user',
            data: {
                uid: usuario._id, // Utilizar usuario._id
                username: usuario.Name,
                token: token,
                role: usuario.Role
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


/** ********************************************
        GET - Renew Token
********************************************** */
const revalidarToken = async (req, res = response) => {

    const { uid, name } = req;

    // Generar JWT
    const token = await generarJWT(uid, name);

    res.json({
        ok: true,
        msg: "Token renewed",
        data: {
            token,
            uid
        }
    })
}

/** ********************************************
        GET - All Users
********************************************** */
const GetAllusers = async (req, res = response) => {

    const Userlist = await user.find({});

    res.json({
        ok: true,
        msg: "Get all Users",
        data: {
            Userlist
        }
    })
}

/** ********************************************
        GET - User Info
********************************************** */
const getUserLogged = async (req, res) => {

    const Id_User = getIdUserByToken(req);

    try {

        const UserInfo = await user.findById(Id_User);

        if (!UserInfo) {
            res.status(401).json(
                {
                    ok: true,
                    msg: "Id user was not found",
                    data: null
                });
        }

        res.json(
            {
                ok: true,
                msg: "User Info",
                data: UserInfo
            });

    } catch (error) {
        console.log(error);
        res.status(500).json({
            ok: false,
            msg: "An error occurred, please talk to the administrator",
            data: null
        });
    }
}

/** ********************************************
        POST - Create user
********************************************** */
const newUser = async (req, res = response) => {
    const { Name, Email, Password, Role, Invitations } = req.body;

    try {
        // Verificar si ya existe un usuario con el mismo correo electrónico
        const existingUser = await user.findOne({ Email });

        if (existingUser) {
            return res.status(400).json({
                ok: false,
                msg: 'Email already exists',
            });
        }

        // Generar el hash de la contraseña
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(Password, salt);

        const item = new user({
            Name,
            Email,
            Role,
            Invitations,
            Active: true,
            Password: hashedPassword, // Usar la contraseña codificada
        });

        await item.save();

        res.status(201).json({
            ok: true,
            msg: 'User uploaded',
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            msg: error.message || 'Internal Server Error',
        });
    }
};


module.exports = {
    loginUsuario,
    revalidarToken,
    GetAllusers,
    getUserLogged,
    newUser
}