const { query } = require('../config/db');

const cache = new Map();
const CACHE_TTL_MS = 30_000;

async function getSetting(key, fallback = null) {
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;

    try {
        const r = await query('SELECT value FROM app_settings WHERE key = $1', [key]);
        const value = r.rows[0]?.value ?? fallback;
        cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
        return value;
    } catch (err) {
        console.error('getSetting error:', err.message);
        return fallback;
    }
}

async function getSettingNumber(key, fallback = 0) {
    const v = await getSetting(key, String(fallback));
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

async function getAllSettings() {
    const r = await query('SELECT key, value, description, updated_at FROM app_settings ORDER BY key');
    return r.rows;
}

async function setSetting(key, value, adminId) {
    await query(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
        [key, String(value), adminId]
    );
    cache.delete(key);
}

function clearCache() { cache.clear(); }

module.exports = { getSetting, getSettingNumber, getAllSettings, setSetting, clearCache };
