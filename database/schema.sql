-- ============================================================
-- Jiji ya Chogoria - Database Schema
-- PostgreSQL (NeonDB) — Serverless-optimised
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE,
    password_hash VARCHAR(255),
    google_id VARCHAR(255) UNIQUE,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin', 'moderator', 'superuser')),
    avatar_url TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    is_banned BOOLEAN DEFAULT FALSE,
    ban_reason TEXT,
    location VARCHAR(255),
    bio TEXT,
    whatsapp VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ============================================================
-- SUBSCRIPTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'expired', 'cancelled')),
    started_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    amount_paid DECIMAL(10,2) DEFAULT 100.00,
    auto_renew BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_expires_at ON subscriptions(expires_at);

-- ============================================================
-- PAYMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES subscriptions(id),
    mpesa_checkout_request_id VARCHAR(255),
    mpesa_merchant_request_id VARCHAR(255),
    mpesa_receipt_number VARCHAR(100),
    megapay_request_id VARCHAR(255),
    megapay_receipt VARCHAR(255),
    megapay_transaction_id VARCHAR(255),
    phone_number VARCHAR(20) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled', 'refunded')),
    payment_method VARCHAR(20) DEFAULT 'megapay',
    payment_type VARCHAR(20) DEFAULT 'subscription',
    product_id UUID,
    failure_reason TEXT,
    raw_callback JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);

-- ============================================================
-- CATEGORIES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    parent_id INTEGER REFERENCES categories(id),
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SHOPS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS shops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category_id INTEGER REFERENCES categories(id),
    location VARCHAR(255),
    address TEXT,
    lat DECIMAL(10,8),
    lng DECIMAL(11,8),
    whatsapp VARCHAR(20),
    phone VARCHAR(20),
    logo_url TEXT,
    cover_url TEXT,
    operating_hours TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    is_verified BOOLEAN DEFAULT FALSE,
    views_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shops_user_id ON shops(user_id);
CREATE INDEX IF NOT EXISTS idx_shops_category_id ON shops(category_id);
CREATE INDEX IF NOT EXISTS idx_shops_is_active ON shops(is_active);

-- ============================================================
-- PRODUCTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
    category_id INTEGER REFERENCES categories(id),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    price DECIMAL(12,2) NOT NULL,
    negotiable BOOLEAN DEFAULT FALSE,
    condition VARCHAR(20) DEFAULT 'used' CHECK (condition IN ('new', 'used', 'refurbished')),
    location VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected', 'sold', 'expired', 'deleted')),
    is_flagged BOOLEAN DEFAULT FALSE,
    flag_reason TEXT,
    rejection_reason TEXT,
    featured BOOLEAN DEFAULT FALSE,
    featured_amount DECIMAL(12,2) DEFAULT 0,
    views_count INTEGER DEFAULT 0,
    contact_count INTEGER DEFAULT 0,
    images JSONB DEFAULT '[]',
    tags TEXT[],
    whatsapp_number VARCHAR(20),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '60 days'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
CREATE INDEX IF NOT EXISTS idx_products_search ON products USING GIN (
    to_tsvector('english', title || ' ' || COALESCE(description,''))
);

-- ============================================================
-- COMMUNITY CHAT TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS community_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_messages_created_at ON community_messages(created_at DESC);

-- ============================================================
-- FAVORITES / WISHLIST TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS favorites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);

-- ============================================================
-- MESSAGES TABLE (buyer-seller)
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_product_id ON messages(product_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_id ON messages(receiver_id);

-- ============================================================
-- NOTIFICATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- ============================================================
-- ADMIN LOGS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID NOT NULL REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id UUID,
    details JSONB DEFAULT '{}',
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_admin_id ON admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at DESC);

-- ============================================================
-- REPORTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    reported_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reason VARCHAR(100) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
    resolved_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_product_id ON reports(product_id);

