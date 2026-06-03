const router = require('express').Router();
const { subscribe, unsubscribe, getSubscribers } = require('../controllers/newsletterController');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.post('/subscribe', subscribe);
router.post('/unsubscribe', unsubscribe);
router.get('/subscribers', authenticate, requireAdmin, getSubscribers);

module.exports = router;
