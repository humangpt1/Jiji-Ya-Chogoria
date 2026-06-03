const { query } = require('../config/db');

const getNotifications = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = 20;
        const offset = (page - 1) * limit;

        const result = await query(
            `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
            [req.user.id, limit, offset]
        );

        const unread = await query(
            'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
            [req.user.id]
        );

        res.json({
            success: true,
            notifications: result.rows,
            unread_count: parseInt(unread.rows[0].count)
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not fetch notifications.' });
    }
};

const markRead = async (req, res) => {
    try {
        const { id } = req.params;
        if (id === 'all') {
            await query('UPDATE notifications SET is_read = true WHERE user_id = $1', [req.user.id]);
        } else {
            await query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [id, req.user.id]);
        }
        res.json({ success: true, message: 'Marked as read.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not update notification.' });
    }
};

module.exports = { getNotifications, markRead };
