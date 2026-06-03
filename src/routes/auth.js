const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const {
    register, registerValidation,
    login, loginValidation,
    googleAuth, getMe, updateProfile, changePassword
} = require('../controllers/authController');
const { forgotPassword, resetPassword } = require('../controllers/resetController');

router.post('/register', registerValidation, register);
router.post('/login', loginValidation, login);
router.post('/google', googleAuth);
router.get('/google-client-id', (req, res) => res.json({ clientId: process.env.GOOGLE_CLIENT_ID || null }));
router.get('/me', authenticate, getMe);
router.put('/profile', authenticate, updateProfile);
router.put('/change-password', authenticate, changePassword);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

module.exports = router;
