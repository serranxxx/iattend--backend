const mongoose = require('mongoose');


const dbConnection = async () => {

    try {

        await mongoose.connect(process.env.DB_CNN, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            //useCreateIndex: true
        });

        console.log('DB Online');

    } catch (error) {
        console.log(error);
        throw new Error('Error a la hora de inicializar BD');
    }

}

mongoose.connection.on('error', (error) => {
    console.error('Error en la conexión de MongoDB:', error);
});

module.exports = {
    dbConnection
}