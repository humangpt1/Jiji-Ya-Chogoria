const { body, query: qParam } = require('express-validator');
const { query } = require('../config/db');
const { validate } = require('../middleware/validate');
const { getImageUrl } = require('../services/cloudinary');

const productValidation = [
    body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 255 }),
    body('description').trim().notEmpty().withMessage('Description is required'),
    body('price').isNumeric().withMessage('Price must be a number').isFloat({ min: 0 }),
    body('category_id').isInt({ min: 1 }).withMessage('Valid category required'),
    validate
];

const createProduct = async (req, res) => {
    try {
        const { title, description, price, category_id, condition, location, negotiable, tags, lat, lng } = req.body;

        const images = [];
        // Accept pre-uploaded images (sent as JSON in form body)
        if (req.body.uploaded_images) {
            try {
                const pre = JSON.parse(req.body.uploaded_images);
                if (Array.isArray(pre)) images.push(...pre);
            } catch {}
        }
        // Fallback: files uploaded with the form
        if (!images.length && req.files && req.files.length > 0) {
            for (const file of req.files) {
                const img = getImageUrl(file);
                if (img) images.push(img);
            }
        }

        const productLat = lat ? parseFloat(lat) : null;
        const productLng = lng ? parseFloat(lng) : null;

        const result = await query(
            `INSERT INTO products (user_id, category_id, title, description, price, condition, location, negotiable, images, tags, status, lat, lng)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11, $12)
             RETURNING *`,
            [req.user.id, category_id, title, description, price, condition || 'used',
             location || req.user.location, negotiable === 'true' || negotiable === true,
             JSON.stringify(images), tags ? (Array.isArray(tags) ? tags : [tags]) : [],
             productLat, productLng]
        );

        const admins = await query(`SELECT id FROM users WHERE role = 'admin'`);
        for (const admin of admins.rows) {
            await query(
                `INSERT INTO notifications (user_id, type, title, message, metadata)
                 VALUES ($1, 'new_product_pending', 'New Product Awaiting Approval', $2, $3)`,
                [admin.id, `"${title}" by ${req.user.full_name} needs review.`,
                 JSON.stringify({ product_id: result.rows[0].id })]
            );
        }

        res.status(201).json({
            success: true,
            message: 'Listing submitted for review. It will be visible once approved.',
            product: result.rows[0]
        });
    } catch (err) {
        console.error('Create product error:', err);
        res.status(500).json({ success: false, message: 'Could not create listing.' });
    }
};

