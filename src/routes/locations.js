const express = require('express');
const router = express.Router();
const { getLocations, saveUserLocation, getNearbyProducts } = require('../controllers/locationController');
const { authenticate } = require('../middleware/auth');

router.get('/', getLocations);
router.post('/save', authenticate, saveUserLocation);
router.get('/nearby-products', getNearbyProducts);

module.exports = router;
