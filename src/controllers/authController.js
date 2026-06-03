const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body } = require('express-validator');
const { OAuth2Client } = require('google-auth-library');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateToken = (user) => jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET || 'fallback-secret-change-me',
    { expiresIn: '30d' }
);

const registerValidation = [
    body('full_name').trim().notEmpty().withMessage('Full name is required').isLength({ min: 2, max: 150 }),
    body('email').trim().isEmail().withMessage('Valid email required').normalizeEmail(),
    body('phone').optional({ checkFalsy: true }).trim()
        .matches(/^(\+254|0)[17]\d{8}$/).withMessage('Enter a valid Kenyan phone number'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    validate
];

const loginValidation = [
    body('email').trim().isEmail().withMessage('Valid email required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
    validate
];

const register = async (req, res) => {
    try {
        const { full_name, email, phone, password, location } = req.body;

        const existing = await query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );
        if (existing.rows[0]) {
            return res.status(409).json({ success: false, message: 'Email already registered.' });
        }

        if (phone) {
            const phoneExists = await query('SELECT id FROM users WHERE phone = $1', [phone]);
            if (phoneExists.rows[0]) {
                return res.status(409).json({ success: false, message: 'Phone number already in use.' });
            }
        }

        const password_hash = await bcrypt.hash(password, 12);
        const result = await query(
            `INSERT INTO users (full_name, email, phone, password_hash, location, is_verified)
             VALUES ($1, $2, $3, $4, $5, false) RETURNING id, full_name, email, phone, role, location`,
            [full_name, email, phone || null, password_hash, location || null]
        );

        const user = result.rows[0];
        await query(
            'INSERT INTO subscriptions (user_id, status) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
            [user.id, 'inactive']
        );

        const token = generateToken(user);
        res.status(201).json({
            success: true,
            message: 'Account created successfully!',
            token,
            user: { id: user.id, full_name: user.full_name, email: user.email, phone: user.phone, role: user.role }
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
    }
};

const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const result = await query(
            `SELECT u.*, s.status as subscription_status, s.expires_at as subscription_expires
             FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id
             WHERE u.email = $1`,
            [email]
        );

        const user = result.rows[0];
        if (!user) return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        if (user.is_banned) return res.status(403).json({ success: false, message: `Account banned: ${user.ban_reason || 'Policy violation'}` });
        if (!user.is_active) return res.status(403).json({ success: false, message: 'Account deactivated.' });
        if (!user.password_hash) return res.status(401).json({ success: false, message: 'This account uses Google Sign-In. Please sign in with Google.' });

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ success: false, message: 'Invalid email or password.' });

        await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

        const token = generateToken(user);
        const hasActiveSubscription = user.subscription_status === 'active' &&
            user.subscription_expires && new Date(user.subscription_expires) > new Date();

        res.json({
            success: true, message: 'Welcome back!', token,
            user: {
                id: user.id, full_name: user.full_name, email: user.email,
                phone: user.phone, role: user.role, avatar_url: user.avatar_url,
                location: user.location, hasActiveSubscription
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
    }
};

// Google OAuth — verify ID token from Google Identity Services
const googleAuth = async (req, res) => {
    try {
        const { credential } = req.body;
        if (!credential) return res.status(400).json({ success: false, message: 'Google credential required.' });

        if (!process.env.GOOGLE_CLIENT_ID) {
            return res.status(503).json({ success: false, message: 'Google Sign-In not configured.' });
        }

        let payload;
        try {
            const ticket = await googleClient.verifyIdToken({
                idToken: credential,
                audience: process.env.GOOGLE_CLIENT_ID
            });
            payload = ticket.getPayload();
        } catch (verifyErr) {
            console.error('Google token verify error:', verifyErr.message);
            return res.status(401).json({ success: false, message: 'Invalid Google token. Please try again.' });
        }

        const { sub: google_id, email, name, picture } = payload;

        // Check existing user
        let userResult = await query(
            `SELECT u.*, s.status as subscription_status, s.expires_at as subscription_expires
             FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id
             WHERE u.google_id = $1 OR u.email = $2
             LIMIT 1`,
            [google_id, email]
        );

        let user = userResult.rows[0];

        if (user) {
            // Update google_id and avatar if missing
            await query(
                `UPDATE users SET google_id = COALESCE(google_id, $1),
                 avatar_url = COALESCE(avatar_url, $2), last_login = NOW() WHERE id = $3`,
                [google_id, picture, user.id]
            );
            if (user.is_banned) return res.status(403).json({ success: false, message: 'Account banned.' });
        } else {
            // Create new user
            const result = await query(
                `INSERT INTO users (full_name, email, google_id, avatar_url, is_verified)
                 VALUES ($1, $2, $3, $4, true)
                 RETURNING id, full_name, email, phone, role, avatar_url, location`,
                [name, email, google_id, picture]
            );
            user = result.rows[0];
            await query(
                'INSERT INTO subscriptions (user_id, status) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
                [user.id, 'inactive']
            );
        }

        // Re-fetch fresh user
        const fresh = await query(
            `SELECT u.*, s.status as subscription_status, s.expires_at as subscription_expires
             FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id WHERE u.id = $1`,
            [user.id]
        );
        const u = fresh.rows[0];
        const hasActiveSubscription = u.subscription_status === 'active' &&
            u.subscription_expires && new Date(u.subscription_expires) > new Date();

        const token = generateToken(u);
        res.json({
            success: true, message: `Welcome, ${u.full_name}!`, token,
            user: {
                id: u.id, full_name: u.full_name, email: u.email, phone: u.phone,
                role: u.role, avatar_url: u.avatar_url, location: u.location, hasActiveSubscription,
                needsPhone: !u.phone
            }
        });
    } catch (err) {
        console.error('Google auth error:', err);
        res.status(500).json({ success: false, message: 'Google Sign-In failed. Please try again.' });
    }
};

const getMe = async (req, res) => {
    try {
        const result = await query(
            `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.avatar_url, u.location, u.bio,
                    u.whatsapp, u.google_id, u.created_at, u.last_login,
                    s.status as subscription_status, s.expires_at as subscription_expires,
                    s.started_at as subscription_started,
                    COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'active') as active_listings,
                    COUNT(DISTINCT p.id) as total_listings
             FROM users u
             LEFT JOIN subscriptions s ON s.user_id = u.id
             LEFT JOIN products p ON p.user_id = u.id
             WHERE u.id = $1
             GROUP BY u.id, s.status, s.expires_at, s.started_at`,
            [req.user.id]
        );

        const user = result.rows[0];
        const hasActiveSubscription = user.subscription_status === 'active' &&
            user.subscription_expires && new Date(user.subscription_expires) > new Date();

        res.json({ success: true, user: { ...user, hasActiveSubscription } });
    } catch (err) {
        console.error('GetMe error:', err);
        res.status(500).json({ success: false, message: 'Could not fetch profile.' });
    }
};

const updateProfile = async (req, res) => {
    try {
        const { full_name, location, bio, phone, whatsapp } = req.body;

        if (phone) {
            const existing = await query(
                'SELECT id FROM users WHERE phone = $1 AND id != $2',
                [phone, req.user.id]
            );
            if (existing.rows[0]) {
                return res.status(409).json({ success: false, message: 'Phone number already in use.' });
            }
        }

        const result = await query(
            `UPDATE users SET
                full_name = COALESCE($1, full_name),
                location = COALESCE($2, location),
                bio = COALESCE($3, bio),
                phone = COALESCE($4, phone),
                whatsapp = COALESCE($5, whatsapp)
             WHERE id = $6
             RETURNING id, full_name, email, phone, location, bio, whatsapp`,
            [full_name, location, bio, phone || null, whatsapp || null, req.user.id]
        );

        res.json({ success: true, message: 'Profile updated.', user: result.rows[0] });
    } catch (err) {
        console.error('UpdateProfile error:', err);
        res.status(500).json({ success: false, message: 'Update failed.' });
    }
};

const changePassword = async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        if (!new_password || new_password.length < 6) {
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
        }

        const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
        if (result.rows[0].password_hash) {
            if (!current_password) return res.status(400).json({ success: false, message: 'Current password required.' });
            const valid = await bcrypt.compare(current_password, result.rows[0].password_hash);
            if (!valid) return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
        }

        const hash = await bcrypt.hash(new_password, 12);
        await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
        res.json({ success: true, message: 'Password set successfully.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not change password.' });
    }
};

module.exports = { register, registerValidation, login, loginValidation, googleAuth, getMe, updateProfile, changePassword };
