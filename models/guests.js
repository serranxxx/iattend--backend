
const { Schema, model } = require('mongoose');
const user = require('./user');
const invitation = require('./WeddingInvitation')

const GuestSchema = Schema({

    userID: {
        type: Schema.Types.ObjectId,
        ref: user,
        required: true
    },
    invitationID: {
        type: Schema.Types.ObjectId,
        ref: invitation,
        required: true
    },
    tickets: {
        type: Number,
        require: true
    },
    type: {
        type: String,
        required: true
    },

    guests: {
        type: Array,
        require: true
    },
    share: {
        type: Array
    }


});

module.exports = model('Guest', GuestSchema);
