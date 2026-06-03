const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { getSetting, getSettingNumber } = require('../services/settings');

const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.startsWith('Bearer ')
            ? authHeader.slice(7)
            : req.cookies?.token;

        if (!token) {
            return res.status(401).json({ success: false, message: 'Access denied. Please log in.' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const result = await query(
            'SELECT id, full_name, email, phone, role, is_active, is_banned FROM users WHERE id = $1',
            [decoded.id]
        );

        if (!result.rows[0]) {
            return res.status(401).json({ success: false, message: 'User not found.' });
        }

        const user = result.rows[0];
        if (!user.is_active) return res.status(403).json({ success: false, message: 'Account deactivated.' });
        if (user.is_banned) return res.status(403).json({ success: false, message: 'Account banned.' });

        req.user = user;
        next();
    } catch (err) {
        if (err.name === 'JsonWebTokenError') return res.status(401).json({ success: false, message: 'Invalid token.' });
        if (err.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
        console.error('Auth middleware error:', err);
        res.status(500).json({ success: false, message: 'Authentication error.' });
    }
};

const requireAdmin = (req, res, next) => {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'moderator')) {
        return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    next();
};

const requireSubscription = async (req, res, next) => {
    try {
        if (req.user.role === 'admin' || req.user.role === 'moderator') return next();

        const paidEnabled = await getSetting('paid_posting_enabled', 'true');
        if (paidEnabled === 'false') return next();

        const freePostsAllowed = await getSettingNumber('free_posts_per_user', 2);

        const postCountResult = await query(
            `SELECT COUNT(*) FROM products WHERE user_id = $1 AND status != 'deleted'`,
            [req.user.id]
        );
        const userPostCount = parseInt(postCountResult.rows[0].count) || 0;

        // ── Free posts allowance ──────────────────────────────────────────────
        if (freePostsAllowed > 0 && userPostCount < freePostsAllowed) {
            req.freePost = true;
            req.freePostsRemaining = freePostsAllowed - userPostCount - 1;
            return next();
        }

        // ── Active monthly subscription ───────────────────────────────────────
        const subResult = await query(
            `SELECT status, expires_at FROM subscriptions
             WHERE user_id = $1 AND status = 'active' AND expires_at > NOW()`,
            [req.user.id]
        );
        if (subResult.rows[0]) {
            req.subscription = subResult.rows[0];
            return next();
        }

        // ── Shop unlock: paid KES 300 to post up to 100 products via shop ─────
        const shopUnlock = await query(
            `SELECT COUNT(*) FROM payments
             WHERE user_id = $1 AND payment_type = 'shop_unlock' AND status = 'completed'`,
            [req.user.id]
        );
        if (parseInt(shopUnlock.rows[0].count) > 0) {
            const shopPostLimit = 100;
            if (userPostCount < shopPostLimit) {
                req.shopUnlock = true;
                req.shopPostsRemaining = shopPostLimit - userPostCount - 1;
                return next();
            }
            return res.status(403).json({
                success: false,
                message: `You have reached the 100-product limit for your shop. Upgrade to a monthly membership to post more.`,
                requiresSubscription: true,
                shopLimitReached: true
            });
        }

        // ── Nothing qualifies — require payment ───────────────────────────────
        const fee = await getSetting('posting_fee', '100');
        const freeMsg = freePostsAllowed > 0
            ? ` You have used your ${freePostsAllowed} free post${freePostsAllowed > 1 ? 's' : ''}.`
            : '';
        return res.status(403).json({
            success: false,
            message: `Active membership required to post more listings.${freeMsg} Pay KES ${fee}/month or KES 300 for a shop (up to 100 products).`,
            requiresSubscription: true
        });
    } catch (err) {
        console.error('Subscription check error:', err);
        res.status(500).json({ success: false, message: 'Could not verify membership status.' });
    }
};

const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.startsWith('Bearer ')
            ? authHeader.slice(7)
            : req.cookies?.token;
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const result = await query(
                'SELECT id, full_name, email, phone, role FROM users WHERE id = $1 AND is_active = true',
                [decoded.id]
            );
            if (result.rows[0]) req.user = result.rows[0];
        }
    } catch {}
    next();
};

module.exports = { authenticate, requireAdmin, requireSubscription, optionalAuth };
