const router = require('express').Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { upload } = require('../services/cloudinary');
const {
    createShop, getShops, getShop, getMyShops, updateShop, deleteShop
} = require('../controllers/shopController');

const shopUpload = upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'cover', maxCount: 1 }
]);

router.get('/', optionalAuth, getShops);
router.get('/my', authenticate, getMyShops);
router.get('/:id', optionalAuth, getShop);
router.post('/', authenticate, shopUpload, createShop);
router.put('/:id', authenticate, shopUpload, updateShop);
router.delete('/:id', authenticate, deleteShop);

module.exports = router;
