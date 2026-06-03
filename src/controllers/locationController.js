const { query } = require('../config/db');

const getLocations = async (req, res) => {
    try {
        const result = await query(
            `SELECT id, name, lat, lng, county, distance_from_chogoria
             FROM locations WHERE is_active = true
             ORDER BY distance_from_chogoria ASC, name ASC`
        );
        res.json({ success: true, locations: result.rows });
    } catch (err) {
        console.error('Get locations error:', err);
        res.status(500).json({ success: false, message: 'Could not fetch locations.' });
    }
};

const saveUserLocation = async (req, res) => {
    try {
        const { lat, lng, location_name } = req.body;
        if (lat === undefined || lng === undefined) {
            return res.status(400).json({ success: false, message: 'lat and lng are required.' });
        }
        await query(
            `UPDATE users SET lat = $1, lng = $2, location = COALESCE($3, location), updated_at = NOW() WHERE id = $4`,
            [parseFloat(lat), parseFloat(lng), location_name || null, req.user.id]
        );
        res.json({ success: true, message: 'Location saved successfully.' });
    } catch (err) {
        console.error('Save location error:', err);
        res.status(500).json({ success: false, message: 'Could not save location.' });
    }
};

const getNearbyProducts = async (req, res) => {
    try {
        const { lat, lng, radius = 20, limit = 20 } = req.query;
        if (!lat || !lng) {
            return res.status(400).json({ success: false, message: 'lat and lng query params required.' });
        }
        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        const km = parseFloat(radius);
        const lim = Math.min(50, parseInt(limit) || 20);

        const result = await query(
            `SELECT sub.* FROM (
                SELECT p.id, p.title, p.price, p.negotiable, p.condition,
                       p.location, p.lat, p.lng, p.images, p.views_count,
                       p.featured, p.featured_amount, p.created_at,
                       c.name as category_name, c.slug as category_slug,
                       u.full_name as seller_name,
                       (6371 * acos(LEAST(1.0,
                           cos(radians($1)) * cos(radians(p.lat::float)) *
                           cos(radians(p.lng::float) - radians($2)) +
                           sin(radians($1)) * sin(radians(p.lat::float))
                       ))) AS distance_km
                FROM products p
                JOIN users u ON u.id = p.user_id
                LEFT JOIN categories c ON c.id = p.category_id
                WHERE p.status = 'active' AND p.lat IS NOT NULL AND p.lng IS NOT NULL
             ) sub
             WHERE sub.distance_km < $3
             ORDER BY sub.distance_km ASC
             LIMIT $4`,
            [userLat, userLng, km, lim]
        );

        res.json({ success: true, products: result.rows });
    } catch (err) {
        console.error('Get nearby products error:', err);
        res.status(500).json({ success: false, message: 'Could not fetch nearby products.' });
    }
};

module.exports = { getLocations, saveUserLocation, getNearbyProducts };
