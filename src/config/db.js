const { Pool } = require('pg');

// Support multiple database URLs for failover
// DATABASE_URL is primary, DATABASE_URL_2 is fallback, etc.
const DB_URLS = [
    process.env.DATABASE_URL,
    process.env.DATABASE_URL_2,
    process.env.DATABASE_URL_3
].filter(Boolean);

if (!DB_URLS.length) {
    console.error('FATAL: No DATABASE_URL configured.');
    process.exit(1);
}

const isServerless = !!process.env.VERCEL || process.env.NODE_ENV === 'production';

function createPool(connectionString) {
    return new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false },
        max: isServerless ? 2 : 10,
        idleTimeoutMillis: isServerless ? 10000 : 30000,
        connectionTimeoutMillis: 5000,
        allowExitOnIdle: true
    });
}

let currentPoolIndex = 0;
let pools = DB_URLS.map(url => createPool(url));

pools.forEach((pool, i) => {
    pool.on('error', (err) => {
        console.error(`DB pool[${i}] error:`, err.message);
    });
});

const query = async (text, params) => {
    const start = Date.now();
    let lastErr;

    // Try each pool in order, failover if connection fails
    for (let attempt = 0; attempt < pools.length; attempt++) {
        const idx = (currentPoolIndex + attempt) % pools.length;
        try {
            const res = await pools[idx].query(text, params);
            if (attempt > 0) {
                currentPoolIndex = idx; // stick to the working pool
                console.log(`DB failover: now using pool[${idx}]`);
            }
            if (process.env.NODE_ENV === 'development') {
                console.log('DB query:', text.substring(0, 60), `(${Date.now() - start}ms)`);
            }
            return res;
        } catch (err) {
            // Only failover for connection-level errors, not SQL errors
            const isConnErr = err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' ||
                err.code === 'ENOTFOUND' || err.message?.includes('connect') ||
                err.message?.includes('timeout') || err.message?.includes('pool');
            if (isConnErr && attempt < pools.length - 1) {
                console.error(`DB pool[${idx}] connection error, trying next:`, err.message);
                lastErr = err;
                continue;
            }
            console.error('DB query error:', err.message, '|', text.substring(0, 80));
            throw err;
        }
    }
    throw lastErr;
};

const getClient = () => pools[currentPoolIndex].connect();

module.exports = { query, pool: pools[0], getClient };
