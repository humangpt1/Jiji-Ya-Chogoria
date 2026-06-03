# Jiji ya Chogoria - Marketplace

A full-stack commercial marketplace for Chogoria, Tharaka-Nithi. Built with Node.js + NeonDB (PostgreSQL).

## Architecture

- **Backend**: Node.js + Express 5
- **Database**: NeonDB (PostgreSQL via `pg` pool)
- **Auth**: JWT (stored in localStorage)
- **Payments**: MegaPay (megapay.co.ke) STK Push — subscription (KES 100/mo) + boost (KES 300+)
- **Frontend**: Vanilla JS SPA — black/orange dark theme, Poppins font, mobile-first

## Key Features

- JWT auth + role-based access (user/admin/moderator)
- M-Pesa STK Push for subscription payments (KES 100/month) and boost payments (KES 300+)
- Featured/boost system: `featured_amount` accumulates per product; higher amount = higher rank on Featured page
- Admin panel: pending listings moderation, user management, payment history, reports
- Category strip navbar, mobile bottom navigation (5 tabs with raised Featured button)
- Featured page with top-10 leaderboard (gold/silver/bronze rank), boost modal with tier selection
- Boost button on own listings in product detail and My Listings page
- Payment history shows subscription vs boost type

## Project Structure

```
server.js              # Express app entry point
src/
  config/db.js         # PostgreSQL pool
  middleware/
    auth.js            # JWT auth, subscription check, admin guard
    validate.js        # express-validator error handler
  controllers/
    authController.js  # Register, login, profile, password
    productController.js # CRUD listings, favorites, categories, reports
    paymentController.js # M-Pesa STK push, callback, subscription
    adminController.js  # Dashboard, moderation, user mgmt
    notificationController.js
  routes/              # Express routers
  services/megapay.js  # MegaPay (megapay.co.ke) STK Push service
database/
  schema.sql           # Full DB schema
  migrate.js           # Migration runner
public/
  index.html           # SPA frontend
  css/style.css        # Mobile-first styles
  js/app.js            # All frontend JS
uploads/               # Uploaded images
```

## Database Tables

- **users** — accounts, roles (user/admin/moderator)
- **subscriptions** — one-per-user, status/expires_at
- **payments** — M-Pesa STK records, callback data
- **products** — listings with JSONB images, full-text search index
- **categories** — 10 default categories
- **favorites** — user wishlists
- **messages** — buyer-seller inquiries
- **notifications** — in-app alerts
- **admin_logs** — audit trail
- **reports** — spam/fraud reporting

## Key Features

- User registration/login with JWT
- M-Pesa STK Push membership (KES 100/month)
- Automatic subscription activation on M-Pesa callback
- Product posting blocked without active membership
- Product moderation (pending → active/rejected)
- Admin panel: dashboard, user management, reports
- Mobile-first responsive design
- Rate limiting, helmet, CORS protection
- Full-text search on product title/description

## Environment Variables

Set via Replit Secrets:
- `DATABASE_URL` — NeonDB connection string
- `JWT_SECRET` — JWT signing secret
- `MEGAPAY_API_KEY` — MegaPay API key (from megapay.co.ke dashboard)
- `MEGAPAY_EMAIL` — Email registered on MegaPay account
- `MEGAPAY_CALLBACK_URL` — Public webhook URL (set in MegaPay dashboard)
- `ADMIN_SECRET` — Default admin password

Set via env vars (non-sensitive):
- `PORT=5000`
- `MPESA_SHORTCODE=174379`
- `MPESA_PASSKEY=...` (sandbox)
- `MPESA_ENV=sandbox` (change to `production` for live)
- `SUBSCRIPTION_AMOUNT=100`
- `SUBSCRIPTION_DAYS=30`

## Admin Access

Login: `admin@jijichogoria.co.ke` / your ADMIN_SECRET value

## Running

```bash
npm start          # Start server
npm run migrate    # Run DB migrations
```
