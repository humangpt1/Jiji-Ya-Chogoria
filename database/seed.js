require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});
const q = (text, params) => pool.query(text, params);

const img = (seed) => [{ url: `https://picsum.photos/seed/${seed}/480/360`, public_id: null }];

async function seed() {
    console.log('🌱 Seeding Jiji ya Chogoria...\n');

    // ─── Admin user ─────────────────────────────────────────────
    const adminHash = await bcrypt.hash(process.env.ADMIN_SECRET || '12345678', 12);
    await q(`
        INSERT INTO users (email, full_name, password_hash, role, phone, location, is_verified, is_active)
        VALUES ($1,$2,$3,'admin',$4,'Chogoria Town',true,true)
        ON CONFLICT (email) DO UPDATE SET role='admin', is_verified=true, password_hash=$3`,
        ['admin@jijichogoria.co.ke', 'Jiji Admin', adminHash, '0700000001']
    );

    // ─── Sample sellers ─────────────────────────────────────────
    const pwHash = await bcrypt.hash('seller123', 12);
    const sellers = [
        ['john.kamau@example.com',   'John Kamau',   '0712345678', 'Chogoria Town'],
        ['fatuma.ali@example.com',   'Fatuma Ali',   '0723456789', 'Chogoria Market'],
        ['peter.mwangi@example.com', 'Peter Mwangi', '0734567890', 'Chogoria Center'],
        ['grace.njeri@example.com',  'Grace Njeri',  '0745678901', 'Chogoria Stage'],
    ];
    for (const [email, name, phone, loc] of sellers) {
        await q(`
            INSERT INTO users (email, full_name, password_hash, role, phone, location, is_verified, is_active)
            VALUES ($1,$2,$3,'user',$4,$5,true,true)
            ON CONFLICT (email) DO NOTHING`,
            [email, name, pwHash, phone, loc]
        );
    }

    // ─── Active subscriptions for all sellers ───────────────────
    const userRows = await q(`SELECT id FROM users WHERE role='user'`);
    for (const row of userRows.rows) {
        await q(`
            INSERT INTO subscriptions (user_id, status, started_at, expires_at, amount_paid)
            VALUES ($1,'active',NOW(),NOW()+INTERVAL '30 days',100.00)
            ON CONFLICT (user_id) DO UPDATE SET status='active', expires_at=NOW()+INTERVAL '30 days'`,
            [row.id]
        );
    }

    // ─── Get IDs ────────────────────────────────────────────────
    const uid = async (email) => {
        const r = await q(`SELECT id FROM users WHERE email=$1`, [email]);
        return r.rows[0]?.id || null;
    };
    const johnId   = await uid('john.kamau@example.com');
    const fatumaId = await uid('fatuma.ali@example.com');
    const peterId  = await uid('peter.mwangi@example.com');
    const graceId  = await uid('grace.njeri@example.com');

    // ─── Get categories ─────────────────────────────────────────
    const catRes = await q(`SELECT id, slug FROM categories`);
    const cats = {};
    catRes.rows.forEach(c => { cats[c.slug] = c.id; });
    console.log('📂 Categories:', Object.keys(cats).join(', '));

    // ─── Products ────────────────────────────────────────────────
    const products = [
        { u: johnId,   t: 'Samsung Galaxy A54 5G – 128GB',          d: 'Used 6 months. Original box, charger & screen protector. Battery health 95%. Zero scratches on screen. Fast delivery in Chogoria.', p: 28000, c: 'electronics', cond: 'used', loc: 'Chogoria Town',   imgs: img('galaxy-a54') },
        { u: johnId,   t: 'HP Pavilion Laptop – Core i5 8GB 256SSD', d: 'Windows 11 fully updated. 8GB RAM, 256GB SSD. Very fast for office, school and internet. Charger included. Can demo anytime.', p: 45000, c: 'electronics', cond: 'used', loc: 'Chogoria Center', imgs: img('laptop-hp') },
        { u: peterId,  t: 'Samsung 43" 4K Smart TV – Brand New',     d: 'Sealed box with warranty. Netflix, YouTube, Disney+ built-in. Wi-Fi & Bluetooth. Wall mount bracket included free.', p: 35000, c: 'electronics', cond: 'new',  loc: 'Chogoria Stage',  imgs: img('samsung-tv') },
        { u: peterId,  t: 'Wireless Earbuds with Noise Cancellation', d: 'High-quality BT 5.3 earbuds. 8h battery + 24h charging case. Transparent mode & ANC. Compatible with Android & iPhone.', p: 1800, c: 'electronics', cond: 'new',  loc: 'Chogoria Market', imgs: img('earbuds-bt') },
        { u: graceId,  t: 'iPhone 13 – 128GB, Midnight Black',       d: 'Genuine Apple iPhone 13. Face ID perfect. IMEI clean. Comes with USB-C cable & Apple EarPods. Purchased abroad.', p: 65000, c: 'phones', cond: 'used', loc: 'Chogoria Town',   imgs: img('iphone-13') },
        { u: graceId,  t: 'Tecno Spark 10 Pro – 4GB/128GB Sealed',   d: 'Brand new in sealed box. 6.8" HD+ display, 5000mAh battery, 50MP camera. 1yr Tecno Kenya warranty. Bill included.', p: 13500, c: 'phones', cond: 'new',  loc: 'Chogoria Center', imgs: img('tecno-spark') },
        { u: johnId,   t: 'Redmi Note 12 – 6GB RAM, Fast Charging',  d: 'Barely used, like new condition. 33W fast charger. 5000mAh battery. 50MP camera with OIS. Comes with case & charger.', p: 19500, c: 'phones', cond: 'used', loc: 'Chogoria Town',   imgs: img('redmi-note12') },
        { u: fatumaId, t: "Men's Official Suit Set – Slim Fit",       d: 'High quality slim fit suits in black, navy & charcoal grey. Sizes S to XXL available. Ideal for office & events. Matching tie free.', p: 4500, c: 'fashion', cond: 'new', loc: 'Chogoria Market', imgs: img('mens-suit') },
        { u: fatumaId, t: 'Ankara Maxi Dress – Vibrant Print',        d: 'Beautiful Ankara fabric dress, hand-sewn by local tailors. Sizes 8–20. Custom sizing available at no extra cost. Delivery within Chogoria.', p: 1800, c: 'fashion', cond: 'new', loc: 'Chogoria Market', imgs: img('ankara-dress') },
        { u: graceId,  t: 'Nike Air Force 1 Low – White (Sizes 36-45)', d: 'Original Nike AF1. Classic white leather. All sizes available. Unisex. Great for casual, gym or events. Certificate of authenticity.', p: 5500, c: 'fashion', cond: 'new', loc: 'Chogoria Stage',  imgs: img('nike-af1') },
        { u: fatumaId, t: 'Fresh Hass Avocados – Farm Direct',         d: 'Organically grown from Chogoria highlands. No pesticides. Available in bags of 10, 20, or 50 pieces. Ripe and ready.', p: 200, c: 'farm-products', cond: 'new', loc: 'Chogoria Farm', imgs: img('avocados') },
        { u: fatumaId, t: 'Fresh Tomatoes – 1 Crate (15kg)',           d: 'Farm fresh, no chemical pesticides. Ideal for homes & restaurants. Delivery available within Chogoria town free of charge.', p: 1200, c: 'farm-products', cond: 'new', loc: 'Chogoria Farm', imgs: img('tomatoes-red') },
        { u: peterId,  t: 'Irish Potatoes – 50kg Clean Bag',           d: 'Premium potatoes from Tharaka-Nithi highlands. Washed and sorted. Wholesale and retail. Delivery within 24hrs.', p: 2500, c: 'farm-products', cond: 'new', loc: 'Meru Highlands', imgs: img('potatoes') },
        { u: johnId,   t: 'Modern L-Shape Sofa Set – 5 Seater',        d: 'New stylish sofa set. High-density foam, durable fabric. Color: grey with orange throw pillows. Delivery & assembly free within Chogoria.', p: 28000, c: 'furniture', cond: 'new', loc: 'Chogoria Town', imgs: img('sofa-lshape') },
        { u: peterId,  t: 'Toyota Noah 2010 – 7 Seater Full Options',  d: 'Very clean Noah. Current logbook. 2000cc petrol. Reverse camera, DVD, leather seats, alloy rims. Accident-free. Serious buyers only.', p: 850000, c: 'vehicles', cond: 'used', loc: 'Chogoria Town', imgs: img('toyota-noah') },
    ];

    let inserted = 0;
    for (const p of products) {
        if (!p.u || !cats[p.c]) {
            console.warn(`  ⚠ Skip "${p.t}" — missing user or category "${p.c}"`);
            continue;
        }
        try {
            await q(`
                INSERT INTO products (user_id, category_id, title, description, price, condition, location, negotiable, images, status, views_count)
                VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,'active',$9)`,
                [p.u, cats[p.c], p.t, p.d, p.p, p.cond, p.loc, JSON.stringify(p.imgs), Math.floor(Math.random() * 200 + 5)]
            );
            inserted++;
        } catch (err) {
            console.warn(`  ⚠ "${p.t}": ${err.message}`);
        }
    }
    console.log(`✅ Products: ${inserted}/${products.length} inserted`);

    // ─── Shops ────────────────────────────────────────────────────
    const shops = [
        { u: johnId,   name: 'TechHub Chogoria',           desc: 'Your one-stop shop for phones, laptops, TVs and accessories in Chogoria.',   cat: 'electronics',   loc: 'Chogoria Town' },
        { u: fatumaId, name: "Mama Fatuma's Fresh Produce", desc: 'Farm-fresh vegetables, fruits and grains delivered from Chogoria highlands.', cat: 'farm-products', loc: 'Chogoria Market' },
        { u: graceId,  name: 'Grace Fashion House',         desc: 'Latest fashion for men and women. Clothes, shoes, bags and accessories.',     cat: 'fashion',       loc: 'Chogoria Stage' },
    ];

    let shopCount = 0;
    for (const s of shops) {
        if (!s.u || !cats[s.cat]) { console.warn(`  ⚠ Skip shop "${s.name}"`); continue; }
        try {
            await q(`
                INSERT INTO shops (user_id, category_id, name, description, location, is_active, is_verified)
                VALUES ($1,$2,$3,$4,$5,true,true)`,
                [s.u, cats[s.cat], s.name, s.desc, s.loc]
            );
            shopCount++;
        } catch (err) { console.warn(`  ⚠ Shop "${s.name}": ${err.message}`); }
    }
    console.log(`✅ Shops: ${shopCount}/${shops.length} inserted`);

    console.log('\n🎉 Seed complete!');
    console.log('   Admin:  admin@jijichogoria.co.ke / 12345678');
    console.log('   Seller: john.kamau@example.com  / seller123');

    await pool.end();
}

seed().catch(err => { console.error('❌ Seed failed:', err.message); process.exit(1); });
