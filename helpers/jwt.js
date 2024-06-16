const jwt = require('jsonwebtoken');

const generarJWT = (uid, name) => {

    return new Promise((resolve, reject) => {

        const payload = { uid, name };

        jwt.sign(payload, process.env.SECRET_JWT_SEED, {
            expiresIn: '8h'
        }, (err, token) => {

            if (err) {
                console.log(err);
                reject('No se pudo generar el token');
            }

            resolve(token);

        })
    })
}

const getIdUserByToken = (req) => {

    const token = req.header('token');
    if (!token) {
        return false;
    }
    try {
        const payload = jwt.verify(
            token,
            process.env.SECRET_JWT_SEED
        );

        const { uid } = payload;
        return uid;
    } catch (error) {
        return false;
    }

}



module.exports = {
    generarJWT,
    getIdUserByToken
}


