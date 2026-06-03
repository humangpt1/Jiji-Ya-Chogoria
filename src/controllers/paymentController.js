const { body } = require('express-validator');
const { query } = require('../config/db');
const { initiateSTKPush, parseCallback } = require('../services/megapay');
const { validate } = require('../middleware/validate');
const { getSettingNumber } = require('../services/settings');

// ── Validation ────────────────────────────────────────────────────────────────
const initiatePaymentValidation = [
    body('phone').trim().notEmpty().withMessage('Phone number required')
        .matches(/^(\+254|0)[17]\d{8}$/).withMessage('Enter a valid Kenyan phone number (e.g. 0712345678)'),
    validate
];

const initiateBoostValidation = [
    body('phone').trim().notEmpty().withMessage('Phone number required')
        .matches(/^(\+254|0)[17]\d{8}$/).withMessage('Enter a valid Kenyan phone number'),
    body('product_id').notEmpty().withMessage('Product ID is required'),
    body('amount').isInt({ min: 300 }).withMessage('Minimum boost amount is KES 300'),
    validate
];

// ── Initiate Subscription Payment ────────────────────────────────────────────
const initiatePayment = async (req, res) => {
    try {
        const { phone } = req.body;
        const userId = req.user.id;
        const amount = await getSettingNumber('posting_fee', 100);

        const subCheck = await query(
            `SELECT status, expires_at FROM subscriptions
             WHERE user_id = $1 AND status = 'active' AND expires_at > NOW()`,
            [userId]
        );
        if (subCheck.rows[0]) {
            return res.status(400).json({
                success: false,
                message: `You already have an active membership until ${new Date(subCheck.rows[0].expires_at).toLocaleDateString('en-KE')}.`
            });
        }

        const pendingCheck = await query(
            `SELECT id FROM payments
             WHERE user_id = $1 AND status = 'pending' AND payment_type = 'subscription'
             AND created_at > NOW() - INTERVAL '5 minutes'`,
            [userId]
        );
        if (pendingCheck.rows[0]) {
            return res.status(429).json({
                success: false,
                message: 'A payment is already being processed. Please wait a moment.'
            });
        }

        // Create a pending payment record first (we use its id as the reference)
        const pendingPayment = await query(
            `INSERT INTO payments (user_id, phone_number, amount, status, payment_type)
             VALUES ($1, $2, $3, 'pending', 'subscription') RETURNING id`,
            [userId, phone, amount]
        );
        const paymentId = pendingPayment.rows[0].id;

        // Initiate MegaPay STK Push with payment id as reference
        const stkResponse = await initiateSTKPush({
            phone,
            amount,
            reference: paymentId
        });

        // Update record with transaction_request_id from MegaPay
        await query(
            `UPDATE payments SET megapay_request_id = $1, updated_at = NOW() WHERE id = $2`,
            [stkResponse.transaction_request_id, paymentId]
        );

        await query(
            `INSERT INTO notifications (user_id, type, title, message)
             VALUES ($1, 'payment_initiated', 'Payment Initiated', $2)`,
            [userId, `MegaPay STK push sent to ${phone}. Enter your M-Pesa PIN to complete payment of KES ${amount}.`]
        );

        res.json({
            success: true,
            message: `M-Pesa prompt sent to ${phone}. Enter your PIN to complete.`,
            paymentId,
            transactionRequestId: stkResponse.transaction_request_id
        });
    } catch (err) {
        console.error('Initiate payment error:', err.response?.data || err.message);
        res.status(500).json({
            success: false,
            message: err.message || 'Payment initiation failed. Please try again.'
        });
    }
};

