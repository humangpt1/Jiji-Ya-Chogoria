require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();

app.set('trust proxy', 1);

// ─── Security & Middleware ────────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(cors({ origin: true, credentials: true }));
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 300,
    standardHeaders: true, legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please try again later.' }
});
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 20,
    standardHeaders: true, legacyHeaders: false,
    message: { success: false, message: 'Too many login attempts. Please wait 15 minutes.' }
});
const paymentLimiter = rateLimit({
    windowMs: 60 * 1000, max: 5,
    standardHeaders: true, legacyHeaders: false,
    message: { success: false, message: 'Too many payment requests. Please slow down.' }
});

app.use('/api', generalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/payments/initiate', paymentLimiter);
app.use('/api/payments/boost', paymentLimiter);

// ─── Static Files ─────────────────────────────────────────────────────────────
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
    etag: true
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '7d' }));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/products', require('./src/routes/products'));
app.use('/api/payments', require('./src/routes/payments'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/notifications', require('./src/routes/notifications'));
app.use('/api/shops', require('./src/routes/shops'));
app.use('/api/chat', require('./src/routes/chat'));
app.use('/api/dm', require('./src/routes/dm'));
app.use('/api/uploads', require('./src/routes/uploads'));
app.use('/api/locations', require('./src/routes/locations'));
app.use('/api/newsletter', require('./src/routes/newsletter'));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Jiji ya Chogoria API is running',
        env: process.env.NODE_ENV,
        megapay: !!process.env.MEGAPAY_API_KEY,
        cloudinary: !!process.env.CLOUDINARY_API_KEY
    });
});

// ─── Public Settings ──────────────────────────────────────────────────────────
const { getSettingNumber } = require('./src/services/settings');
app.get('/api/settings/public', async (req, res) => {
    try {
        const [postingFee, minBoost, subscriptionDays] = await Promise.all([
            getSettingNumber('posting_fee', 100),
            getSettingNumber('min_boost_amount', 300),
            getSettingNumber('subscription_days', 30)
        ]);
        res.json({
            success: true,
            settings: { posting_fee: postingFee, min_boost_amount: minBoost, subscription_days: subscriptionDays }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not load settings.' });
    }
});

// ─── SPA Fallback ─────────────────────────────────────────────────────────────
app.get('/{*path}', (req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ success: false, message: 'Route not found.' });
    }
    res.sendFile(path.join(publicDir, 'index.html'));
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message || err);
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'Image too large. Max 5MB per image.' });
    }
    res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
});

// ─── Auto-seed categories & settings on startup ───────────────────────────────
async function seedOnStartup() {
    try {
        const { query } = require('./src/config/db');
        // Seed categories if empty
        const catCount = await query('SELECT COUNT(*) FROM categories');
        if (parseInt(catCount.rows[0].count) === 0) {
            await query(`
                INSERT INTO categories (name, slug, description, icon, sort_order) VALUES
                ('Mtumba','mtumba','Second-hand clothes','fas fa-recycle',1),
                ('Electronics','electronics','Phones, computers, TVs','fas fa-mobile-alt',2),
                ('Phones','phones','Mobile phones & accessories','fas fa-phone',3),
                ('Furniture','furniture','Home & office furniture','fas fa-couch',4),
                ('Hardware','hardware','Tools & building materials','fas fa-tools',5),
                ('Fashion','fashion','Clothing, shoes & accessories','fas fa-tshirt',6),
                ('Beauty','beauty','Cosmetics & personal care','fas fa-spa',7),
                ('Farm Products','farm-products','Fresh produce & livestock','fas fa-seedling',8),
                ('Services','services','Professional services','fas fa-briefcase',9),
                ('Rentals','rentals','Houses & property for rent','fas fa-key',10),
                ('Vehicles','vehicles','Cars, motorcycles & parts','fas fa-car',11),
                ('Grocery','grocery','Food & household supplies','fas fa-shopping-basket',12),
                ('Restaurants','restaurants','Food stalls & eateries','fas fa-utensils',13),
                ('Construction','construction','Building services & materials','fas fa-hard-hat',14),
                ('Home Appliances','home-appliances','Kitchen & electrical appliances','fas fa-blender',15),
                ('Jobs','jobs','Employment & business opportunities','fas fa-user-tie',16),
                ('Other','other','Everything else','fas fa-box',17)
                ON CONFLICT (slug) DO NOTHING
            `);
            console.log('    Categories: ✓ seeded');
        } else {
            console.log(`    Categories: ✓ ${catCount.rows[0].count} in DB`);
        }
        // Seed default app_settings if missing
        await query(`
            INSERT INTO app_settings (key, value, description) VALUES
            ('posting_fee','100','Fee in KES to post listings'),
            ('subscription_days','30','Membership validity in days'),
            ('min_boost_amount','300','Minimum boost amount in KES'),
            ('paid_posting_enabled','true','Require payment to post'),
            ('free_posts_per_user','2','Free posts before payment required'),
            ('apk_url','','Android APK download URL'),
            ('apk_version','1.0.0','Current APK version'),
            ('site_announcement','','Site-wide announcement banner')
            ON CONFLICT (key) DO NOTHING
        `);
        console.log('    Settings  : ✓ ready');

        // Create DM tables if they don't exist
        await query(`
            CREATE TABLE IF NOT EXISTS conversations (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user1_id UUID REFERENCES users(id) ON DELETE CASCADE,
                user2_id UUID REFERENCES users(id) ON DELETE CASCADE,
                product_id UUID REFERENCES products(id) ON DELETE SET NULL,
                last_message TEXT,
                last_message_at TIMESTAMPTZ DEFAULT NOW(),
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await query(`CREATE INDEX IF NOT EXISTS idx_conversations_user1 ON conversations(user1_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_conversations_user2 ON conversations(user2_id)`);
        await query(`
            CREATE TABLE IF NOT EXISTS direct_messages (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
                message TEXT NOT NULL,
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await query(`CREATE INDEX IF NOT EXISTS idx_dm_conversation ON direct_messages(conversation_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_dm_sender ON direct_messages(sender_id)`);
        console.log('    DM tables : ✓ ready');

        // Newsletter subscribers table
        await query(`
            CREATE TABLE IF NOT EXISTS newsletter_subscribers (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                email VARCHAR(255) UNIQUE NOT NULL,
                name VARCHAR(255),
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await query(`CREATE INDEX IF NOT EXISTS idx_newsletter_email ON newsletter_subscribers(email)`);
        console.log('    Newsletter: ✓ ready');
    } catch (e) {
        console.log('    Startup seed skipped (DB not ready yet):', e.message.slice(0, 60));
    }
}

// ─── Start Server (skip in Vercel serverless) ─────────────────────────────────
if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', async () => {
        console.log(`\n🚀  Jiji ya Chogoria  — port ${PORT}  [${process.env.NODE_ENV || 'development'}]`);
        console.log(`    MegaPay   : ${process.env.MEGAPAY_API_KEY ? '✓' : '✗ not configured'}`);
        console.log(`    Cloudinary: ${process.env.CLOUDINARY_API_KEY ? '✓' : '✗ not configured'}`);
        console.log(`    Google    : ${process.env.GOOGLE_CLIENT_ID ? '✓' : '✗ not configured'}`);
        await seedOnStartup();
    });
}

module.exports = app;
