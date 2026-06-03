require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');

async function migrate() {
    try {
        console.log('Running database migration...');
        const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
        await pool.query(sql);
        console.log('Database schema applied successfully!');

        // Create default admin user if not exists
        const bcrypt = require('bcryptjs');
        const adminPassword = process.env.ADMIN_SECRET || '12345678';
        const hash = await bcrypt.hash(adminPassword, 12);

        // Primary admin: smontana025@gmail.com
        const result = await pool.query(
            `INSERT INTO users (full_name, email, phone, password_hash, role, is_verified)
             VALUES ('Admin', 'smontana025@gmail.com', NULL, $1, 'admin', true)
             ON CONFLICT (email) DO NOTHING RETURNING id`,
            [hash]
        );
        if (result.rows[0]) {
            await pool.query(
                `INSERT INTO subscriptions (user_id, status, expires_at)
                 VALUES ($1, 'active', NOW() + INTERVAL '100 years')
                 ON CONFLICT (user_id) DO NOTHING`,
                [result.rows[0].id]
            );
            console.log('Primary admin created: smontana025@gmail.com / 12345678');
        } else {
            // Ensure existing admin has the right role and password
            await pool.query(
                `UPDATE users SET password_hash=$1, role='admin', is_verified=true WHERE email='smontana025@gmail.com'`,
                [hash]
            );
            console.log('Primary admin already exists — password synced.');
        }

        // Legacy admin fallback (keep for backwards compat)
        try {
            const result2 = await pool.query(
                `INSERT INTO users (full_name, email, phone, password_hash, role, is_verified)
                 VALUES ('Admin', 'admin@jijichogoria.co.ke', NULL, $1, 'admin', true)
                 ON CONFLICT (email) DO NOTHING RETURNING id`,
                [hash]
            );
            if (result2.rows[0]) {
                await pool.query(
                    `INSERT INTO subscriptions (user_id, status, expires_at)
                     VALUES ($1, 'active', NOW() + INTERVAL '100 years')
                     ON CONFLICT (user_id) DO NOTHING`,
                    [result2.rows[0].id]
                );
            }
        } catch (e) {
            console.log('Legacy admin skipped:', e.message);
        }

        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    }
}

migrate();