const getProducts = async (req, res) => {
    try {
        const { category, search, min_price, max_price, condition, location, sort } = req.query;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, parseInt(req.query.limit) || 20);
        const offset = (page - 1) * limit;

        const conditions = [`p.status = 'active'`];
        const params = [];
        let paramIdx = 1;

        if (category) {
            conditions.push(`c.slug = $${paramIdx++}`);
            params.push(category);
        }
        if (search) {
            conditions.push(`(p.title ILIKE $${paramIdx} OR p.description ILIKE $${paramIdx})`);
            params.push(`%${search}%`);
            paramIdx++;
        }
        if (min_price) {
            conditions.push(`p.price >= $${paramIdx++}`);
            params.push(parseFloat(min_price));
        }
        if (max_price) {
            conditions.push(`p.price <= $${paramIdx++}`);
            params.push(parseFloat(max_price));
        }
        if (condition) {
            conditions.push(`p.condition = $${paramIdx++}`);
            params.push(condition);
        }
        if (location) {
            conditions.push(`p.location ILIKE $${paramIdx++}`);
            params.push(`%${location}%`);
        }

        const sortMap = {
            newest: 'p.created_at DESC',
            oldest: 'p.created_at ASC',
            price_asc: 'p.price ASC',
            price_desc: 'p.price DESC',
            popular: 'p.views_count DESC'
        };
        const orderBy = sortMap[sort] || 'p.featured DESC, p.created_at DESC';

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const dataResult = await query(
            `SELECT p.id, p.title, p.price, p.negotiable, p.condition, p.location, p.lat, p.lng,
                    p.images, p.views_count, p.featured, p.featured_amount, p.created_at,
                    c.name as category_name, c.slug as category_slug,
                    u.full_name as seller_name, u.phone as seller_phone, u.avatar_url as seller_avatar
             FROM products p
             JOIN users u ON u.id = p.user_id
             LEFT JOIN categories c ON c.id = p.category_id
             ${whereClause}
             ORDER BY ${orderBy}
             LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
            [...params, limit, offset]
        );

        const countResult = await query(
            `SELECT COUNT(*) FROM products p LEFT JOIN categories c ON c.id = p.category_id ${whereClause}`,
            params
        );

        res.json({
            success: true,
            products: dataResult.rows,
            pagination: {
                page,
                limit,
                total: parseInt(countResult.rows[0].count),
                pages: Math.ceil(countResult.rows[0].count / limit)
            }
        });
    } catch (err) {
        console.error('Get products error:', err);
        res.status(500).json({ success: false, message: 'Could not fetch listings.' });
    }
};

const getProduct = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(
            `SELECT p.*, c.name as category_name, c.slug as category_slug,
                    u.id as seller_user_id, u.full_name as seller_name, u.phone as seller_phone,
                    u.whatsapp as seller_whatsapp,
                    u.avatar_url as seller_avatar, u.location as seller_location,
                    u.created_at as seller_joined
             FROM products p
             JOIN users u ON u.id = p.user_id
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE p.id = $1 AND (p.status = 'active' OR p.user_id = $2)`,
            [id, req.user?.id || '00000000-0000-0000-0000-000000000000']
        );

        if (!result.rows[0]) {
            return res.status(404).json({ success: false, message: 'Listing not found.' });
        }

        await query('UPDATE products SET views_count = views_count + 1 WHERE id = $1', [id]);

        let isFavorited = false;
        if (req.user) {
            const fav = await query(
                'SELECT id FROM favorites WHERE user_id = $1 AND product_id = $2',
                [req.user.id, id]
            );
            isFavorited = !!fav.rows[0];
        }

        const related = await query(
            `SELECT id, title, price, images, location FROM products
             WHERE category_id = $1 AND status = 'active' AND id != $2
             ORDER BY created_at DESC LIMIT 4`,
            [result.rows[0].category_id, id]
        );

        res.json({
            success: true,
            product: { ...result.rows[0], isFavorited },
            related: related.rows
        });
    } catch (err) {
        console.error('Get product error:', err);
        res.status(500).json({ success: false, message: 'Could not fetch listing.' });
    }
};

const updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, price, condition, location, negotiable } = req.body;

        const existing = await query(
            'SELECT user_id, status, images FROM products WHERE id = $1',
            [id]
        );
        if (!existing.rows[0]) {
            return res.status(404).json({ success: false, message: 'Listing not found.' });
        }
        if (existing.rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Not authorized.' });
        }

        let images = existing.rows[0].images || [];
        if (req.files && req.files.length > 0) {
            images = [];
            for (const file of req.files) {
                const img = getImageUrl(file);
                if (img) images.push(img);
            }
        }

        const result = await query(
            `UPDATE products SET
             title = COALESCE($1, title), description = COALESCE($2, description),
             price = COALESCE($3, price), condition = COALESCE($4, condition),
             location = COALESCE($5, location), negotiable = COALESCE($6, negotiable),
             images = $7, status = 'pending', updated_at = NOW()
             WHERE id = $8 RETURNING *`,
            [title, description, price ? parseFloat(price) : null, condition,
             location, negotiable !== undefined ? (negotiable === 'true' || negotiable === true) : null,
             JSON.stringify(images), id]
        );

        res.json({ success: true, message: 'Listing updated and sent for review.', product: result.rows[0] });
    } catch (err) {
        console.error('Update product error:', err);
        res.status(500).json({ success: false, message: 'Could not update listing.' });
    }
};

const deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await query('SELECT user_id FROM products WHERE id = $1', [id]);
        if (!existing.rows[0]) {
            return res.status(404).json({ success: false, message: 'Listing not found.' });
        }
        if (existing.rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Not authorized.' });
        }

        await query(`UPDATE products SET status = 'deleted' WHERE id = $1`, [id]);
        res.json({ success: true, message: 'Listing deleted.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not delete listing.' });
    }
};

const getUserProducts = async (req, res) => {
    try {
        const { status } = req.query;
        const conditions = ['p.user_id = $1', `p.status != 'deleted'`];
        const params = [req.user.id];

        if (status) {
            conditions.push(`p.status = $2`);
            params.push(status);
        }

        const result = await query(
            `SELECT p.*, c.name as category_name FROM products p
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY p.created_at DESC`,
            params
        );

        res.json({ success: true, products: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not fetch your listings.' });
    }
};

const toggleFavorite = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await query(
            'SELECT id FROM favorites WHERE user_id = $1 AND product_id = $2',
            [req.user.id, id]
        );

        if (existing.rows[0]) {
            await query('DELETE FROM favorites WHERE user_id = $1 AND product_id = $2', [req.user.id, id]);
            res.json({ success: true, favorited: false, message: 'Removed from saved.' });
        } else {
            await query('INSERT INTO favorites (user_id, product_id) VALUES ($1, $2)', [req.user.id, id]);
            res.json({ success: true, favorited: true, message: 'Saved!' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not update saved listing.' });
    }
};

const getFavorites = async (req, res) => {
    try {
        const result = await query(
            `SELECT p.id, p.title, p.price, p.images, p.location, p.status, p.condition,
                    f.created_at as saved_at
             FROM favorites f JOIN products p ON p.id = f.product_id
             WHERE f.user_id = $1 ORDER BY f.created_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, favorites: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not fetch saved listings.' });
    }
};

