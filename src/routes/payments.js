const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const {
    initiatePayment, initiatePaymentValidation,
    initiateBoost, initiateBoostValidation,
    initiateShopUnlock, initiateShopUnlockValidation,
    megapayCallback, checkPaymentStatus,
    getPaymentHistory, getSubscriptionStatus
} = require('../controllers/paymentController');

router.post('/initiate', authenticate, initiatePaymentValidation, initiatePayment);
router.post('/boost', authenticate, initiateBoostValidation, initiateBoost);
router.post('/shop-unlock', authenticate, initiateShopUnlockValidation, initiateShopUnlock);
router.post('/megapay-callback', megapayCallback);
router.get('/status/:paymentId', authenticate, checkPaymentStatus);
router.get('/history', authenticate, getPaymentHistory);
router.get('/subscription', authenticate, getSubscriptionStatus);

module.exports = router;