-- ============================================================
-- APP SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO app_settings (key, value, description) VALUES
    ('posting_fee', '100', 'Fee in KES required to post listings (0 = free)'),
    ('subscription_days', '30', 'Number of days a paid membership is valid'),
    ('min_boost_amount', '300', 'Minimum boost amount in KES to feature a listing'),
    ('paid_posting_enabled', 'true', 'Whether sellers must pay to post listings (true/false)'),
    ('free_posts_per_user', '0', 'Free posts allowed per user before payment (0 = all require payment)'),
    ('apk_url', '', 'Download URL for the Android APK'),
    ('apk_version', '1.0.0', 'Current APK version'),
    ('site_announcement', '', 'Announcement banner shown to all users (empty = hidden)')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- IDEMPOTENT COLUMN ADDITIONS (safe to re-run)
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS flag_reason TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(20);
ALTER TABLE products ADD COLUMN IF NOT EXISTS shop_id UUID;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_type VARCHAR(20) DEFAULT 'subscription';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS megapay_request_id VARCHAR(255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS megapay_receipt VARCHAR(255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS megapay_transaction_id VARCHAR(255);
ALTER TABLE products ADD COLUMN IF NOT EXISTS featured_amount DECIMAL(12,2) DEFAULT 0;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS maps_url TEXT;

-- Add UNIQUE constraint on google_id if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_google_id_key'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='google_id'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_google_id_key UNIQUE (google_id);
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- Constraint may already exist under a different name, ignore
    NULL;
END $$;

-- ============================================================
-- DEFAULT CATEGORIES (new list)
-- ============================================================
INSERT INTO categories (name, slug, description, icon, sort_order) VALUES
    ('Mtumba', 'mtumba', 'Second-hand clothes and fashion items', 'fas fa-recycle', 1),
    ('Electronics', 'electronics', 'Phones, computers, TVs and gadgets', 'fas fa-mobile-alt', 2),
    ('Phones', 'phones', 'Mobile phones and accessories', 'fas fa-phone', 3),
    ('Furniture', 'furniture', 'Home and office furniture', 'fas fa-couch', 4),
    ('Hardware', 'hardware', 'Tools, building materials and supplies', 'fas fa-tools', 5),
    ('Fashion', 'fashion', 'Clothing, shoes and accessories', 'fas fa-tshirt', 6),
    ('Beauty', 'beauty', 'Cosmetics, skincare and personal care', 'fas fa-spa', 7),
    ('Farm Products', 'farm-products', 'Fresh produce, livestock and farm supplies', 'fas fa-seedling', 8),
    ('Services', 'services', 'Professional and personal services', 'fas fa-briefcase', 9),
    ('Rentals', 'rentals', 'Houses, rooms and property for rent', 'fas fa-key', 10),
    ('Vehicles', 'vehicles', 'Cars, motorcycles and spare parts', 'fas fa-car', 11),
    ('Grocery', 'grocery', 'Food items and household supplies', 'fas fa-shopping-basket', 12),
    ('Restaurants', 'restaurants', 'Food stalls, hotels and eateries', 'fas fa-utensils', 13),
    ('Construction', 'construction', 'Building services and materials', 'fas fa-hard-hat', 14),
    ('Home Appliances', 'home-appliances', 'Kitchen and home electrical appliances', 'fas fa-blender', 15),
    ('Jobs', 'jobs', 'Employment and business opportunities', 'fas fa-user-tie', 16),
    ('Other', 'other', 'Everything else', 'fas fa-box', 17)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- PASSWORD RESET TOKENS
-- ============================================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_prt_user_id ON password_reset_tokens(user_id);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER subscriptions_updated_at
    BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER payments_updated_at
    BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER products_updated_at
    BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER reports_updated_at
    BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER shops_updated_at
    BEFORE UPDATE ON shops FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- LOCATION SYSTEM ADDITIONS
-- ============================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS lat DECIMAL(10,8);
ALTER TABLE products ADD COLUMN IF NOT EXISTS lng DECIMAL(11,8);

ALTER TABLE users ADD COLUMN IF NOT EXISTS lat DECIMAL(10,8);
ALTER TABLE users ADD COLUMN IF NOT EXISTS lng DECIMAL(11,8);

CREATE TABLE IF NOT EXISTS locations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    lat DECIMAL(10,8) NOT NULL,
    lng DECIMAL(11,8) NOT NULL,
    county VARCHAR(100) NOT NULL DEFAULT 'Tharaka-Nithi',
    distance_from_chogoria DECIMAL(6,1) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE
);

INSERT INTO locations (name, lat, lng, county, distance_from_chogoria) VALUES
('Chogoria Town', -0.36670, 37.70330, 'Tharaka-Nithi', 0),
('Nkubu',         -0.36670, 37.66670, 'Meru',           4),
('Murugi',        -0.38000, 37.72000, 'Tharaka-Nithi',  3),
('Kaanwa',        -0.35000, 37.73000, 'Tharaka-Nithi',  5),
('Kajuki',        -0.40000, 37.71000, 'Tharaka-Nithi',  4),
('Magutuni',      -0.39000, 37.68000, 'Tharaka-Nithi',  5),
('Mwonge',        -0.34000, 37.74000, 'Tharaka-Nithi',  6),
('Mitheru',       -0.31000, 37.69000, 'Tharaka-Nithi',  7),
('Marima',        -0.32000, 37.72000, 'Tharaka-Nithi',  7),
('Chuka',         -0.33410, 37.65070, 'Tharaka-Nithi',  8),
('Ganga',         -0.45000, 37.75000, 'Tharaka-Nithi', 10),
('Kithangani',    -0.33000, 37.62000, 'Tharaka-Nithi', 10),
('Muthambi',      -0.30000, 37.76000, 'Tharaka-Nithi', 10),
('Karingani',     -0.38000, 37.85000, 'Tharaka-Nithi', 15),
('Igoji',         -0.25000, 37.65000, 'Meru',          16),
('Kathwana',      -0.23900, 37.77300, 'Tharaka-Nithi', 17),
('Chiakariga',    -0.22000, 37.63000, 'Meru',          22),
('Gatunga',       -0.18000, 37.95000, 'Tharaka-Nithi', 35),
('Meru',          -0.05000, 37.65000, 'Meru',          35),
('Embu',          -0.53330, 37.45000, 'Embu',          38),
('Kiang''ondu',   -0.20000, 37.98000, 'Tharaka-Nithi', 42),
('Kerugoya',      -0.49780, 37.28060, 'Kirinyaga',     52)
ON CONFLICT (name) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_products_lat_lng ON products(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL;
