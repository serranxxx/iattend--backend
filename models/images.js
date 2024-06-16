
const { Schema, model } = require('mongoose');
const user = require('./user');

const ImageSchema = Schema({

    userID: {
        type: Schema.Types.ObjectId,
        ref: user
    },
    featured: {
        type: String,
        // required: true
    },
    gallery: [{
        type: String,
        // required: true
    }]


});

module.exports = model('Image', ImageSchema);
