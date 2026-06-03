const { query } = require('../config/db');
const { getAllSettings, setSetting } = require('../services/settings');

const ALLOWED_SETTINGS = [
    'posting_fee', 'subscription_days', 'min_boost_amount',
    'paid_posting_enabled', 'free_posts_per_user',
    'apk_url', 'apk_version', 'site_announcement'
];

const getSettings = async (req, res) => {
    try {
        const settings = await getAllSettings();
        res.json({ success: true, settings });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not fetch settings.' });
    }
};

const updateSetting = async (req, res) => {
    try {
        const { key } = req.params;
        const { value } = req.body;

        if (!ALLOWED_SETTINGS.includes(key)) {
            return res.status(400).json({ success: false, message: 'Unknown setting key.' });
        }
        if (value === undefined || value === null || String(value).trim() === '') {
            return res.status(400).json({ success: false, message: 'Value is required.' });
        }

        const numericKeys = ['posting_fee', 'subscription_days', 'min_boost_amount', 'free_posts_per_user'];
        if (numericKeys.includes(key)) {
            const n = Number(value);
            if (!Number.isFinite(n) || n < 0) {
                return res.status(400).json({ success: false, message: 'Value must be a non-negative number.' });
            }
        }

        await setSetting(key, value, req.user.id);

        await query(
            `INSERT INTO admin_logs (admin_id, action, target_type, details)
             VALUES ($1, 'update_setting', 'setting', $2)`,
            [req.user.id, JSON.stringify({ key, value: String(value) })]
        );

        res.json({ success: true, message: `${key} updated to ${value}.` });
    } catch (err) {
        console.error('Update setting error:', err);
        res.status(500).json({ success: false, message: 'Could not update setting.' });
    }
};

const promoteUserByPhone = async (req, res) => {
    try {
        const { phone, role } = req.body;
        const newRole = role || 'admin';

        if (!['user', 'admin', 'moderator'].includes(newRole)) {
            return res.status(400).json({ success: false, message: 'Role must be user, admin, or moderator.' });
        }
        if (!phone || !/^(\+254|0)[17]\d{8}$/.test(String(phone).trim())) {
            return res.status(400).json({ success: false, message: 'Enter a valid Kenyan phone number.' });
        }

        const normalized = String(phone).trim();
        const altFormats = [normalized];
        if (normalized.startsWith('0')) altFormats.push('+254' + normalized.slice(1));
        if (normalized.startsWith('+254')) altFormats.push('0' + normalized.slice(4));

        const userResult = await query(
            `SELECT id, full_name, phone, role FROM users WHERE phone = ANY($1::text[])`,
            [altFormats]
        );

        if (!userResult.rows[0]) {
            return res.status(404).json({ success: false, message: 'No user found with that phone number.' });
        }

        const user = userResult.rows[0];

        if (user.id === req.user.id && newRole !== 'admin') {
            return res.status(400).json({ success: false, message: 'You cannot demote yourself.' });
        }

        await query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [newRole, user.id]);

        await query(
            `INSERT INTO notifications (user_id, type, title, message)
             VALUES ($1, 'role_changed', 'Role Updated', $2)`,
            [user.id, `Your account role was changed to ${newRole} by an administrator.`]
        );

        await query(
            `INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
             VALUES ($1, 'change_role', 'user', $2, $3)`,
            [req.user.id, user.id, JSON.stringify({ phone: user.phone, from: user.role, to: newRole })]
        );

        res.json({
            success: true,
            message: `${user.full_name} (${user.phone}) is now ${newRole}.`,
            user: { id: user.id, full_name: user.full_name, phone: user.phone, role: newRole }
        });
    } catch (err) {
        console.error('Promote user error:', err);
        res.status(500).json({ success: false, message: 'Could not change user role.' });
    }
};

