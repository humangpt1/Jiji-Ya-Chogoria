const { query } = require('../config/db');

// ── Get all conversations for current user ──────────────────────────────────
const getConversations = async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await query(
            `SELECT c.id, c.product_id, c.last_message, c.last_message_at,
                    p.title as product_title,
                    p.images as product_images,
                    CASE WHEN c.user1_id = $1 THEN c.user2_id ELSE c.user1_id END as other_user_id,
                    CASE WHEN c.user1_id = $1 THEN u2.full_name ELSE u1.full_name END as other_user_name,
                    CASE WHEN c.user1_id = $1 THEN u2.avatar_url ELSE u1.avatar_url END as other_user_avatar,
                    (SELECT COUNT(*) FROM direct_messages dm
                     WHERE dm.conversation_id = c.id
                     AND dm.sender_id != $1
                     AND dm.is_read = false) as unread_count
             FROM conversations c
             JOIN users u1 ON u1.id = c.user1_id
             JOIN users u2 ON u2.id = c.user2_id
             LEFT JOIN products p ON p.id = c.product_id
             WHERE c.user1_id = $1 OR c.user2_id = $1
             ORDER BY c.last_message_at DESC NULLS LAST
             LIMIT 60`,
            [userId]
        );

        const totalUnread = result.rows.reduce((s, r) => s + parseInt(r.unread_count || 0), 0);
        res.json({ success: true, conversations: result.rows, unread: totalUnread });
    } catch (err) {
        console.error('getConversations error:', err);
        res.status(500).json({ success: false, message: 'Could not load conversations.' });
    }
};

// ── Start or retrieve a conversation ───────────────────────────────────────
const startConversation = async (req, res) => {
    try {
        const { other_user_id, product_id } = req.body;
        const userId = req.user.id;

        if (!other_user_id) return res.status(400).json({ success: false, message: 'Recipient required.' });
        if (other_user_id === userId) return res.status(400).json({ success: false, message: "You can't message yourself." });

        // Find existing conversation for the same user-pair + product
        const existing = await query(
            `SELECT id FROM conversations
             WHERE ((user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1))
             AND COALESCE(product_id::text, 'null') = COALESCE($3::text, 'null')
             LIMIT 1`,
            [userId, other_user_id, product_id || null]
        );

        if (existing.rows[0]) {
            return res.json({ success: true, conversation_id: existing.rows[0].id, existing: true });
        }

        const result = await query(
            `INSERT INTO conversations (user1_id, user2_id, product_id)
             VALUES ($1, $2, $3) RETURNING id`,
            [userId, other_user_id, product_id || null]
        );

        res.status(201).json({ success: true, conversation_id: result.rows[0].id, existing: false });
    } catch (err) {
        console.error('startConversation error:', err);
        res.status(500).json({ success: false, message: 'Could not start conversation.' });
    }
};

// ── Get messages in a conversation ─────────────────────────────────────────
const getMessages = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const since = req.query.since;

        const conv = await query(
            `SELECT id, user1_id, user2_id, product_id FROM conversations
             WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)`,
            [id, userId]
        );
        if (!conv.rows[0]) return res.status(403).json({ success: false, message: 'Access denied.' });

        let result;
        if (since) {
            result = await query(
                `SELECT dm.id, dm.message, dm.is_read, dm.created_at, dm.sender_id,
                        u.full_name as sender_name, u.avatar_url as sender_avatar
                 FROM direct_messages dm
                 JOIN users u ON u.id = dm.sender_id
                 WHERE dm.conversation_id = $1 AND dm.created_at > $2
                 ORDER BY dm.created_at ASC LIMIT 50`,
                [id, since]
            );
        } else {
            result = await query(
                `SELECT dm.id, dm.message, dm.is_read, dm.created_at, dm.sender_id,
                        u.full_name as sender_name, u.avatar_url as sender_avatar
                 FROM direct_messages dm
                 JOIN users u ON u.id = dm.sender_id
                 WHERE dm.conversation_id = $1
                 ORDER BY dm.created_at ASC LIMIT 100`,
                [id]
            );
        }

        // Mark received messages as read
        await query(
            `UPDATE direct_messages SET is_read = true
             WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false`,
            [id, userId]
        );

        res.json({ success: true, messages: result.rows, conversation: conv.rows[0] });
    } catch (err) {
        console.error('getDMMessages error:', err);
        res.status(500).json({ success: false, message: 'Could not load messages.' });
    }
};

// ── Send a message ─────────────────────────────────────────────────────────
const sendMessage = async (req, res) => {
    try {
        const { id } = req.params;
        const { message } = req.body;
        const userId = req.user.id;

        if (!message || !message.trim()) return res.status(400).json({ success: false, message: 'Message required.' });
        if (message.trim().length > 1000) return res.status(400).json({ success: false, message: 'Max 1000 characters.' });

        const conv = await query(
            `SELECT id FROM conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)`,
            [id, userId]
        );
        if (!conv.rows[0]) return res.status(403).json({ success: false, message: 'Access denied.' });

        const result = await query(
            `INSERT INTO direct_messages (conversation_id, sender_id, message)
             VALUES ($1, $2, $3) RETURNING id, message, created_at`,
            [id, userId, message.trim()]
        );

        await query(
            `UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2`,
            [message.trim().slice(0, 100), id]
        );

        res.status(201).json({
            success: true,
            message: {
                ...result.rows[0],
                sender_id: userId,
                sender_name: req.user.full_name,
                sender_avatar: req.user.avatar_url,
                is_read: false
            }
        });
    } catch (err) {
        console.error('sendDM error:', err);
        res.status(500).json({ success: false, message: 'Could not send message.' });
    }
};

// ── Unread count for badge ─────────────────────────────────────────────────
const getUnreadCount = async (req, res) => {
    try {
        const result = await query(
            `SELECT COUNT(*) FROM direct_messages dm
             JOIN conversations c ON c.id = dm.conversation_id
             WHERE (c.user1_id = $1 OR c.user2_id = $1)
             AND dm.sender_id != $1 AND dm.is_read = false`,
            [req.user.id]
        );
        res.json({ success: true, unread: parseInt(result.rows[0].count) });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error.' });
    }
};

module.exports = { getConversations, startConversation, getMessages, sendMessage, getUnreadCount };
