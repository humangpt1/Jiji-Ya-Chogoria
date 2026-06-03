const { query } = require('../config/db');

const RATE_LIMIT_MS = 3000; // 3 seconds between messages
const userLastMessage = new Map();

const getMessages = async (req, res) => {
    try {
        const since = req.query.since; // ISO timestamp for polling
        const limit = 50;

        let result;
        if (since) {
            result = await query(
                `SELECT cm.id, cm.message, cm.created_at,
                        u.full_name, u.avatar_url, u.role,
                        u.id as user_id
                 FROM community_messages cm
                 JOIN users u ON u.id = cm.user_id
                 WHERE cm.is_deleted = false AND cm.created_at > $1
                 ORDER BY cm.created_at ASC LIMIT $2`,
                [since, limit]
            );
        } else {
            result = await query(
                `SELECT cm.id, cm.message, cm.created_at,
                        u.full_name, u.avatar_url, u.role,
                        u.id as user_id
                 FROM community_messages cm
                 JOIN users u ON u.id = cm.user_id
                 WHERE cm.is_deleted = false
                 ORDER BY cm.created_at DESC LIMIT $1`,
                [limit]
            );
            result.rows.reverse();
        }

        res.json({ success: true, messages: result.rows });
    } catch (err) {
        console.error('Get chat messages error:', err);
        res.status(500).json({ success: false, message: 'Could not load messages.' });
    }
};

const sendMessage = async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || !message.trim()) return res.status(400).json({ success: false, message: 'Message required.' });
        if (message.trim().length > 500) return res.status(400).json({ success: false, message: 'Message too long (max 500 chars).' });

        // Rate limit per user
        const lastTime = userLastMessage.get(req.user.id);
        if (lastTime && Date.now() - lastTime < RATE_LIMIT_MS) {
            return res.status(429).json({ success: false, message: 'Sending too fast. Please wait.' });
        }
        userLastMessage.set(req.user.id, Date.now());

        const result = await query(
            `INSERT INTO community_messages (user_id, message)
             VALUES ($1, $2)
             RETURNING id, message, created_at`,
            [req.user.id, message.trim()]
        );

        res.status(201).json({
            success: true,
            message: {
                ...result.rows[0],
                full_name: req.user.full_name,
                user_id: req.user.id,
                role: req.user.role
            }
        });
    } catch (err) {
        console.error('Send chat message error:', err);
        res.status(500).json({ success: false, message: 'Could not send message.' });
    }
};

const deleteMessage = async (req, res) => {
    try {
        const { id } = req.params;
        const msg = await query('SELECT user_id FROM community_messages WHERE id = $1', [id]);
        if (!msg.rows[0]) return res.status(404).json({ success: false, message: 'Message not found.' });

        const isOwner = msg.rows[0].user_id === req.user.id;
        const isAdmin = ['admin', 'moderator', 'superuser'].includes(req.user.role);
        if (!isOwner && !isAdmin) return res.status(403).json({ success: false, message: 'Cannot delete this message.' });

        await query('UPDATE community_messages SET is_deleted = true WHERE id = $1', [id]);
        res.json({ success: true, message: 'Message deleted.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not delete message.' });
    }
};

module.exports = { getMessages, sendMessage, deleteMessage };