const getDashboard = async (req, res) => {
    try {
        const [users, products, payments, reports] = await Promise.all([
            query(`SELECT COUNT(*) as total,
                   COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as this_week,
                   COUNT(*) FILTER (WHERE is_banned = true) as banned
                   FROM users WHERE role = 'user'`),
            query(`SELECT COUNT(*) as total,
                   COUNT(*) FILTER (WHERE status = 'active') as active,
                   COUNT(*) FILTER (WHERE status = 'pending') as pending,
                   COUNT(*) FILTER (WHERE status = 'rejected') as rejected
                   FROM products WHERE status != 'deleted'`),
            query(`SELECT COUNT(*) as total,
                   SUM(amount) FILTER (WHERE status = 'completed') as total_revenue,
                   COUNT(*) FILTER (WHERE status = 'completed' AND created_at > NOW() - INTERVAL '30 days') as this_month,
                   SUM(amount) FILTER (WHERE status = 'completed' AND created_at > NOW() - INTERVAL '30 days') as month_revenue
                   FROM payments`),
            query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'pending') as pending FROM reports`)
        ]);

        res.json({
            success: true,
            stats: {
                users: users.rows[0],
                products: products.rows[0],
                payments: payments.rows[0],
                reports: reports.rows[0]
            }
        });
    } catch (err) {
        console.error('Admin dashboard error:', err);
        res.status(500).json({ success: false, message: 'Could not load dashboard.' });
    }
};

const getPendingProducts = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = 20;
        const offset = (page - 1) * limit;

        const result = await query(
            `SELECT p.*, c.name as category_name, u.full_name as seller_name, u.phone as seller_phone, u.email as seller_email
             FROM products p
             JOIN users u ON u.id = p.user_id
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE p.status = 'pending'
             ORDER BY p.created_at ASC
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        );

        const count = await query(`SELECT COUNT(*) FROM products WHERE status = 'pending'`);

        res.json({
            success: true,
            products: result.rows,
            pagination: { page, limit, total: parseInt(count.rows[0].count), pages: Math.ceil(count.rows[0].count / limit) }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not fetch pending listings.' });
    }
};

const moderateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const { action, reason } = req.body;

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Action must be approve or reject.' });
        }

        const product = await query(
            'SELECT user_id, title FROM products WHERE id = $1',
            [id]
        );
        if (!product.rows[0]) {
            return res.status(404).json({ success: false, message: 'Listing not found.' });
        }

        const newStatus = action === 'approve' ? 'active' : 'rejected';
        await query(
            `UPDATE products SET status = $1, rejection_reason = $2, updated_at = NOW() WHERE id = $3`,
            [newStatus, action === 'reject' ? reason : null, id]
        );

        const msg = action === 'approve'
            ? `Your listing "${product.rows[0].title}" has been approved and is now live!`
            : `Your listing "${product.rows[0].title}" was rejected. Reason: ${reason || 'Policy violation'}. Please edit and resubmit.`;

        await query(
            `INSERT INTO notifications (user_id, type, title, message)
             VALUES ($1, $2, $3, $4)`,
            [product.rows[0].user_id, `product_${action}d`, `Listing ${action === 'approve' ? 'Approved' : 'Rejected'}`, msg]
        );

        await query(
            `INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
             VALUES ($1, $2, 'product', $3, $4)`,
            [req.user.id, `product_${action}`, id, JSON.stringify({ reason })]
        );

        res.json({ success: true, message: `Listing ${action}d successfully.` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not moderate listing.' });
    }
};

const getUsers = async (req, res) => {
    try {
        const { search, role, status } = req.query;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = 20;
        const offset = (page - 1) * limit;

        const conditions = [];
        const params = [];
        let idx = 1;

        if (search) {
            conditions.push(`(u.full_name ILIKE $${idx} OR u.email ILIKE $${idx} OR u.phone ILIKE $${idx})`);
            params.push(`%${search}%`);
            idx++;
        }
        if (role) {
            conditions.push(`u.role = $${idx++}`);
            params.push(role);
        }
        if (status === 'banned') {
            conditions.push(`u.is_banned = true`);
        } else if (status === 'active') {
            conditions.push(`u.is_active = true AND u.is_banned = false`);
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const result = await query(
            `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_active, u.is_banned,
                    u.created_at, u.last_login, s.status as subscription_status, s.expires_at,
                    COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'active') as active_listings
             FROM users u
             LEFT JOIN subscriptions s ON s.user_id = u.id
             LEFT JOIN products p ON p.user_id = u.id
             ${whereClause}
             GROUP BY u.id, s.status, s.expires_at
             ORDER BY u.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
            [...params, limit, offset]
        );

        const count = await query(`SELECT COUNT(*) FROM users u ${whereClause}`, params);

        res.json({
            success: true,
            users: result.rows,
            pagination: { page, limit, total: parseInt(count.rows[0].count), pages: Math.ceil(count.rows[0].count / limit) }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not fetch users.' });
    }
};

const banUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { ban, reason } = req.body;

        if (id === req.user.id) {
            return res.status(400).json({ success: false, message: 'Cannot ban yourself.' });
        }

        await query(
            'UPDATE users SET is_banned = $1, ban_reason = $2 WHERE id = $3',
            [ban !== false, reason || 'Policy violation', id]
        );

        await query(
            `INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
             VALUES ($1, $2, 'user', $3, $4)`,
            [req.user.id, ban !== false ? 'ban_user' : 'unban_user', id, JSON.stringify({ reason })]
        );

        res.json({ success: true, message: `User ${ban !== false ? 'banned' : 'unbanned'} successfully.` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not update user status.' });
    }
};

const getReports = async (req, res) => {
    try {
        const { status } = req.query;
        const conditions = status ? [`r.status = $1`] : [];
        const params = status ? [status] : [];

        const result = await query(
            `SELECT r.*, u.full_name as reporter_name, p.title as product_title
             FROM reports r
             JOIN users u ON u.id = r.reporter_id
             LEFT JOIN products p ON p.id = r.product_id
             ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
             ORDER BY r.created_at DESC LIMIT 50`,
            params
        );

        res.json({ success: true, reports: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not fetch reports.' });
    }
};

const resolveReport = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        await query(
            'UPDATE reports SET status = $1, resolved_by = $2, updated_at = NOW() WHERE id = $3',
            [status || 'resolved', req.user.id, id]
        );
        res.json({ success: true, message: 'Report updated.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not update report.' });
    }
};

const dismissReport = async (req, res) => {
    try {
        const { id } = req.params;
        await query(
            'UPDATE reports SET status = $1, resolved_by = $2, updated_at = NOW() WHERE id = $3',
            ['dismissed', req.user.id, id]
        );
        res.json({ success: true, message: 'Report dismissed.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not dismiss report.' });
    }
};

const flagProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const { flag, reason } = req.body;
        const isFlagged = flag === true || flag === 'true';
        await query(
            `UPDATE products SET is_flagged = $1, flag_reason = $2, status = CASE WHEN $1 = true THEN 'rejected' ELSE status END WHERE id = $3`,
            [isFlagged, reason || null, id]
        );
        res.json({ success: true, message: isFlagged ? 'Product flagged and hidden.' : 'Product unflagged.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not flag product.' });
    }
};

const getAllPayments = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = 20;
        const offset = (page - 1) * limit;

        const result = await query(
            `SELECT pay.*, u.full_name, u.email, u.phone
             FROM payments pay JOIN users u ON u.id = pay.user_id
             ORDER BY pay.created_at DESC LIMIT $1 OFFSET $2`,
            [limit, offset]
        );

        const total = await query('SELECT COUNT(*), SUM(amount) FILTER (WHERE status = \'completed\') as revenue FROM payments');

        res.json({
            success: true,
            payments: result.rows,
            summary: total.rows[0],
            pagination: { page, limit, total: parseInt(total.rows[0].count) }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not fetch payments.' });
    }
};

module.exports = {
    getDashboard, getPendingProducts, moderateProduct, flagProduct,
    getUsers, banUser, getReports, resolveReport, dismissReport, getAllPayments,
    getSettings, updateSetting, promoteUserByPhone
};
