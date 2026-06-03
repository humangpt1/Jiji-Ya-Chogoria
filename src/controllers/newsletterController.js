const { query } = require('../config/db');

const subscribe = async (req, res) => {
    try {
        const { email, name } = req.body;
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ success: false, message: 'Valid email address required.' });
        }

        await query(
            `INSERT INTO newsletter_subscribers (email, name) VALUES ($1, $2)
             ON CONFLICT (email) DO UPDATE SET is_active = true, updated_at = NOW()`,
            [email.toLowerCase().trim(), (name || '').trim() || null]
        );

        res.json({ success: true, message: 'Subscribed! You\'ll receive updates from Jiji ya Chogoria.' });
    } catch (err) {
        console.error('Newsletter subscribe error:', err);
        res.status(500).json({ success: false, message: 'Could not subscribe. Please try again.' });
    }
};

const unsubscribe = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: 'Email required.' });

        await query(
            'UPDATE newsletter_subscribers SET is_active = false, updated_at = NOW() WHERE email = $1',
            [email.toLowerCase().trim()]
        );

        res.json({ success: true, message: 'Unsubscribed successfully.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not unsubscribe.' });
    }
};

const getSubscribers = async (req, res) => {
    try {
        const result = await query(
            `SELECT id, email, name, is_active, created_at
             FROM newsletter_subscribers
             ORDER BY created_at DESC LIMIT 200`
        );
        const total = await query('SELECT COUNT(*) FROM newsletter_subscribers WHERE is_active = true');
        res.json({
            success: true,
            subscribers: result.rows,
            total_active: parseInt(total.rows[0].count)
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not fetch subscribers.' });
    }
};

module.exports = { subscribe, unsubscribe, getSubscribers };