const getCategories = async (req, res) => {
    try {
        const result = await query(
            `SELECT c.*, COUNT(p.id) FILTER (WHERE p.status = 'active') as product_count
             FROM categories c
             LEFT JOIN products p ON p.category_id = c.id
             WHERE c.is_active = true
             GROUP BY c.id ORDER BY c.sort_order ASC`
        );
        res.json({ success: true, categories: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not fetch categories.' });
    }
};

const reportProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason, description } = req.body;
        if (!reason) return res.status(400).json({ success: false, message: 'Reason required.' });

        await query(
            'INSERT INTO reports (reporter_id, product_id, reason, description) VALUES ($1, $2, $3, $4)',
            [req.user.id, id, reason, description]
        );
        res.json({ success: true, message: 'Report submitted. Our team will review it.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not submit report.' });
    }
};

const getFeaturedProducts = async (req, res) => {
    try {
        const limit = Math.min(50, parseInt(req.query.limit) || 20);

        const result = await query(
            `SELECT p.id, p.title, p.price, p.negotiable, p.condition, p.location, p.images,
                    p.featured, p.featured_amount, p.views_count, p.created_at,
                    u.full_name as seller_name, u.phone as seller_phone,
                    c.name as category_name, c.slug as category_slug
             FROM products p
             LEFT JOIN users u ON u.id = p.user_id
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE p.status = 'active' AND p.featured = true
             ORDER BY p.featured_amount DESC, p.created_at DESC
             LIMIT $1`,
            [limit]
        );

        const top10 = await query(
            `SELECT p.id, p.title, p.price, p.condition, p.location, p.images,
                    p.featured, p.featured_amount, p.views_count, p.created_at,
                    u.full_name as seller_name,
                    c.name as category_name
             FROM products p
             LEFT JOIN users u ON u.id = p.user_id
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE p.status = 'active'
             ORDER BY p.featured_amount DESC NULLS LAST, p.views_count DESC, p.created_at DESC
             LIMIT 10`
        );

        res.json({
            success: true,
            featured: result.rows,
            top10: top10.rows
        });
    } catch (err) {
        console.error('getFeaturedProducts error:', err);
        res.status(500).json({ success: false, message: 'Could not fetch featured products.' });
    }
};

module.exports = {
    createProduct, productValidation, getProducts, getProduct,
    updateProduct, deleteProduct, getUserProducts,
    toggleFavorite, getFavorites, getCategories, reportProduct, getFeaturedProducts
};