// ── Initiate Boost Payment ───────────────────────────────────────────────────
const initiateBoost = async (req, res) => {
    try {
        const { phone, product_id, amount } = req.body;
        const userId = req.user.id;
        const boostAmount = Math.max(300, parseInt(amount) || 300);

        const productCheck = await query(
            `SELECT id, title, user_id, status FROM products WHERE id = $1`,
            [product_id]
        );
        if (!productCheck.rows[0]) {
            return res.status(404).json({ success: false, message: 'Listing not found.' });
        }
        if (productCheck.rows[0].user_id !== userId) {
            return res.status(403).json({ success: false, message: 'You can only boost your own listings.' });
        }
        if (productCheck.rows[0].status !== 'active') {
            return res.status(400).json({ success: false, message: 'Only active listings can be boosted.' });
        }

        const pendingCheck = await query(
            `SELECT id FROM payments
             WHERE user_id = $1 AND product_id = $2 AND status = 'pending'
             AND created_at > NOW() - INTERVAL '5 minutes'`,
            [userId, product_id]
        );
        if (pendingCheck.rows[0]) {
            return res.status(429).json({ success: false, message: 'A boost payment is already pending for this listing.' });
        }

        const pendingPayment = await query(
            `INSERT INTO payments (user_id, phone_number, amount, status, payment_type, product_id)
             VALUES ($1, $2, $3, 'pending', 'boost', $4) RETURNING id`,
            [userId, phone, boostAmount, product_id]
        );
        const paymentId = pendingPayment.rows[0].id;

        const stkResponse = await initiateSTKPush({
            phone,
            amount: boostAmount,
            reference: paymentId
        });

        await query(
            `UPDATE payments SET megapay_request_id = $1, updated_at = NOW() WHERE id = $2`,
            [stkResponse.transaction_request_id, paymentId]
        );

        res.json({
            success: true,
            message: `M-Pesa prompt sent to ${phone}. Enter your PIN to boost your listing.`,
            paymentId,
            transactionRequestId: stkResponse.transaction_request_id
        });
    } catch (err) {
        console.error('Initiate boost error:', err.response?.data || err.message);
        res.status(500).json({
            success: false,
            message: err.message || 'Boost payment failed. Please try again.'
        });
    }
};

// ── MegaPay Webhook Callback ─────────────────────────────────────────────────
const megapayCallback = async (req, res) => {
    // Respond immediately so MegaPay doesn't retry
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

    try {
        console.log('MegaPay callback received:', JSON.stringify(req.body));

        const cb = parseCallback(req.body);
        if (!cb.reference) {
            console.error('MegaPay callback missing reference');
            return;
        }

        const paymentResult = await query(
            `SELECT p.*, u.id as uid FROM payments p
             JOIN users u ON u.id = p.user_id WHERE p.id = $1`,
            [cb.reference]
        );

        if (!paymentResult.rows[0]) {
            console.error('Payment not found for reference:', cb.reference);
            return;
        }

        const payment = paymentResult.rows[0];

        if (cb.success) {
            // Payment successful
            await query(
                `UPDATE payments SET
                    status = 'completed',
                    megapay_receipt = $1,
                    megapay_transaction_id = $2,
                    raw_callback = $3,
                    updated_at = NOW()
                 WHERE id = $4`,
                [cb.receipt, cb.transactionId, JSON.stringify(req.body), payment.id]
            );

            if (payment.payment_type === 'boost' && payment.product_id) {
                await _processBoost(payment, cb.receipt);
            } else if (payment.payment_type === 'shop_unlock') {
                await _processShopUnlock(payment, cb.receipt);
            } else {
                await _processSubscription(payment, cb.receipt);
            }
        } else {
            // Payment failed
            await query(
                `UPDATE payments SET
                    status = 'failed',
                    failure_reason = $1,
                    raw_callback = $2,
                    updated_at = NOW()
                 WHERE id = $3`,
                [cb.description || 'Payment declined', JSON.stringify(req.body), payment.id]
            );

            await query(
                `INSERT INTO notifications (user_id, type, title, message)
                 VALUES ($1, 'payment_failed', 'Payment Failed', $2)`,
                [payment.user_id, `Payment failed: ${cb.description || 'Transaction declined'}. Please try again.`]
            );
        }
    } catch (err) {
        console.error('MegaPay callback processing error:', err);
    }
};

async function _processShopUnlock(payment, receipt) {
    await query(
        `INSERT INTO notifications (user_id, type, title, message, metadata)
         VALUES ($1, 'shop_unlocked', 'Shop Unlocked! 🏪', $2, $3)`,
        [
            payment.user_id,
            `Your shop is now unlocked! You can post up to 100 products. Receipt: ${receipt}`,
            JSON.stringify({ receipt })
        ]
    );
    console.log(`Shop unlock successful: ${receipt} for user ${payment.user_id}`);
}

