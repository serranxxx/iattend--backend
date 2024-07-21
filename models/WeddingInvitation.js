//------------------------------------------------------------------
//                      code added by Mayra
//------------------------------------------------------------------

const { ObjectId } = require('mongodb');
const { Schema, model } = require('mongoose');
const user = require('./user');


const WeddInvitation = Schema({

    userID: {
        type: Schema.Types.ObjectId,
        ref: user
    },
    greeting: {
        active: {
            type: Boolean,
            require: true
        },
        background: {
            type: Boolean
        },
        separator: {
            type: Boolean
        },
        id: {
            type: Number
        },
        title: {
            type: String,
            require: true,
        },
        description: {
            type: String,
            require: true
        }

    },
    family: {
        active: {
            type: Boolean,
            require: true
        },
        background: {
            type: Boolean
        },
        separator: {
            type: Boolean
        },
        id: {
            type: Number
        },
        title: {
            type: String,
            require: true,
        },
        personas: {
            type: Array
        }
        // him_dad: {
        //     type: String,
        //     require: true
        // },
        // him_mom: {
        //     type: String,
        //     require: true
        // },
        // her_dad: {
        //     type: String,
        //     require: true
        // },
        // her_mom: {
        //     type: String,
        //     require: true
        // }
    },
    quote: {
        active: {
            type: Boolean,
            require: true
        },
        id: {
            type: Number
        },
        background: {
            type: Boolean
        },
        separator: {
            type: Boolean
        },
        description: {
            type: String,
            require: true
        }

    },
    itinerary: {
        active: {
            type: Boolean,
            require: true
        },
        background: {
            type: Boolean
        },
        separator: {
            type: Boolean
        },
        id: {
            type: Number
        },
        object: {
            type: Array,
            require: true
        }

    },
    dresscode: {
        active: {
            type: Boolean,
            require: true
        },
        background: {
            type: Boolean
        },
        id: {
            type: Number
        },
        separator: {
            type: Boolean
        },
        title: {
            type: String,
            // require: true
        },
        description: {
            type: String,
            // require: true
        },
        colors: {
            type: Array
        },
        links: {
            type: Array
        },
        images_prod: {
            type: Array
        },
        images_dev: {
            type: Array
        },
        available: {
            type: Number
        },
        onImages: {
            type: Boolean
        },
        onLinks: {
            type: Boolean
        }
        // username: {
        //     type: String,
        //     // require: true
        // },
        // boards: {
        //     type: Array,
        //     // require: true
        // }


    },
    gifts: {
        active: {
            type: Boolean,
            require: true
        },
        background: {
            type: Boolean
        },
        separator: {
            type: Boolean
        },
        id: {
            type: Number
        },
        title: {
            type: String,
        },
        description: {
            type: String
        },
        cards: {
            type: Array
        }
    },
    notices: {
        active: {
            type: Boolean,
            require: true
        },
        background: {
            type: Boolean
        },
        separator: {
            type: Boolean
        },
        id: {
            type: Number
        },
        notices: Array
    },

    cover: {
        // title: {
        //     type: Object
        // },
        // wallpaper: {
        //     type: Object
        // },
        // date: {
        //     type: Object
        // }
        flexDirection: {
            type: String
        },

        title: {
            type: String
        },
        fontSize: {
            type: Number
        },

        fontWeight: {
            type: Number,
        },

        opacity: {
            type: Number
        },
        align: {
            type: String
        },
        justify: {
            type: String
        },
        date: {
            type: Date
        },
        image: {
            type: String
        },
        featured_prod: {
            type: String,
        },
        featured_dev: {
            type: String,
        },
        color: {
            type: String,
        },
        background: {
            type: String
        },
        auto: {
            type: Boolean
        },
        timerColor: {
            type: String
        },
        timerType: {
            type: Number
        }

    },

    gallery: {
        active: {
            type: Boolean
        },

        background: {
            type: Boolean
        },

        separator: {
            type: Boolean
        },

        id: {
            type: Number
        },

        gallery_prod: {
            type: Array
        },
        gallery_dev: {
            type: Array
        },
        available: {
            type: Number
        }
    },
    generals: {

        color: {
            type: String,
        },
        palette: {
            type: Object
        },
        eventName: {
            type: String,
        },
        font: {
            type: String
        },
        separator: {
            type: Number
        },
        theme: {
            type: Boolean
        },
        positions: {
            type: Array
        }
    },
    active: {
        type: Boolean,
        require: true
    },
    due_date: {
        type: Date,
        require: true,
        default: Date.now
    },
    type: {
        type: String,
        require: true
    },
    plan: {
        type: String,
        require: true,
    },
    creation_date: {
        type: Date,
        require: true,
        default: Date.now
    },
    last_update_date: {
        type: Date,
        require: true,
        default: Date.now
    }



});


module.exports = model('Invitation', WeddInvitation, 'invitation');