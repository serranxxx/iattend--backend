//------------------------------------------------------------------
//                      code added by Mayra
//------------------------------------------------------------------
const { Schema, model } = require('mongoose');


const UserSchema = Schema({


    Name: {
        type: String,
        require: true,
        trim: true
    },

    Email: {
        type: String,
        require: true,
        trim: true

    },

    Password: {
        type: String,
        require: true,
        trim: true

    },

    Role: {
        type: String,
        trim: true

    },

    Invitations: {
        type: Array
    },

    Active:
    {
        type: Boolean,
        require: true
    },

    Enterprise: {
        active: {
            type: Boolean
        },
        name: {
            type: String,
        },
        logo: {
            type: String,
        },
        discount: {
            type: Number
        },
        color: {
            type: String
        },
        instagram: {
            type: String
        },
        email: {
            type: String
        },
        whatsapp: {
            type: String
        },
        webpage: {
            type: String
        }
        
    }




});

module.exports = model('Users', UserSchema);