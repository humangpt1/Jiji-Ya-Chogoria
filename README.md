# 🛍️ Jiji ya Chogoria

> **The #1 local marketplace for Chogoria, Tharaka-Nithi County, Kenya.**
> Buy and sell electronics, fashion, furniture, farm produce, services and more — 100% locally.

[![Node.js](https://img.shields.io/badge/Node.js-Express_5-339933?logo=node.js)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/Database-NeonDB_(PostgreSQL)-4169E1?logo=postgresql)](https://neon.tech)
[![Cloudinary](https://img.shields.io/badge/Images-Cloudinary-3448C5?logo=cloudinary)](https://cloudinary.com)
[![MegaPay](https://img.shields.io/badge/Payments-MegaPay_(M--Pesa)-00B200)](https://megapay.co.ke)

---

## 📱 What the App Covers

| Feature | Status |
|---|---|
| User registration & login (email/password + Google Sign-In) | ✅ Live |
| JWT authentication + role-based access (user / moderator / admin) | ✅ Live |
| Product listings — post, browse, search, filter by category/location | ✅ Live |
| Image upload via Cloudinary (up to 6 photos per listing) | ✅ Live |
| M-Pesa STK Push subscription (KES 100/month via MegaPay) | ✅ Live |
| Free listings allowance (configurable — default 2 free posts) | ✅ Live |
| Featured / Boost system — pay to rank higher on the Featured page | ✅ Live |
| Featured page with Top-10 leaderboard (gold/silver/bronze) | ✅ Live |
| Local Shops — sellers can create a shop profile | ✅ Live |
| Community Chat — open public chat for Chogoria locals | ✅ Live |
| Favorites / Wishlist | ✅ Live |
| In-app Notifications | ✅ Live |
| Admin panel — listings moderation, user management, reports, settings | ✅ Live |
| Location-aware listings (22 Chogoria-area locations with GPS coords) | ✅ Live |
| Password reset via email (Nodemailer / Gmail) | ✅ Live |
| Mobile-first SPA with bottom navigation | ✅ Live |
| Android APK download page | ✅ Live |
| Multi-DB failover (DATABASE_URL_2 / _3) | ✅ Live |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Browser / PWA                      │
│           Vanilla JS SPA (index.html)                │
│      Black/Orange theme · Poppins · Mobile-first     │
└───────────────────────┬──────────────────────────────┘
                        │ REST API (JSON)
┌───────────────────────▼──────────────────────────────┐
│               Node.js + Express 5                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │   Auth   │  │ Products │  │   Payments       │   │
│  │ JWT+RBAC │  │ CRUD+FTS │  │ MegaPay STK Push │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │  Shops   │  │  Admin   │  │  Notifications   │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
└───────────────────────┬──────────────────────────────┘
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
     NeonDB          Cloudinary     MegaPay
   (PostgreSQL)    (Image CDN)   (M-Pesa STK)
```

## 📁 Project Structure

```
jiji-ya-chogoria/
├── server.js                    # Express app entry point
├── .env.example                 # Environment variable template (copy → .env)
├── vercel.json                  # Vercel deployment config
├── database/
│   ├── schema.sql               # Full PostgreSQL schema (safe to re-run)
│   └── migrate.js               # Migration runner + admin seed
├── src/
│   ├── config/db.js             # PostgreSQL pool + multi-DB failover
│   ├── middleware/
│   │   ├── auth.js              # JWT decode, requireAuth, requireSubscription, adminGuard
│   │   └── validate.js          # express-validator error handler
│   ├── controllers/
│   │   ├── authController.js    # Register, login, Google OAuth, profile, password reset
│   │   ├── productController.js # CRUD listings, search, favorites, reports, categories
│   │   ├── paymentController.js # MegaPay STK Push, callback, subscription status
│   │   ├── adminController.js   # Dashboard, moderation, user mgmt, settings
│   │   └── notificationController.js
│   ├── routes/                  # Express routers
│   └── services/megapay.js      # MegaPay API integration
├── public/
│   ├── index.html               # SPA — all pages in one HTML file
│   ├── css/style.css            # Mobile-first styles (black/orange theme)
│   └── js/app.js                # All frontend JavaScript
└── uploads/                     # Local upload fallback (Cloudinary is primary)
```

---

## 🚀 Getting Started

### 1. Clone & Install

```bash
git clone <repo-url>
cd jiji-ya-chogoria
npm install
```

### 2. Environment Setup

```bash
cp .env.example .env
# Edit .env with your actual credentials
```

### 3. Run Database Migration

```bash
npm run migrate
# Creates all tables + seeds default categories + creates admin account
```

### 4. Start the Server

```bash
npm start          # Production
npm run dev        # Development (with nodemon)
```

App runs at **http://localhost:5000**

---

## 🔑 Key Credentials & Access

| Service | Detail |
|---|---|
| **Admin Login** | `smontana025@gmail.com` / `<ADMIN_SECRET>` |
| **Admin Panel** | Login → avatar → Admin (role must be `admin`) |
| **MegaPay Callback** | `POST /api/payments/megapay-callback` |
| **Health Check** | `GET /api/health` |

---

## 💳 Payment Flow

```
User clicks "Pay KES 100" 
    → POST /api/payments/initiate
    → MegaPay STK Push → Phone vibrates
    → User enters M-Pesa PIN
    → MegaPay sends callback → POST /api/payments/megapay-callback
    → Subscription activated automatically
    → User can now post listings
```

### Boost Flow
```
Seller opens listing → "Boost" button
    → Selects tier (KES 300 / 500 / 1000+)
    → STK Push → PIN → Callback
    → featured_amount incremented on product
    → Product ranks higher on /featured page
```

---

## 🗄️ Database Tables

| Table | Purpose |
|---|---|
| `users` | Accounts, roles, Google OAuth |
| `subscriptions` | One-per-user membership (active/inactive) |
| `payments` | All M-Pesa transactions (subscription + boost) |
| `products` | Listings with JSONB images, full-text search index |
| `categories` | 17 default categories |
| `shops` | Seller shop profiles |
| `favorites` | User wishlists |
| `messages` | Buyer-seller DMs (per listing) |
| `community_messages` | Public community chat |
| `notifications` | In-app alerts |
| `admin_logs` | Audit trail |
| `reports` | Spam/fraud reports |
| `app_settings` | Key-value runtime settings (fee amounts, toggles) |
| `password_reset_tokens` | Email-based password reset |
| `locations` | 22 Chogoria-area locations with GPS coordinates |

---

## ⚙️ Admin Settings

Accessible via **Admin Panel → Settings**:

| Setting Key | Default | Description |
|---|---|---|
| `paid_posting_enabled` | `true` | Require payment to post |
| `free_posts_per_user` | `2` | Free listings before payment required |
| `posting_fee` | `100` | Membership fee in KES |
| `subscription_days` | `30` | Days membership is valid |
| `min_boost_amount` | `300` | Minimum boost amount in KES |
| `site_announcement` | `` | Banner shown to all users |
| `apk_url` | `` | Android APK download URL |
| `apk_version` | `1.0.0` | Current APK version string |

---

## 🌍 Environment Variables

See [`.env.example`](./.env.example) for the full list.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | NeonDB connection string |
| `JWT_SECRET` | ✅ | JWT signing secret |
| `ADMIN_SECRET` | ✅ | Default admin password |
| `MEGAPAY_API_KEY` | ✅ | MegaPay API key |
| `MEGAPAY_EMAIL` | ✅ | MegaPay account email |
| `MEGAPAY_CALLBACK_URL` | ✅ | Public webhook URL |
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth Client ID |
| `CLOUDINARY_CLOUD_NAME` | ✅ | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | ✅ | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | ✅ | Cloudinary API secret |
| `GMAIL_USER` | ✅ | Gmail address for email sending |
| `GMAIL_APP_PASSWORD` | ✅ | Gmail App Password (not account password) |

---

## ☁️ Deployment (Vercel)

```bash
vercel --prod
```

Make sure to:
1. Set all environment variables in the Vercel dashboard
2. Set `MEGAPAY_CALLBACK_URL` to your production URL
3. Add your production domain to Google OAuth allowed origins

---

## 📋 To-Do List

> The next AI agent working on this project should check off completed items.

### 🔴 High Priority
- [ ] **Phone OTP verification** — verify seller phone numbers before allowing posts
- [ ] **Listing expiry auto-renewal** — email + in-app reminder 7 days before 60-day expiry
- [ ] **Image compression on upload** — client-side resize before sending to Cloudinary
- [ ] **Offline support / PWA** — service worker + manifest.json for installability
- [ ] **Push notifications** — Web Push API for new messages and listing approvals

### 🟡 Medium Priority
- [ ] **Product reviews** — buyers leave star ratings + comments on sellers
- [ ] **Seller verification badge** — admin-verified sellers get a checkmark
- [ ] **WhatsApp deep-link button** — tap to chat with seller directly in WhatsApp
- [ ] **Similar listings widget** — "You might also like" on product detail page
- [ ] **Price history chart** — show listing price changes over time
- [ ] **Bulk moderation** — admin can approve/reject multiple listings at once
- [ ] **CSV export** — admin can export users/listings/payments to CSV
- [ ] **Location map view** — Leaflet map showing listings as pins on the Shops/Browse page
- [ ] **Share listing** — native share API + WhatsApp share button on listings

### 🟢 Nice to Have
- [ ] **Dark/light mode toggle** — persist to localStorage
- [ ] **Multi-language** — Swahili (sw) alongside English
- [ ] **Seller stats page** — views, contacts, favorites per listing over time
- [ ] **Listing scheduling** — draft listings that auto-publish on a set date
- [ ] **Admin revenue dashboard** — charts of subscription revenue, boost revenue, daily signups
- [ ] **Category badges** — show listing count per category on category cards
- [ ] **Trending searches** — show top search terms on browse page
- [ ] **Featured banner slots** — paid premium banner ads on the home page

---

## 🛡️ Security

- Rate limiting on all API routes (express-rate-limit)
- Helmet.js security headers
- CORS restricted to allowed origins
- JWT with expiry
- Passwords hashed with bcryptjs (salt rounds: 12)
- Input validation via express-validator on all endpoints
- SQL injection protected via parameterized queries (pg pool)
- Cloudinary signed uploads (API secret never exposed to client)

---

## 📄 License

Private — All rights reserved. Jiji ya Chogoria, Chogoria Town, Tharaka-Nithi County, Kenya.
# Jiji-Ya-Chogoria
