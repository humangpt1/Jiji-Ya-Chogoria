const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { getNotifications, markRead } = require('../controllers/notificationController');

router.get('/', authenticate, getNotifications);
router.put('/:id/read', authenticate, markRead);

module.exports = router;
