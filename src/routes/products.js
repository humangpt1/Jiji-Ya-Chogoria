const router = require('express').Router();
const { authenticate, requireSubscription, optionalAuth } = require('../middleware/auth');
const {
    createProduct, productValidation, getProducts, getProduct,
    updateProduct, deleteProduct, getUserProducts,
    toggleFavorite, getFavorites, getCategories, reportProduct, getFeaturedProducts
} = require('../controllers/productController');
const { upload } = require('../services/cloudinary');

router.get('/categories', getCategories);
router.get('/featured', getFeaturedProducts);
router.get('/', optionalAuth, getProducts);
router.get('/my', authenticate, getUserProducts);
router.get('/favorites', authenticate, getFavorites);
router.get('/:id', optionalAuth, getProduct);

router.post('/', authenticate, requireSubscription, upload.array('images', 6), productValidation, createProduct);
router.put('/:id', authenticate, requireSubscription, upload.array('images', 6), updateProduct);
router.delete('/:id', authenticate, deleteProduct);
router.post('/:id/favorite', authenticate, toggleFavorite);
router.post('/:id/report', authenticate, reportProduct);

module.exports = router;
