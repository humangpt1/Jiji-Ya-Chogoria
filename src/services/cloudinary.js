const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const path = require('path');

// ─── Multi-Cloudinary configs (round-robin for auto-scaling) ─────────────────
const CLOUDINARY_CONFIGS = [];
for (let i = 1; i <= 5; i++) {
    const suffix = i === 1 ? '' : `_${i}`;
    const name = process.env[`CLOUDINARY_CLOUD_NAME${suffix}`];
    const key  = process.env[`CLOUDINARY_API_KEY${suffix}`];
    const sec  = process.env[`CLOUDINARY_API_SECRET${suffix}`];
    if (name && key && sec) {
        CLOUDINARY_CONFIGS.push({ cloud_name: name, api_key: key, api_secret: sec });
    }
}

const useCloudinary = CLOUDINARY_CONFIGS.length > 0;

// Configure primary cloudinary instance
if (useCloudinary) {
    cloudinary.config(CLOUDINARY_CONFIGS[0]);
}

// Round-robin counter
let rrIndex = 0;

// ─── Multer Storage ───────────────────────────────────────────────────────────
const storage = useCloudinary
    ? new CloudinaryStorage({
        cloudinary,
        params: async (req, file) => {
            // Switch cloudinary config in round-robin (single-threaded, safe)
            if (CLOUDINARY_CONFIGS.length > 1) {
                const cfg = CLOUDINARY_CONFIGS[rrIndex % CLOUDINARY_CONFIGS.length];
                rrIndex++;
                cloudinary.config(cfg);
            }
            return {
                folder: 'jiji-ya-chogoria/products',
                allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
                transformation: [
                    { width: 1200, height: 1200, crop: 'limit', quality: 'auto:good', fetch_format: 'auto' }
                ],
                public_id: `product-${Date.now()}-${Math.round(Math.random() * 1e6)}`
            };
        }
    })
    : multer.diskStorage({
        destination: (req, file, cb) => cb(null, 'uploads/'),
        filename: (req, file, cb) => {
            cb(null, `product-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`);
        }
    });

const fileFilter = (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only JPEG, PNG, and WebP images are allowed.'));
    }
};

const upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter
});

const deleteImage = async (publicId) => {
    if (!useCloudinary || !publicId) return;
    try { await cloudinary.uploader.destroy(publicId); }
    catch (err) { console.error('Cloudinary delete error:', err.message); }
};

const getImageUrl = (file) => {
    if (!file) return null;
    if (useCloudinary && file.path) return { url: file.path, public_id: file.filename };
    return { url: `/uploads/${file.filename}`, public_id: null };
};

module.exports = { upload, deleteImage, getImageUrl, cloudinary, useCloudinary };
