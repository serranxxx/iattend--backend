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




});

module.exports = model('Users', UserSchema);