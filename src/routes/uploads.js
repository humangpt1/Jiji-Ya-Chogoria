const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { upload, getImageUrl } = require('../services/cloudinary');

// Pre-upload images to Cloudinary (before product form submit)
router.post('/images', authenticate, (req, res, next) => {
    upload.array('images', 6)(req, res, err => {
        if (err) return res.status(400).json({ success: false, message: err.message || 'Upload failed.' });
        next();
    });
}, async (req, res) => {
    try {
        const images = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const img = getImageUrl(file);
                if (img) images.push(img);
            }
        }
        if (!images.length) {
            return res.status(400).json({ success: false, message: 'No images were uploaded.' });
        }
        res.json({ success: true, images });
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ success: false, message: 'Image upload failed.' });
    }
});

// Clean up orphaned Cloudinary images
router.post('/cleanup', authenticate, async (req, res) => {
    const { public_ids } = req.body;
    if (!Array.isArray(public_ids) || public_ids.length === 0) {
        return res.json({ success: true });
    }
    try {
        const cloudinary = require('cloudinary').v2;
        const ids = public_ids.slice(0, 10).filter(id => typeof id === 'string' && id.trim().length > 0);
        if (ids.length > 0) {
            await cloudinary.api.delete_resources(ids);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Cleanup error:', err.message);
        res.json({ success: true });
    }
});

module.exports = router;
