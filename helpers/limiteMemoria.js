// Límite de peticiones por ventana de tiempo, en memoria del proceso.
// Alcanza para una sola instancia; si el backend escala a varias, cada una
// lleva su propia cuenta (el tope real queda multiplicado por instancias).
// Para topes que no se deben pasar nunca, contar en la base.

const crearLimite = ({ max, ventanaMs }) => {
    const hits = new Map();

    // Limpieza periódica para que el Map no crezca sin fin.
    setInterval(() => {
        const ahora = Date.now();
        for (const [clave, marcas] of hits) {
            const vigentes = marcas.filter(t => ahora - t < ventanaMs);
            if (vigentes.length) hits.set(clave, vigentes);
            else hits.delete(clave);
        }
    }, ventanaMs).unref();

    // Devuelve true si la petición entra (y la cuenta), false si ya se pasó.
    return (clave) => {
        const ahora = Date.now();
        const vigentes = (hits.get(clave) || []).filter(t => ahora - t < ventanaMs);
        if (vigentes.length >= max) {
            hits.set(clave, vigentes);
            return false;
        }
        vigentes.push(ahora);
        hits.set(clave, vigentes);
        return true;
    };
};

// IP del cliente detrás del proxy de DigitalOcean. X-Forwarded-For se puede
// falsear, por eso este límite solo frena ráfagas: el tope diario por
// invitación (en la base) es el que no se puede saltar.
const ipDe = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;

module.exports = { crearLimite, ipDe };
