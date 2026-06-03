const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
    getDashboard, getPendingProducts, moderateProduct, flagProduct,
    getUsers, banUser, getReports, resolveReport, dismissReport, getAllPayments,
    getSettings, updateSetting, promoteUserByPhone
} = require('../controllers/adminController');

router.use(authenticate, requireAdmin);

router.get('/dashboard', getDashboard);
router.get('/products/pending', getPendingProducts);
router.put('/products/:id/moderate', moderateProduct);
router.put('/products/:id/flag', flagProduct);
router.get('/users', getUsers);
router.put('/users/:id/ban', banUser);
router.post('/users/promote', promoteUserByPhone);
router.get('/reports', getReports);
router.put('/reports/:id', resolveReport);
router.delete('/reports/:id', dismissReport);
router.get('/payments', getAllPayments);
router.get('/settings', getSettings);
router.put('/settings/:key', updateSetting);

module.exports = router;