async function _processBoost(payment, receipt) {
    await query(
        `UPDATE products
         SET featured = true,
             featured_amount = COALESCE(featured_amount, 0) + $1,
             updated_at = NOW()
         WHERE id = $2`,
        [payment.amount, payment.product_id]
    );

    const prod = await query('SELECT title FROM products WHERE id = $1', [payment.product_id]);

    await query(
        `INSERT INTO notifications (user_id, type, title, message, metadata)
         VALUES ($1, 'boost_activated', 'Listing Boosted! 🚀', $2, $3)`,
        [
            payment.user_id,
            `Your listing "${prod.rows[0]?.title}" is now featured! KES ${payment.amount} boost applied.`,
            JSON.stringify({ product_id: payment.product_id, receipt })
        ]
    );

    console.log(`Boost successful: ${receipt} for product ${payment.product_id}`);
}

async function _processSubscription(payment, receipt) {
    const days = await getSettingNumber('subscription_days', 30);
    const existingSub = await query(
        `SELECT id, status, expires_at FROM subscriptions WHERE user_id = $1`,
        [payment.user_id]
    );

    let newExpiry;
    if (existingSub.rows[0]?.status === 'active' && new Date(existingSub.rows[0].expires_at) > new Date()) {
        newExpiry = new Date(existingSub.rows[0].expires_at);
        newExpiry.setDate(newExpiry.getDate() + days);
    } else {
        newExpiry = new Date();
        newExpiry.setDate(newExpiry.getDate() + days);
    }

    await query(
        `INSERT INTO subscriptions (user_id, status, started_at, expires_at, amount_paid)
         VALUES ($1, 'active', NOW(), $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET
             status = 'active', started_at = NOW(), expires_at = $2,
             amount_paid = $3, updated_at = NOW()`,
        [payment.user_id, newExpiry, payment.amount]
    );

    const sub = await query('SELECT id FROM subscriptions WHERE user_id = $1', [payment.user_id]);
    await query(
        'UPDATE payments SET subscription_id = $1 WHERE id = $2',
        [sub.rows[0]?.id, payment.id]
    );

    await query(
        `INSERT INTO notifications (user_id, type, title, message, metadata)
         VALUES ($1, 'subscription_activated', 'Membership Activated! ✅', $2, $3)`,
        [
            payment.user_id,
            `Your membership is active until ${newExpiry.toLocaleDateString('en-KE')}. You can now post listings!`,
            JSON.stringify({ receipt, expires_at: newExpiry })
        ]
    );

    console.log(`Subscription activated: ${receipt} for user ${payment.user_id}, expires ${newExpiry}`);
}

// ── Check Payment Status (polling) ───────────────────────────────────────────
const checkPaymentStatus = async (req, res) => {
    try {
        const { paymentId } = req.params;

        const result = await query(
            `SELECT status, megapay_receipt, amount, payment_type, product_id, created_at, failure_reason
             FROM payments WHERE id = $1 AND user_id = $2`,
            [paymentId, req.user.id]
        );

        if (!result.rows[0]) {
            return res.status(404).json({ success: false, message: 'Payment not found.' });
        }

        const payment = result.rows[0];

        // Auto-expire pending payments older than 3 minutes
        if (payment.status === 'pending') {
            const age = Date.now() - new Date(payment.created_at).getTime();
            if (age > 180000) {
                await query(
                    `UPDATE payments SET status = 'failed', failure_reason = 'Payment timed out' WHERE id = $1`,
                    [paymentId]
                );
                payment.status = 'failed';
                payment.failure_reason = 'Payment timed out';
            }
        }

        const sub = await query(
            `SELECT status, expires_at FROM subscriptions WHERE user_id = $1`,
            [req.user.id]
        );

        res.json({
            success: true,
            payment: {
                status: payment.status,
                receipt: payment.megapay_receipt,
                amount: payment.amount,
                payment_type: payment.payment_type,
                product_id: payment.product_id,
                failure_reason: payment.failure_reason
            },
            subscription: sub.rows[0] || null
        });
    } catch (err) {
        console.error('Check payment status error:', err);
        res.status(500).json({ success: false, message: 'Could not check payment status.' });
    }
};

