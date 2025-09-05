const { Schema, model } = require('mongoose');

// Subschemas
const PeopleSchema = new Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: null, trim: true }
}, { _id: false });

const MomentsSchema = new Schema({
  name: { type: String, required: true, trim: true },
  time: { type: String, default: null },        // o Date si aplica
  description: { type: String, default: null }
}, { _id: false });

const AddressSchema = new Schema({
  street: { type: String, default: null },
  number: { type: String, default: null },      // antes 'numbe' y Number
  neighborhood: { type: String, default: null },// antes 'district'
  zip: { type: String, default: null },         // mejor string
  city: { type: String, default: null },
  state: { type: String, default: null },
  country: { type: String, default: null },
  url: { type: String, default: null }
}, { _id: false });

const ItinerarySchema = new Schema({
  name: { type: String, required: true, trim: true },
  time: { type: String, default: null },        // o Date
  subtext: { type: String, default: null },
  active: { type: Boolean, default: false },
  icon: { type: Number, default: null },
  id: { type: Number, default: null },
  address: { type: AddressSchema, default: undefined },
  moments: { type: [MomentsSchema], default: [] },
  music: { type: [String], default: [] }
}, { _id: false });

const GiftCardSchema = new Schema({
  // Mejor 'kind' en lugar de 'type' para evitar confusión con Mongoose
  kind: { type: String, required: true, enum: ['store', 'bank'] },
  brand: { type: String, default: null },   // para 'store'
  url: { type: String, default: null },
  bank: { type: String, default: null },    // para 'bank'
  name: { type: String, default: null },
  number: { type: String, default: null }
}, { _id: false });

const DestinationSchema = new Schema({
  image: { type: String, default: null },
  name: { type: String, default: null },
  url: { type: String, default: null }
}, { _id: false });

const FontSchema = new Schema({
  value: { type: String, default: null },
  size: { type: Number, default: null },
  weight: { type: Number, default: null },
  opacity: { type: Number, default: null },
  typeFace: { type: String, default: null } // antes 'tyeFace'
}, { _id: false });

const InvitationSchema = new Schema({
  userID: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },

  cover: {
    title: {
      text: FontSchema,
      position: {
        // antes 'trype'
        column_reverse: { type: String, default: null }, // quizá enum: ['column','column-reverse']
        align_x: { type: String, default: null },        // enum: ['left','center','right']
        align_y: { type: String, default: null }         // enum: ['start','center','end']
      }
    },
    date: {
      value: { type: Date, default: null },
      active: { type: Boolean, default: false },
      color: { type: String, default: null }, // valida hex si quieres
      type: { type: Number, default: null }   // enum si aplica
    },
    image: {
      prod: { type: String, default: null },
      dev:  { type: String, default: null },
      background: { type: Boolean, default: null },
      blur: { type: Boolean, default: null },
      position: { x: { type: Number, default: 0 }, y: { type: Number, default: 0 } },
      zoom: { type: Number, default: 1 }
    }
  },

  greeting: {
    active: { type: Boolean, required: true, default: false },
    inverted: { type: Boolean, default: false },
    background: { type: Boolean, default: false },
    separator: { type: Boolean, default: false },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true }
  },

  people: {
    active: { type: Boolean, required: true, default: false },
    background: { type: Boolean, default: false },
    inverted: { type: Boolean, default: false },
    separator: { type: Boolean, default: false },
    title: { type: String, required: true, trim: true },
    personas: { type: [PeopleSchema], default: [] }
  },

  quote: {
    active: { type: Boolean, required: true, default: false },
    inverted: { type: Boolean, default: false },
    background: { type: Boolean, default: false },
    separator: { type: Boolean, default: false },
    image: {
      active: { type: Boolean, default: false },
      dev: { type: String, default: null },
      prod: { type: String, default: null }
    },
    text: {
      font: FontSchema,                     // renombré para evitar colisión con 'text'
      justify: { type: String, default: null },
      align: { type: String, default: null },
      width: { type: Number, default: null },
      shadow: { type: Boolean, default: false }
    }
  },

  itinerary: {
    active: { type: Boolean, required: true, default: false },
    background: { type: Boolean, default: false },
    inverted: { type: Boolean, default: false },
    separator: { type: Boolean, default: false },
    title: { type: String, default: null },
    object: { type: [ItinerarySchema], default: [] }
  },

  dresscode: {
    active: { type: Boolean, required: true, default: false },
    background: { type: Boolean, default: false },
    inverted: { type: Boolean, default: false },
    separator: { type: Boolean, default: false },
    title: { type: String, default: null },
    description: { type: String, default: null },
    colors: { type: [String], default: [] },
    links: { type: [String], default: [] },
    prod: { type: [String], default: [] },
    dev: { type: [String], default: [] },
    images_active: { type: Boolean, default: false },
    links_active: { type: Boolean, default: false }
  },

  gifts: {
    active: { type: Boolean, required: true, default: false },
    background: { type: Boolean, default: false },
    inverted: { type: Boolean, default: false },
    separator: { type: Boolean, default: false },
    title: { type: String, default: null },
    description: { type: String, default: null },
    cards: { type: [GiftCardSchema], default: [] }
  },

  destinations: {
    active: { type: Boolean, required: true, default: false },
    background: { type: Boolean, default: false },
    inverted: { type: Boolean, default: false },
    separator: { type: Boolean, default: false },
    title: { type: String, default: null },
    description: { type: String, default: null },
    cards: { type: [DestinationSchema], default: [] }
  },

  notices: {
    active: { type: Boolean, required: true, default: false },
    background: { type: Boolean, default: false },
    inverted: { type: Boolean, default: false },
    separator: { type: Boolean, default: false },
    notices: { type: [String], default: [] },
    title: { type: String, default: null }
  },

  gallery: {
    active: { type: Boolean, default: false },
    background: { type: Boolean, default: false },
    inverted: { type: Boolean, default: false },
    separator: { type: Boolean, default: false },
    prod: { type: [String], default: [] },
    dev: { type: [String], default: [] },
    title: { type: String, default: null }
  },

  generals: {
    colors: {
      primary: { type: String, default: null },   // antes Stringm
      secondary: { type: String, default: null },
      accent: { type: String, default: null },
      actions: { type: String, default: null }
    },
    fonts: {
      titles: { type: FontSchema, default: undefined },
      body: { type: FontSchema, default: undefined }
    },
    event: {
      label: { type: String, default: null },
      name: { type: String, default: null }
    },
    separator: { type: Number, default: 0 },
    positions: { type: [Number], default: [] },
    texture: { type: Number, default: 0 }
  },

  invitation: {
    active: { type: Boolean, required: true, default: false },
    type:   { type: String, required: true, trim: true }, // enum si aplica
    plan:   { type: String, required: true, trim: true }, // enum si aplica
    payment: {
      type: { type: String, default: null },  // enum ['stripe','cash','transfer'] ?
      date: { type: String, default: null }
    },
    started: { type: Boolean, default: false }
  }

}, {
  collection: 'newInvitation',
  timestamps: true,           // crea createdAt/updatedAt
  versionKey: false,
  strict: true                // en dev puedes usar 'throw' para detectar campos fuera de schema
});

module.exports = model('NewInvitation', InvitationSchema);