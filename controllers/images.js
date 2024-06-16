const Image = require('../models/images');
const fs = require('fs');
const path = require('path');


// Obtener una imagen por su ID (userID)
const getImageById = async (req, res) => {
    const { id } = req.params;
    try {
        const image = await Image.findOne({ userID: id });
        if (!image) {
            return res.status(404).json({ message: 'Imagen no encontrada' });
        }
        res.status(200).json(image);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener la imagen', error: error.message });
    }
};

const uploadImage = async (req, res) => {
    try {
        const { userID } = req.body;

        // Crear un array para almacenar los paths de la galería
        const galleryPaths = [];

        // Agregar el path de la imagen principal (featured)
        const featuredPath = req.files['featured'][0].path;

        // Recorrer los archivos de la galería para obtener sus paths
        req.files['gallery'].forEach(file => {
            galleryPaths.push(file.path);
        });

        // Crear un nuevo documento de imagen con los paths
        const image = new Image({
            userID: userID,
            featured: featuredPath,
            gallery: galleryPaths
        });

        // Guardar el documento en la base de datos
        await image.save();

        res.status(201).json({
            ok: true,
            msg: 'Image added',
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            ok: false,
            msg: error.message // Utiliza error.message para obtener un mensaje de error más detallado
        });
    }
};

const updateImage = async (req, res) => {
    try {

        return res.json({
            ok: true,
            msg: 'Images updated',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            ok: false,
            msg: 'Internal Server Error',
        });
    }
};

// Eliminar una imagen por su ID (userID)
const deleteImageById = async (req, res) => {
    const { id } = req.params;
    try {
        const image = await Image.findOneAndDelete({ userID: id });
        if (!image) {
            return res.status(404).json({ message: 'Imagen no encontrada' });
        }
        res.status(200).json({ message: 'Imagen eliminada exitosamente', image });
    } catch (error) {
        res.status(500).json({ message: 'Error al eliminar la imagen', error: error.message });
    }
};

const copyFiles = async (req, res) => {
    const { id } = req.params;
    const draftsDir = './drafts';
    const uploadsDir = './uploads';


    // Leer el contenido de la carpeta "drafts"
    fs.readdir(draftsDir, (err, files) => {
        if (err) {
            console.error('Error reading "drafts" directory:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }

        // Filtrar los archivos que comiencen con el userID
        const userFiles = files.filter(file => {
            return file.startsWith(id);
        });

        // Copiar cada archivo seleccionado a la carpeta "uploads"
        userFiles.forEach(file => {
            const sourcePath = path.join(draftsDir, file);
            const destPath = path.join(uploadsDir, file);

            fs.copyFile(sourcePath, destPath, err => {
                if (err) {
                    console.error(`Error copying file "${file}" to "uploads" directory:`, err);
                } else {
                    console.log(`File "${file}" copied to "uploads" directory successfully.`);
                }
            });
        });

        res.json({ msg: 'Files copied successfully' });
    });
}

module.exports = {
    getImageById,
    uploadImage,
    updateImage,
    deleteImageById,
    copyFiles
};
