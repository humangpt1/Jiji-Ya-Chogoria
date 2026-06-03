const router = require('express').Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { getMessages, sendMessage, deleteMessage } = require('../controllers/chatController');

router.get('/', getMessages);
router.post('/', authenticate, sendMessage);
router.delete('/:id', authenticate, deleteMessage);

module.exports = router;
