const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const {
    getConversations,
    startConversation,
    getMessages,
    sendMessage,
    getUnreadCount
} = require('../controllers/dmController');

router.get('/', authenticate, getConversations);
router.post('/', authenticate, startConversation);
router.get('/unread', authenticate, getUnreadCount);
router.get('/:id/messages', authenticate, getMessages);
router.post('/:id/messages', authenticate, sendMessage);

module.exports = router;
