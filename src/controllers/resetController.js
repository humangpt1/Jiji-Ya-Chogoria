const { query } = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('../services/email');

const forgotPassword = async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required.' });
    }
    try {
        const userRes = await query(
            'SELECT id, full_name, email FROM users WHERE LOWER(email) = LOWER($1) AND is_active = true',
            [email.trim()]
        );
        if (userRes.rows.length === 0) {
            return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
        }
        const user = userRes.rows[0];
        await query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
        await query(
            'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [user.id, token, expiresAt]
        );
        const sent = await sendPasswordResetEmail(user.email, user.full_name, token);
        if (!sent) {
            console.log(`[DEV] Reset link for ${user.email}: /?token=${token}`);
        }
        res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
    } catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ success: false, message: 'Could not process request.' });
    }
};

const resetPassword = async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) {
        return res.status(400).json({ success: false, message: 'Token and new password are required.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }
    try {
        const tokenRes = await query(
            `SELECT t.user_id, u.email, u.full_name
             FROM password_reset_tokens t
             JOIN users u ON t.user_id = u.id
             WHERE t.token = $1 AND t.used = false AND t.expires_at > NOW()`,
            [token]
        );
        if (tokenRes.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Reset link is invalid or has expired. Please request a new one.'
            });
        }
        const { user_id } = tokenRes.rows[0];
        const passwordHash = await bcrypt.hash(password, 12);
        await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, user_id]);
        await query('UPDATE password_reset_tokens SET used = true WHERE token = $1', [token]);
        res.json({ success: true, message: 'Password updated successfully! You can now log in.' });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ success: false, message: 'Could not reset password.' });
    }
};

module.exports = { forgotPassword, resetPassword };