// ── Payment History ───────────────────────────────────────────────────────────
const getPaymentHistory = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, parseInt(req.query.limit) || 10);
        const offset = (page - 1) * limit;

        const result = await query(
            `SELECT p.id, p.phone_number, p.amount, p.status, p.megapay_receipt,
                    p.payment_type, p.failure_reason, p.created_at, pr.title as product_title
             FROM payments p
             LEFT JOIN products pr ON pr.id = p.product_id
             WHERE p.user_id = $1
             ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
            [req.user.id, limit, offset]
        );

        const count = await query('SELECT COUNT(*) FROM payments WHERE user_id = $1', [req.user.id]);

        res.json({
            success: true,
            payments: result.rows,
            pagination: {
                page, limit,
                total: parseInt(count.rows[0].count),
                pages: Math.ceil(count.rows[0].count / limit)
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not fetch payment history.' });
    }
};

// ── Subscription Status ───────────────────────────────────────────────────────
const getSubscriptionStatus = async (req, res) => {
    try {
        const result = await query(
            `SELECT s.status, s.expires_at, s.started_at, s.amount_paid,
                    EXTRACT(EPOCH FROM (s.expires_at - NOW())) / 86400 as days_remaining
             FROM subscriptions s WHERE s.user_id = $1`,
            [req.user.id]
        );

        const sub = result.rows[0];
        const isActive = sub && sub.status === 'active' && new Date(sub.expires_at) > new Date();

        res.json({
            success: true,
            subscription: sub ? {
                status: isActive ? 'active' : 'expired',
                expires_at: sub.expires_at,
                started_at: sub.started_at,
                days_remaining: isActive ? Math.ceil(sub.days_remaining) : 0,
                amount_paid: sub.amount_paid
            } : { status: 'none' }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not fetch subscription status.' });
    }
};

// ── Initiate Shop Unlock Payment (KES 300 one-time, up to 100 products) ──────
const initiateShopUnlockValidation = [
    body('phone').trim().notEmpty().withMessage('Phone number required')
        .matches(/^(\+254|0)[17]\d{8}$/).withMessage('Enter a valid Kenyan phone number (e.g. 0712345678)'),
    validate
];

const initiateShopUnlock = async (req, res) => {
    try {
        const { phone } = req.body;
        const userId = req.user.id;
        const amount = 300;

        const already = await query(
            `SELECT id FROM payments WHERE user_id = $1 AND payment_type = 'shop_unlock' AND status = 'completed'`,
            [userId]
        );
        if (already.rows[0]) {
            return res.status(400).json({
                success: false,
                message: 'You have already unlocked your shop. You can post up to 100 products.'
            });
        }

        const pending = await query(
            `SELECT id FROM payments WHERE user_id = $1 AND payment_type = 'shop_unlock' AND status = 'pending'
             AND created_at > NOW() - INTERVAL '5 minutes'`,
            [userId]
        );
        if (pending.rows[0]) {
            return res.status(429).json({ success: false, message: 'A shop unlock payment is already being processed.' });
        }

        const pay = await query(
            `INSERT INTO payments (user_id, phone_number, amount, status, payment_type)
             VALUES ($1, $2, $3, 'pending', 'shop_unlock') RETURNING id`,
            [userId, phone, amount]
        );
        const paymentId = pay.rows[0].id;

        const stkResponse = await initiateSTKPush({ phone, amount, reference: paymentId });
        await query(
            `UPDATE payments SET megapay_request_id = $1, updated_at = NOW() WHERE id = $2`,
            [stkResponse.transaction_request_id, paymentId]
        );

        res.json({
            success: true,
            message: `M-Pesa prompt sent to ${phone}. Pay KES 300 to unlock your shop (100 products).`,
            paymentId,
            transactionRequestId: stkResponse.transaction_request_id
        });
    } catch (err) {
        console.error('Shop unlock error:', err.response?.data || err.message);
        res.status(500).json({ success: false, message: err.message || 'Payment initiation failed. Please try again.' });
    }
};

module.exports = {
    initiatePayment, initiatePaymentValidation,
    initiateBoost, initiateBoostValidation,
    initiateShopUnlock, initiateShopUnlockValidation,
    megapayCallback, checkPaymentStatus,
    getPaymentHistory, getSubscriptionStatus
};
