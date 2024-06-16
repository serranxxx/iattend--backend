/*
    Rutas de Usuarios / Auth
    host + /api/auth
*/

const { Router } = require('express');
const { getImageById, deleteImageById, uploadImage, updateImage, copyFiles } = require('../controllers/images');
const { validarJWT } = require('../middlewares/validar-jwt');
const multer = require('multer')


const fileFilter = (req, file, cb) => {
    //Reject 
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image.jpg' || file.mimetype === 'image.png') {
        cb(null, true);
    } else {
        cb(null, false);
    }
}

const storageSingle = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, './drafts/');
    },
    filename: function (req, file, cb) {
        cb(null, `${req.params.id}-${file.fieldname}.jpg`);
    }
})

const storageGallery = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, './drafts/');
    },
    filename: function (req, file, cb) {
        cb(null, `${req.params.id}-${file.fieldname}-${req.params.posicion}.jpg`);
    }
})

const storageDressCode = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, './drafts/');
    },
    filename: function (req, file, cb) {
        cb(null, `${req.params.id}-${file.fieldname}-${req.params.posicion}.jpg`);
    }
})

const uploadFeatured = multer({
    storage: storageSingle,
    limits: {
        fileSize: 1024 * 1024 * 5
    },
    fileFilter: fileFilter
})

const uploadGallery = multer({
    storage: storageGallery,
    limits: {
        fileSize: 1024 * 1024 * 5
    },
    fileFilter: fileFilter
})

const uploadDresscode = multer({
    storage: storageDressCode,
    limits: {
        fileSize: 1024 * 1024 * 5
    },
    fileFilter: fileFilter
})




const router = Router();


router.post('/draft/:id', uploadFeatured.single('featured',), updateImage);
router.post('/draft/gallery/:id/:posicion', uploadGallery.single('gallery',), updateImage);
router.post('/draft/dresscode/:id/:posicion', uploadDresscode.single('dresscode',), updateImage);
router.post('/copy/:id', copyFiles)




module.exports = router;



