const { query } = require('../config/db');
const { getImageUrl } = require('../services/cloudinary');

const createShop = async (req, res) => {
    try {
        const {
            name, description, category_id, location,
            whatsapp_number, whatsapp, opening_hours, operating_hours, maps_url
        } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Shop name is required.' });

        const existing = await query('SELECT id FROM shops WHERE user_id = $1', [req.user.id]);
        if (existing.rows.length >= 3) {
            return res.status(400).json({ success: false, message: 'Maximum 3 shops per user.' });
        }

        let logo_url = null, cover_url = null;
        if (req.files) {
            const logo = req.files.logo?.[0];
            const cover = req.files.cover?.[0];
            if (logo) { const img = getImageUrl(logo); if (img) logo_url = img.url; }
            if (cover) { const img = getImageUrl(cover); if (img) cover_url = img.url; }
        }

        const wa = whatsapp_number || whatsapp || null;
        const hours = opening_hours || operating_hours || null;

        const result = await query(
            `INSERT INTO shops (user_id, name, description, category_id, location, whatsapp, logo_url, cover_url, operating_hours, maps_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING *`,
            [req.user.id, name.trim(), description || null, category_id || null, location || null, wa, logo_url, cover_url, hours, maps_url || null]
        );

        res.status(201).json({ success: true, message: 'Shop created!', shop: result.rows[0] });
    } catch (err) {
        console.error('Create shop error:', err);
        res.status(500).json({ success: false, message: 'Could not create shop.' });
    }
};

const getShops = async (req, res) => {
    try {
        const { search, category } = req.query;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, parseInt(req.query.limit) || 20);
        const offset = (page - 1) * limit;

        const conditions = ['s.is_active = true'];
        const params = [];
        let idx = 1;

        if (search) {
            conditions.push(`(s.name ILIKE $${idx} OR s.description ILIKE $${idx} OR s.location ILIKE $${idx})`);
            params.push(`%${search}%`); idx++;
        }
        if (category) {
            conditions.push(`c.slug = $${idx++}`);
            params.push(category);
        }

        const where = `WHERE ${conditions.join(' AND ')}`;
        const result = await query(
            `SELECT s.*, u.full_name as owner_name, u.phone as owner_phone,
                    c.name as category_name,
                    COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'active') as product_count,
                    s.whatsapp as whatsapp_number,
                    s.operating_hours as opening_hours
             FROM shops s
             JOIN users u ON u.id = s.user_id
             LEFT JOIN categories c ON c.id = s.category_id
             LEFT JOIN products p ON p.shop_id = s.id
             ${where}
             GROUP BY s.id, u.full_name, u.phone, c.name
             ORDER BY s.is_verified DESC, s.views_count DESC, s.created_at DESC
             LIMIT $${idx} OFFSET $${idx+1}`,
            [...params, limit, offset]
        );

        const countResult = await query(`SELECT COUNT(*) FROM shops s LEFT JOIN categories c ON c.id = s.category_id ${where}`, params);

        res.json({
            success: true,
            shops: result.rows,
            pagination: { page, limit, total: parseInt(countResult.rows[0].count), pages: Math.ceil(countResult.rows[0].count / limit) }
        });
    } catch (err) {
        console.error('Get shops error:', err);
        res.status(500).json({ success: false, message: 'Could not fetch shops.' });
    }
};

const getShop = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await query(
            `SELECT s.*, u.full_name as owner_name, u.phone as owner_phone, u.avatar_url as owner_avatar,
                    c.name as category_name,
                    s.whatsapp as whatsapp_number,
                    s.operating_hours as opening_hours
             FROM shops s
             JOIN users u ON u.id = s.user_id
             LEFT JOIN categories c ON c.id = s.category_id
             WHERE s.id = $1`,
            [id]
        );

        if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Shop not found.' });

        // Increment views
        await query('UPDATE shops SET views_count = views_count + 1 WHERE id = $1', [id]);

        // Get shop products
        const products = await query(
            `SELECT p.id, p.title, p.price, p.images, p.condition, p.created_at
             FROM products p WHERE p.shop_id = $1 AND p.status = 'active'
             ORDER BY p.featured DESC, p.created_at DESC LIMIT 12`,
            [id]
        );

        res.json({ success: true, shop: result.rows[0], products: products.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not fetch shop.' });
    }
};

const getMyShops = async (req, res) => {
    try {
        const result = await query(
            `SELECT s.*, c.name as category_name,
                    COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'active') as product_count
             FROM shops s
             LEFT JOIN categories c ON c.id = s.category_id
             LEFT JOIN products p ON p.shop_id = s.id
             WHERE s.user_id = $1
             GROUP BY s.id, c.name
             ORDER BY s.created_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, shops: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not fetch your shops.' });
    }
};

const updateShop = async (req, res) => {
    try {
        const { id } = req.params;
        const shop = await query('SELECT user_id FROM shops WHERE id = $1', [id]);
        if (!shop.rows[0]) return res.status(404).json({ success: false, message: 'Shop not found.' });
        if (shop.rows[0].user_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'superuser') {
            return res.status(403).json({ success: false, message: 'Not your shop.' });
        }

        const {
            name, description, category_id, location,
            whatsapp_number, whatsapp, opening_hours, operating_hours, maps_url
        } = req.body;
        const wa = whatsapp_number || whatsapp || undefined;
        const hours = opening_hours || operating_hours || undefined;

        let logo_url, cover_url;
        if (req.files) {
            const logo = req.files.logo?.[0];
            const cover = req.files.cover?.[0];
            if (logo) { const img = getImageUrl(logo); if (img) logo_url = img.url; }
            if (cover) { const img = getImageUrl(cover); if (img) cover_url = img.url; }
        }

        const result = await query(
            `UPDATE shops SET
                name = COALESCE($1, name), description = COALESCE($2, description),
                category_id = COALESCE($3, category_id), location = COALESCE($4, location),
                whatsapp = COALESCE($5, whatsapp),
                logo_url = COALESCE($6, logo_url), cover_url = COALESCE($7, cover_url),
                operating_hours = COALESCE($8, operating_hours), maps_url = COALESCE($9, maps_url)
             WHERE id = $10 RETURNING *`,
            [name, description, category_id || null, location,
             wa, logo_url, cover_url, hours, maps_url, id]
        );

        res.json({ success: true, message: 'Shop updated.', shop: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not update shop.' });
    }
};

const deleteShop = async (req, res) => {
    try {
        const { id } = req.params;
        const shop = await query('SELECT user_id FROM shops WHERE id = $1', [id]);
        if (!shop.rows[0]) return res.status(404).json({ success: false, message: 'Shop not found.' });
        if (shop.rows[0].user_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'superuser') {
            return res.status(403).json({ success: false, message: 'Not your shop.' });
        }
        await query('DELETE FROM shops WHERE id = $1', [id]);
        res.json({ success: true, message: 'Shop deleted.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not delete shop.' });
    }
};

module.exports = { createShop, getShops, getShop, getMyShops, updateShop, deleteShop };
