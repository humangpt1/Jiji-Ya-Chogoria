// ═══════════════════════════════════════════════════════════════
//  Jiji ya Chogoria - Frontend Application
// ═══════════════════════════════════════════════════════════════

const API = "/api";
let currentUser = null;
let authToken = localStorage.getItem("jiji_token");
let currentProductId = null;
let currentPage = "home";
let categoriesCache = [];
let listingsFilters = { page: 1 };
let pendingModerationId = null;
let pendingModerationAction = null;
let paymentPollInterval = null;
let currentCheckoutId = null;
let boostProductId = null;
let uploadedImages = []; // Pre-uploaded Cloudinary image objects {url, public_id}
let currentConvId = null;
let dmPollTimer = null;
let dmLastMsgTime = null;
const dmConvMap = new Map(); // convId -> conv object

// ─── THEME (light/dark) ───────────────────────────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem("jiji_theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  const btn = document.getElementById("themeToggle");
  if (btn)
    btn.innerHTML =
      saved === "light"
        ? '<i class="fas fa-moon"></i>'
        : '<i class="fas fa-sun"></i>';
})();

// ─── LOCATION SYSTEM ────────────────────────────────────────────────────────
const CHOGORIA = { lat: -0.3667, lng: 37.7033 };
let userLocation = JSON.parse(
  localStorage.getItem("jiji_user_location") || "null",
);
let locationsCache = [];
let leafletMap = null;

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km) {
  if (km < 0.5) return "< 1 km";
  if (km < 10) return `${Math.round(km * 10) / 10} km`;
  return `${Math.round(km)} km`;
}

// ─── API HELPER ────────────────────────────────────────────────
async function api(method, path, data, isForm = false) {
  const opts = { method, headers: {} };
  if (authToken) opts.headers["Authorization"] = `Bearer ${authToken}`;
  if (data && !isForm) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(data);
  } else if (isForm) {
    opts.body = data;
  }
  const res = await fetch(`${API}${path}`, opts);
  const json = await res.json();
  if (!res.ok && res.status === 401) {
    logout(true);
    throw json;
  }
  return json;
}

// ─── TOAST ────────────────────────────────────────────────────
function toast(msg, type = "default", duration = 3500) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), duration);
}

// ─── PAGE ROUTER ──────────────────────────────────────────────
function showPage(name) {
  if (name !== "messages") stopDMPoll();
  document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
  const page = document.getElementById(`page-${name}`);
  if (page) page.classList.remove("hidden");
  currentPage = name;
  closeDropdowns();
  window.scrollTo(0, 0);
  updateBottomNavActive(name);
  updateNavLinkActive(name);
  // Show footer only on content pages, hide on auth/form pages
  const footer = document.getElementById("siteFooter");
  if (footer) {
    const hideFooterOn = [
      "login",
      "register",
      "forgot-password",
      "reset-password",
      "post-ad",
      "profile",
      "admin",
    ];
    footer.style.display = hideFooterOn.includes(name) ? "none" : "";
  }
  onPageLoad(name);
}

function onPageLoad(name) {
  switch (name) {
    case "home":
      loadHome();
      break;
    case "listings":
      loadListings();
      break;
    case "featured":
      loadFeatured();
      break;
    case "dashboard":
      loadDashboard();
      break;
    case "my-ads":
      loadMyAds();
      break;
    case "favorites":
      loadFavorites();
      break;
    case "payments":
      loadPayments();
      break;
    case "notifications":
      loadNotifications();
      break;
    case "profile":
      loadProfile();
      break;
    case "post-ad":
      loadPostAd();
      break;
    case "admin":
      loadAdmin();
      break;
    case "product":
      loadProductDetail();
      break;
    case "shops":
      loadShops();
      break;
    case "chat":
      loadChat();
      break;
    case "messages":
      loadMessages();
      break;
    case "download-app":
      loadDownloadApp();
      break;
    case "forgot-password":
      loadForgotPassword();
      break;
    case "reset-password":
      loadResetPassword();
      break;
    case "register":
      loadRegisterPage();
      break;
  }
}

async function loadRegisterPage() {
  await getLocations();
  populateLocationSelect(document.getElementById("regLocation"));
}

// ─── BOTTOM NAV ────────────────────────────────────────────────
function setBottomNav(el) {
  updateBottomNavActive(el.dataset.page);
}

function updateBottomNavActive(pageName) {
  document
    .querySelectorAll(".bot-nav-item")
    .forEach((a) => a.classList.remove("active"));
  const activeNav = document.querySelector(
    `.bot-nav-item[data-page="${pageName}"]`,
  );
  if (activeNav) activeNav.classList.add("active");
  else if (["dashboard", "my-ads", "favorites", "profile"].includes(pageName)) {
    document
      .querySelector('.bot-nav-item[data-page="account"]')
      ?.classList.add("active");
  }
}

function updateNavLinkActive(pageName) {
  document
    .querySelectorAll(".nav-link")
    .forEach((a) => a.classList.remove("active"));
  const link = document.querySelector(`.nav-link[data-page="${pageName}"]`);
  if (link) link.classList.add("active");
}

function handlePostAdMobile() {
  if (!currentUser) {
    showPage("login");
    return;
  }
  showPage("post-ad");
}

function handleAccountNav() {
  if (!currentUser) {
    showPage("login");
    return;
  }
  showPage("dashboard");
}

// ─── AUTH ──────────────────────────────────────────────────────
async function checkAuth() {
  if (!authToken) {
    updateNavGuest();
    return;
  }
  try {
    const res = await api("GET", "/auth/me");
    if (res.success) {
      currentUser = res.user;
      updateNavUser();
      loadNotifCount();
      loadDMUnreadCount();
      setInterval(loadDMUnreadCount, 30000);
    } else {
      logout(true);
    }
  } catch {
    logout(true);
  }
}

function updateNavUser() {
  document.getElementById("navGuest").classList.add("hidden");
  document.getElementById("navUser").classList.remove("hidden");
  document.getElementById("mobileGuest").classList.add("hidden");
  document.getElementById("mobileUser").classList.remove("hidden");
  const initials = (currentUser.full_name || "U").charAt(0).toUpperCase();
  document.getElementById("navAvatar").textContent = initials;
  document.getElementById("dropdownName").textContent = currentUser.full_name;
  // Mobile sidebar user card
  const card = document.getElementById("mobileUserCard");
  if (card) {
    card.classList.remove("hidden");
    const av = document.getElementById("mobileCardAvatar");
    const nm = document.getElementById("mobileCardName");
    const sub = document.getElementById("mobileCardSub");
    if (av) av.textContent = initials;
    if (nm) nm.textContent = currentUser.full_name || "My Account";
    if (sub)
      sub.textContent =
        currentUser.role === "admin"
          ? "⭐ Admin"
          : currentUser.role === "moderator"
            ? "🛡 Moderator"
            : "Member";
  }
  if (currentUser.role === "admin" || currentUser.role === "moderator") {
    const existing = document.querySelector(".admin-nav-link");
    if (!existing) {
      const adminLink = document.createElement("a");
      adminLink.href = "#";
      adminLink.className = "admin-nav-link";
      adminLink.innerHTML = '<i class="fas fa-shield-alt"></i> Admin Panel';
      adminLink.onclick = () => {
        showPage("admin");
        closeDropdowns();
      };
      const hr = document.querySelector(".user-dropdown hr");
      if (hr)
        document.getElementById("userDropdown").insertBefore(adminLink, hr);
    }
  }
}

function updateNavGuest() {
  document.getElementById("navGuest").classList.remove("hidden");
  document.getElementById("navUser").classList.add("hidden");
  document.getElementById("mobileGuest").classList.remove("hidden");
  document.getElementById("mobileUser").classList.add("hidden");
  const card = document.getElementById("mobileUserCard");
  if (card) card.classList.add("hidden");
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById("loginBtn");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
  try {
    const res = await api("POST", "/auth/login", {
      email: document.getElementById("loginEmail").value,
      password: document.getElementById("loginPassword").value,
    });
    if (res.success) {
      authToken = res.token;
      localStorage.setItem("jiji_token", authToken);
      currentUser = res.user;
      updateNavUser();
      toast("Welcome back, " + res.user.full_name + "!", "success");
      showPage("dashboard");
    } else {
      toast(res.message, "error");
    }
  } catch (err) {
    toast(err.message || "Login failed", "error");
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = document.getElementById("regBtn");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating account...';
  try {
    const res = await api("POST", "/auth/register", {
      full_name: document.getElementById("regName").value,
      email: document.getElementById("regEmail").value,
      phone: document.getElementById("regPhone").value,
      password: document.getElementById("regPassword").value,
      location: document.getElementById("regLocation").value,
    });
    if (res.success) {
      authToken = res.token;
      localStorage.setItem("jiji_token", authToken);
      currentUser = res.user;
      updateNavUser();
      toast("Account created! Welcome to Jiji ya Chogoria!", "success");
      showPage("dashboard");
    } else {
      toast(res.message, "error");
    }
  } catch (err) {
    toast(err.message || "Registration failed", "error");
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-user-plus"></i> Create Account';
}

function logout(silent = false) {
  authToken = null;
  currentUser = null;

  localStorage.removeItem("jiji_token");
  localStorage.removeItem("jiji_featured");
  localStorage.removeItem("jiji_recent");

  updateNavGuest();

  if (!silent) {
    toast("Logged out successfully.", "success");
  }

  showPage("home");
}

function togglePw(id, btn) {
  const input = document.getElementById(id);
  const isText = input.type === "text";
  input.type = isText ? "password" : "text";
  btn.innerHTML = isText
    ? '<i class="fas fa-eye"></i>'
    : '<i class="fas fa-eye-slash"></i>';
}

// ─── NAVIGATION HELPERS ────────────────────────────────────────
function toggleUserMenu() {
  // On mobile, opening the sidebar is more useful than the small dropdown
  if (window.innerWidth <= 900) {
    openMobileMenu();
    return;
  }
  document.getElementById("userDropdown").classList.toggle("hidden");
}

function openMobileMenu() {
  document.getElementById("mobileMenu")?.classList.add("menu-open");
  document.getElementById("menuOverlay")?.classList.add("active");
  document.getElementById("hamburger")?.classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeMobileMenu() {
  document.getElementById("mobileMenu")?.classList.remove("menu-open");
  document.getElementById("menuOverlay")?.classList.remove("active");
  document.getElementById("hamburger")?.classList.remove("open");
  document.body.style.overflow = "";
}
function toggleMobileMenu() {
  const isOpen = document
    .getElementById("mobileMenu")
    ?.classList.contains("menu-open");
  isOpen ? closeMobileMenu() : openMobileMenu();
}
function closeDropdowns() {
  document.getElementById("userDropdown")?.classList.add("hidden");
  closeMobileMenu();
}
document.addEventListener("click", (e) => {
  // Close user dropdown when clicking elsewhere
  if (!e.target.closest(".nav-avatar") && !e.target.closest(".user-dropdown")) {
    document.getElementById("userDropdown")?.classList.add("hidden");
  }
  // Auto-close mobile menu when tapping outside it (on any device)
  if (
    !e.target.closest(".mobile-menu") &&
    !e.target.closest(".hamburger") &&
    !e.target.closest(".nav-avatar")
  ) {
    closeMobileMenu();
  }
});

// ─── SEARCH ───────────────────────────────────────────────────
function handleSearchKey(e) {
  if (e.key === "Enter") doSearch();
}
function doSearch() {
  const q = document.getElementById("searchInput").value.trim();
  if (q) {
    listingsFilters = { page: 1, search: q };
    showPage("listings");
  }
}
function doMobileSearch() {
  const q = document.getElementById("mobileSearch").value.trim();
  if (q) {
    listingsFilters = { page: 1, search: q };
    showPage("listings");
    closeMobileMenu();
  }
}
function doHeroSearch() {
  const q = document.getElementById("heroSearch").value.trim();
  const cat = document.getElementById("heroCategory").value;
  listingsFilters = {
    page: 1,
    search: q || undefined,
    category: cat || undefined,
  };
  showPage("listings");
}

// ─── HOME PAGE ─────────────────────────────────────────────────
async function loadHome() {
  await loadCategories();
  renderCategoriesHome();
  loadFeaturedProducts();
  loadRecentProducts();
}

// ─── localStorage cache helpers ──────────────────────────────
function lsSet(key, data, ttlMs) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ data, exp: Date.now() + ttlMs }),
    );
  } catch {}
}
function lsGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (Date.now() > p.exp) {
      localStorage.removeItem(key);
      return null;
    }
    return p.data;
  } catch {
    return null;
  }
}

async function loadCategories() {
  if (categoriesCache.length) return;
  const cached = lsGet("jiji_categories");
  if (cached && cached.length) {
    categoriesCache = cached;
    populateCategorySelects();
  }
  try {
    const res = await api("GET", "/products/categories");
    if (res.success) {
      categoriesCache = res.categories;
      lsSet("jiji_categories", res.categories, 60 * 60 * 1000);
      populateCategorySelects();
    }
  } catch {}
}
function renderCategoriesHome() {
  const grid = document.getElementById("categoriesGrid");
  if (!categoriesCache.length) {
    grid.innerHTML = "";
    return;
  }

  grid.innerHTML = categoriesCache
    .map(
      (c) => `
        <a class="category-card" href="#" onclick="filterByCategory('${c.slug}');return false;">
            <i class="${c.icon || "fas fa-tag"}"></i>
            <div class="cat-name">${c.name}</div>
            <div class="cat-count">${c.product_count || 0} listings</div>
        </a>
    `,
    )
    .join("");

  // Stat
  const total = categoriesCache.reduce(
    (sum, c) => sum + parseInt(c.product_count || 0),
    0,
  );
  const statEl = document.getElementById("statListings");
  if (statEl) statEl.textContent = total.toLocaleString();

  // Category strip (desktop)
  const strip = document.getElementById("catStrip");
  if (strip) {
    strip.innerHTML = categoriesCache
      .map(
        (c) => `
            <a class="cat-strip-item" href="#" onclick="filterByCategory('${c.slug}');return false;">
                <i class="${c.icon || "fas fa-tag"}"></i> ${c.name}
            </a>
        `,
      )
      .join("");
  }

  // Mobile cats in menu
  const mobileCats = document.getElementById("mobileCats");
  if (mobileCats) {
    mobileCats.innerHTML =
      `<div style="padding:10px 0 4px;font-size:0.75rem;font-weight:700;color:var(--subtext2);text-transform:uppercase;letter-spacing:0.5px;">Categories</div>` +
      categoriesCache
        .slice(0, 6)
        .map(
          (c) =>
            `<a href="#" onclick="filterByCategory('${c.slug}');toggleMobileMenu()">
                    <i class="${c.icon || "fas fa-tag"}"></i> ${c.name}
                </a>`,
        )
        .join("");
  }

  // Footer categories
  const footer = document.getElementById("footerCategories");
  if (footer)
    footer.innerHTML = categoriesCache
      .slice(0, 5)
      .map(
        (c) =>
          `<a href="#" onclick="filterByCategory('${c.slug}');return false;">${c.name}</a>`,
      )
      .join("");
}

function populateCategorySelects() {
  // Filter/search selects use slug (backend filters by slug)
  const slugOpts = categoriesCache
    .map((c) => `<option value="${c.slug}">${c.name}</option>`)
    .join("");
  // Form selects use integer ID (backend validates category_id as integer)
  const idOpts = categoriesCache
    .map((c) => `<option value="${c.id}">${c.name}</option>`)
    .join("");

  ["heroCategory", "filterCategory", "shopCategoryFilter"].forEach((id) => {
    const el = document.getElementById(id);
    if (el)
      el.innerHTML = '<option value="">All Categories</option>' + slugOpts;
  });
  const adCat = document.getElementById("adCategory");
  if (adCat)
    adCat.innerHTML = '<option value="">Select category</option>' + idOpts;
  const shopCat = document.getElementById("shopCategory");
  if (shopCat)
    shopCat.innerHTML = '<option value="">Select category</option>' + idOpts;
}

function filterByCategory(slug) {
  listingsFilters = { page: 1, category: slug };
  showPage("listings");
}

async function loadFeaturedProducts() {
  const grid = document.getElementById("featuredGrid");
  const cached = lsGet("jiji_featured");
  if (cached && cached.length && grid)
    grid.innerHTML = cached.map(renderProductCard).join("");
  try {
    const res = await api("GET", "/products?limit=8&sort=popular");
    if (res.success && res.products.length) {
      if (grid) grid.innerHTML = res.products.map(renderProductCard).join("");
      lsSet("jiji_featured", res.products, 5 * 60 * 1000);
    } else if (!cached && grid) {
      grid.innerHTML =
        '<div class="empty-state small"><i class="fas fa-star"></i><p>No featured listings yet.</p></div>';
    }
  } catch {}
}
async function loadRecentProducts() {
  const grid = document.getElementById("recentGrid");
  const cached = lsGet("jiji_recent");
  if (cached && cached.length && grid)
    grid.innerHTML = cached.map(renderProductCard).join("");
  try {
    const res = await api("GET", "/products?limit=8&sort=newest");
    if (res.success && res.products.length) {
      if (grid) grid.innerHTML = res.products.map(renderProductCard).join("");
      lsSet("jiji_recent", res.products, 3 * 60 * 1000);
    } else if (!cached && grid) {
      grid.innerHTML =
        '<div class="empty-state small"><i class="fas fa-clock"></i><p>No listings yet. Be the first!</p></div>';
    }
  } catch {}
}
// ─── PRODUCT CARD RENDERER ─────────────────────────────────────
function renderProductCard(p) {
  const img =
    p.images && p.images.length > 0
      ? `<img class="product-img" src="${p.images[0].url}" alt="${escHtml(p.title)}" loading="lazy"
            onerror="this.parentNode.innerHTML='<div class=\\'product-img-placeholder\\'><i class=\\'fas fa-image\\'></i></div>'">`
      : `<div class="product-img-placeholder"><i class="fas fa-image"></i></div>`;
  const boostAmt =
    p.featured_amount && p.featured_amount > 0
      ? `<span class="featured-badge"><i class="fas fa-fire"></i> Boosted</span>`
      : "";

  let distBadge = "";
  if (p.distance_km !== undefined && p.distance_km !== null) {
    distBadge = `<span class="distance-badge"><i class="fas fa-location-arrow"></i> ${formatDistance(parseFloat(p.distance_km))} away</span>`;
  } else if (userLocation && p.lat && p.lng) {
    const d = haversine(
      userLocation.lat,
      userLocation.lng,
      parseFloat(p.lat),
      parseFloat(p.lng),
    );
    distBadge = `<span class="distance-badge"><i class="fas fa-location-arrow"></i> ${formatDistance(d)} away</span>`;
  }

  return `
    <div class="product-card" onclick="openProduct('${p.id}')">
        ${p.featured && !boostAmt ? '<span class="featured-badge"><i class="fas fa-star"></i> Featured</span>' : boostAmt}
        ${img}
        <div class="product-body">
            <div class="product-title">${escHtml(p.title)}</div>
            <div class="product-price">KES ${Number(p.price).toLocaleString()}</div>
            <div class="product-meta-row">
                <span class="product-location"><i class="fas fa-map-marker-alt"></i>${escHtml(p.location || "")}</span>
                <span class="condition-badge ${p.condition}">${p.condition || "used"}</span>
            </div>
            ${distBadge ? `<div class="product-dist-row">${distBadge}</div>` : ""}
        </div>
    </div>`;
}

// ─── FEATURED PAGE ─────────────────────────────────────────────
async function loadFeatured() {
  try {
    const res = await api("GET", "/products/featured");
    renderTop10(res.top10 || []);

    const grid = document.getElementById("featuredPageGrid");
    const empty = document.getElementById("featuredEmpty");
    const featured = res.featured || [];
    if (featured.length > 0) {
      grid.innerHTML = featured.map(renderProductCard).join("");
      empty?.classList.add("hidden");
    } else {
      grid.innerHTML = "";
      empty?.classList.remove("hidden");
    }
  } catch {
    document.getElementById("top10List").innerHTML =
      '<div class="empty-state small"><i class="fas fa-exclamation-circle"></i><p>Could not load featured listings.</p></div>';
  }
}

const rankEmojis = ["🥇", "🥈", "🥉"];

function renderTop10(items) {
  const el = document.getElementById("top10List");
  if (!items.length) {
    el.innerHTML = `<div class="empty-state small"><i class="fas fa-trophy"></i><h3>No ranked listings yet</h3><p>Be the first to boost your listing!</p></div>`;
    return;
  }
  el.innerHTML = items
    .map((p, i) => {
      const rank = i + 1;
      const rankClass = rank <= 3 ? `rank-${rank}` : "";
      const rankDisplay =
        rank <= 3
          ? `<div class="rank-num">${rankEmojis[i]}</div>`
          : `<div class="rank-num other">#${rank}</div>`;
      const img =
        p.images && p.images.length
          ? `<img class="top10-img" src="${p.images[0].url}" alt="${escHtml(p.title)}"
               onerror="this.outerHTML='<div class=\\'top10-img-ph\\'><i class=\\'fas fa-image\\'></i></div>'">`
          : `<div class="top10-img-ph"><i class="fas fa-image"></i></div>`;

      return `
        <div class="top10-item ${rankClass}" onclick="openProduct('${p.id}')">
            ${rankDisplay}
            ${img}
            <div class="top10-info">
                <div class="top10-title">${escHtml(p.title)}</div>
                <div class="top10-price">KES ${Number(p.price).toLocaleString()}</div>
                <div class="top10-meta">
                    <span><i class="fas fa-map-marker-alt"></i> ${escHtml(p.location || "Chogoria")}</span>
                    <span><i class="fas fa-tag"></i> ${escHtml(p.category_name || "")}</span>
                    <span><i class="fas fa-eye"></i> ${p.view_count || 0} views</span>
                </div>
            </div>
            <div class="top10-boost">
                <span class="boost-amount-label">Boost</span>
                <span class="boost-amount-val">KES ${p.featured_amount > 0 ? Number(p.featured_amount).toLocaleString() : "—"}</span>
            </div>
            <div class="top10-rank-badge">${rank <= 3 ? rankEmojis[i] : ""}</div>
        </div>`;
    })
    .join("");
}

function handleBoostCta() {
  if (!currentUser) {
    toast("Login to boost your listing.", "warning");
    showPage("login");
    return;
  }
  showPage("my-ads");
  toast("Select a listing to boost below!", "success");
}

// ─── LISTINGS PAGE ─────────────────────────────────────────────
async function loadListings() {
  await loadCategories();
  await applyFilters();
}

async function applyFilters() {
  const params = new URLSearchParams();
  const cat = document.getElementById("filterCategory")?.value;
  const cond = document.getElementById("filterCondition")?.value;
  const minP = document.getElementById("filterMinPrice")?.value;
  const maxP = document.getElementById("filterMaxPrice")?.value;
  const loc = document.getElementById("filterLocation")?.value;
  const sort = document.getElementById("sortSelect")?.value;

  if (cat) params.set("category", cat);
  if (cond) params.set("condition", cond);
  if (minP) params.set("min_price", minP);
  if (maxP) params.set("max_price", maxP);
  if (loc) params.set("location", loc);
  if (sort) params.set("sort", sort);
  if (listingsFilters.search) params.set("search", listingsFilters.search);
  if (listingsFilters.category && !cat)
    params.set("category", listingsFilters.category);
  params.set("page", listingsFilters.page || 1);
  params.set("limit", 20);

  const radius = document.getElementById("filterRadius")?.value;
  document.getElementById("listingsGrid").innerHTML = Array(6)
    .fill('<div class="loading-skeleton"></div>')
    .join("");
  try {
    let res;
    if (radius && userLocation) {
      const np = new URLSearchParams({
        lat: userLocation.lat,
        lng: userLocation.lng,
        radius,
        limit: 50,
      });
      res = await api("GET", `/locations/nearby-products?${np}`);
      if (res.success)
        res.pagination = { total: res.products.length, pages: 1, page: 1 };
    } else {
      if (radius && !userLocation) {
        toast(
          'Click "Use My Location" first to filter by distance.',
          "warning",
        );
        document.getElementById("filterRadius").value = "";
      }
      res = await api("GET", `/products?${params}`);
    }
    if (res.success) {
      const grid = document.getElementById("listingsGrid");
      grid.innerHTML = res.products.length
        ? res.products.map(renderProductCard).join("")
        : '<div class="empty-state"><i class="fas fa-search"></i><h3>No listings found</h3><p>Try different filters.</p></div>';
      document.getElementById("listingsCount").textContent =
        `${res.pagination.total} listings`;
      renderPagination(res.pagination);
      const catName = categoriesCache.find(
        (c) => c.slug === (cat || listingsFilters.category),
      );
      document.getElementById("listingsTitle").textContent =
        listingsFilters.search
          ? `Results for "${listingsFilters.search}"`
          : catName
            ? catName.name
            : "All Listings";
    }
  } catch {
    document.getElementById("listingsGrid").innerHTML =
      '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>Error loading listings</h3></div>';
  }
}

function clearFilters() {
  [
    "filterCategory",
    "filterCondition",
    "filterMinPrice",
    "filterMaxPrice",
    "filterLocation",
    "filterRadius",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  listingsFilters = { page: 1 };
  applyFilters();
}

function renderPagination(pagination) {
  const el = document.getElementById("listingsPagination");
  if (!el || pagination.pages <= 1) {
    if (el) el.innerHTML = "";
    return;
  }
  let html = "";
  if (pagination.page > 1)
    html += `<button onclick="goListingsPage(${pagination.page - 1})"><i class="fas fa-chevron-left"></i></button>`;
  for (
    let i = Math.max(1, pagination.page - 2);
    i <= Math.min(pagination.pages, pagination.page + 2);
    i++
  ) {
    html += `<button class="${i === pagination.page ? "active" : ""}" onclick="goListingsPage(${i})">${i}</button>`;
  }
  if (pagination.page < pagination.pages)
    html += `<button onclick="goListingsPage(${pagination.page + 1})"><i class="fas fa-chevron-right"></i></button>`;
  el.innerHTML = html;
}
function goListingsPage(p) {
  listingsFilters.page = p;
  applyFilters();
  window.scrollTo(0, 200);
}

// ─── PRODUCT DETAIL ────────────────────────────────────────────
async function openProduct(id) {
  currentProductId = id;
  showPage("product");
}

async function loadProductDetail() {
  try {
    const res = await api("GET", `/products/${currentProductId}`);
    if (!res.success) {
      toast("Listing not found.", "error");
      showPage("listings");
      return;
    }
    const p = res.product;

    document.getElementById("productBreadcrumb").innerHTML =
      `<a href="#" onclick="showPage('home');return false;">Home</a><span>›</span>
             <a href="#" onclick="filterByCategory('${p.category_slug}');return false;">${escHtml(p.category_name || "Listings")}</a>
             <span>›</span>${escHtml(p.title)}`;

    const gallery = document.getElementById("productGallery");
    if (p.images && p.images.length > 0) {
      gallery.innerHTML = `
                <img class="gallery-main" id="galleryMain" src="${p.images[0].url}" alt="${escHtml(p.title)}">
                ${
                  p.images.length > 1
                    ? `<div class="gallery-thumbs">${p.images
                        .map(
                          (img, i) =>
                            `<img class="gallery-thumb ${i === 0 ? "active" : ""}" src="${img.url}" onclick="changeGalleryImg(this, '${img.url}')">`,
                        )
                        .join("")}</div>`
                    : ""
                }`;
    } else {
      gallery.innerHTML =
        '<div class="gallery-main-placeholder"><i class="fas fa-image"></i></div>';
    }

    document.getElementById("productTitle").textContent = p.title;
    document.getElementById("productPrice").textContent =
      `KES ${Number(p.price).toLocaleString()}`;
    if (p.negotiable)
      document.getElementById("negotiableBadge").classList.remove("hidden");

    document.getElementById("productMeta").innerHTML = `
            <span><i class="fas fa-tag"></i>${escHtml(p.category_name || "")}</span>
            <span><i class="fas fa-map-marker-alt"></i>${escHtml(p.location || "")}</span>
            <span><i class="fas fa-box"></i>${p.condition}</span>
            <span><i class="fas fa-eye"></i>${p.views_count || 0} views</span>
            <span><i class="fas fa-clock"></i>${timeAgo(p.created_at)}</span>`;

    document.getElementById("productDescription").textContent = p.description;

    // Map
    const mapSection = document.getElementById("productMapSection");
    if (p.lat && p.lng && mapSection) {
      mapSection.classList.remove("hidden");
      setTimeout(
        () =>
          initProductMap(
            parseFloat(p.lat),
            parseFloat(p.lng),
            p.title,
            p.location,
          ),
        150,
      );
    } else if (mapSection) {
      mapSection.classList.add("hidden");
    }

    const favBtn = document.getElementById("favBtn");
    if (p.isFavorited) {
      favBtn.classList.add("active");
      favBtn.innerHTML = '<i class="fas fa-heart"></i>';
    } else {
      favBtn.innerHTML = '<i class="far fa-heart"></i>';
    }

    document.getElementById("sellerInfo").innerHTML = `
            <div class="seller-name">${escHtml(p.seller_name)}</div>
            <div class="seller-detail"><i class="fas fa-map-marker-alt"></i>${escHtml(p.seller_location || "Chogoria")}</div>
            <div class="seller-detail"><i class="fas fa-calendar-alt"></i>Member since ${new Date(p.seller_joined).toLocaleDateString("en-KE", { month: "long", year: "numeric" })}</div>`;

    const isOwn = currentUser && currentUser.id === p.user_id;

    // Show boost button for own active listings
    const boostDiv = document.getElementById("boostOwnProduct");
    if (boostDiv) {
      if (isOwn && p.status === "active") {
        boostDiv.classList.remove("hidden");
      } else {
        boostDiv.classList.add("hidden");
      }
    }

    // Determine best WhatsApp number: product-level > seller profile > phone
    const waNumber = (
      p.whatsapp_number ||
      p.seller_whatsapp ||
      p.seller_phone ||
      ""
    )
      .replace(/^0/, "254")
      .replace(/^\+/, "");
    const waMsg = encodeURIComponent(
      `Hi ${p.seller_name}, I saw your listing "${p.title}" on Jiji ya Chogoria. Is it still available?`,
    );

    document.getElementById("sellerActions").innerHTML = isOwn
      ? `<button class="btn-primary" onclick="showPage('my-ads')"><i class="fas fa-edit"></i> Manage Listing</button>`
      : `<button class="btn-primary" onclick="showContactModal('${p.seller_phone}', '${escHtml(p.seller_name)}', '${escHtml(p.title)}')">
                <i class="fas fa-phone"></i> Call Seller</button>
               ${
                 currentUser
                   ? `<button class="btn-outline" onclick="startDMWithSeller('${p.user_id}','${p.id}','${escHtml(p.title)}','${escHtml(p.seller_name)}')" style="display:flex;align-items:center;gap:6px;justify-content:center;">
                <i class="fas fa-envelope"></i> Message</button>`
                   : ""
               }
               <a href="https://wa.me/${waNumber}?text=${waMsg}"
                  target="_blank" class="btn-whatsapp" style="display:flex;align-items:center;gap:6px;justify-content:center;text-decoration:none;">
                <i class="fab fa-whatsapp"></i> WhatsApp</a>`;

    document.getElementById("relatedGrid").innerHTML = res.related.length
      ? res.related.map(renderProductCard).join("")
      : '<div class="empty-state small"><i class="fas fa-layer-group"></i><p>No related listings.</p></div>';
  } catch (err) {
    console.error(err);
    toast("Could not load listing.", "error");
  }
}

function changeGalleryImg(thumb, url) {
  document.getElementById("galleryMain").src = url;
  document
    .querySelectorAll(".gallery-thumb")
    .forEach((t) => t.classList.remove("active"));
  thumb.classList.add("active");
}

async function toggleFav() {
  if (!currentUser) {
    toast("Please login to save listings.", "warning");
    showPage("login");
    return;
  }
  try {
    const res = await api("POST", `/products/${currentProductId}/favorite`);
    if (res.success) {
      const btn = document.getElementById("favBtn");
      btn.classList.toggle("active", res.favorited);
      btn.innerHTML = res.favorited
        ? '<i class="fas fa-heart"></i>'
        : '<i class="far fa-heart"></i>';
      toast(res.message, "success");
    }
  } catch {
    toast("Error saving listing.", "error");
  }
}

function showContactModal(phone, name, title) {
  if (!currentUser) {
    toast("Please login to contact sellers.", "warning");
    showPage("login");
    return;
  }
  document.getElementById("contactModalBody").innerHTML = `
        <div style="text-align:center; padding:10px 0;">
            <div class="seller-name" style="font-size:1.1rem; margin-bottom:8px;">${escHtml(name)}</div>
            <p style="color:var(--subtext); margin-bottom:16px; font-size:0.88rem;">Regarding: "${escHtml(title)}"</p>
            <a href="tel:${phone}" class="btn-primary full-width" style="justify-content:center; font-size:1rem; padding:14px 24px;">
                <i class="fas fa-phone"></i> ${phone}
            </a>
            <p style="margin-top:12px; font-size:0.8rem; color:var(--subtext2);">Tap to call</p>
        </div>`;
  openModal("contactModal");
}

// ─── BOOST SYSTEM ──────────────────────────────────────────────
function showBoostModal(productId) {
  if (!currentUser) {
    toast("Login to boost your listing.", "warning");
    showPage("login");
    return;
  }
  boostProductId = productId;

  // Pre-fill phone
  const phoneEl = document.getElementById("boostPhone");
  if (phoneEl && currentUser.phone) phoneEl.value = currentUser.phone;

  openModal("boostModal");
}

function selectBoostTier(amount, el) {
  document
    .querySelectorAll(".boost-tier")
    .forEach((t) => t.classList.remove("active"));
  el.classList.add("active");
  document.getElementById("boostAmount").value = amount;
}

async function confirmBoost() {
  if (!currentUser) {
    showPage("login");
    return;
  }
  const phone = document.getElementById("boostPhone").value.trim();
  const amount = parseInt(document.getElementById("boostAmount").value);

  if (!phone) {
    toast("Enter your M-Pesa phone number.", "error");
    return;
  }
  if (!amount || amount < 300) {
    toast("Minimum boost amount is KES 300.", "error");
    return;
  }
  if (!boostProductId) {
    toast("No listing selected.", "error");
    return;
  }

  const btn = document.querySelector("#boostModal .btn-primary:last-child");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending prompt...';
  }

  try {
    const res = await api("POST", "/payments/boost", {
      phone,
      amount,
      product_id: boostProductId,
    });
    if (res.success) {
      closeModal();
      document.getElementById("paymentModalTitle").textContent =
        "Boosting Your Listing";
      document.getElementById("paymentStatusMsg").textContent =
        "Check your phone and enter your M-Pesa PIN...";
      openModal("paymentCheckModal");
      startBoostPolling(res.paymentId);
    } else {
      toast(res.message, "error");
    }
  } catch (err) {
    toast(err.message || "Boost payment failed.", "error");
  }

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-bolt"></i> Boost Now';
  }
}

function startBoostPolling(paymentId) {
  let attempts = 0;
  const maxAttempts = 24;
  clearInterval(paymentPollInterval);
  paymentPollInterval = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(paymentPollInterval);
      document.getElementById("paymentStatusMsg").textContent =
        "Payment timed out. Check your history.";
      return;
    }
    try {
      const res = await api("GET", `/payments/status/${paymentId}`);
      const resultEl = document.getElementById("paymentResult");
      if (res.payment.status === "completed") {
        clearInterval(paymentPollInterval);
        document.getElementById("paymentStatusMsg").textContent =
          "Listing boosted!";
        resultEl.innerHTML = `<div style="color:var(--success);font-size:1.1rem;margin-top:16px;font-weight:700;">
                    <i class="fas fa-fire fa-2x" style="display:block;margin-bottom:8px;color:var(--accent1)"></i>
                    Your listing is now featured!<br><small style="font-size:0.85rem;">Receipt: ${res.payment.receipt || ""}</small>
                </div>`;
        resultEl.classList.remove("hidden");
        toast("Your listing is now featured on the Featured page!", "success");
        setTimeout(() => {
          closeModal();
          showPage("featured");
        }, 3000);
      } else if (res.payment.status === "failed") {
        clearInterval(paymentPollInterval);
        document.getElementById("paymentStatusMsg").textContent =
          "Payment failed. Please try again.";
        resultEl.innerHTML = `<div style="color:var(--error);margin-top:16px;"><i class="fas fa-times-circle fa-2x" style="display:block;margin-bottom:8px;"></i>${res.payment.failure_reason || "Payment was not completed."}</div>`;
        resultEl.classList.remove("hidden");
      }
    } catch {}
  }, 4000);
}

// ─── POST AD ───────────────────────────────────────────────────
async function loadPostAd() {
  if (!currentUser) {
    showPage("login");
    return;
  }
  await loadCategories();
  await loadLocationPicker();
  uploadedImages = [];
  document.getElementById("imagePreviews").innerHTML = "";
  setTimeout(() => restoreAdDraft(), 100);

  const subAlert = document.getElementById("postAdSubAlert");
  const form = document.getElementById("postAdForm");

  // Check subscription + free posts status from server
  try {
    const [sub, settings, myProducts] = await Promise.all([
      api("GET", "/payments/subscription"),
      fetch("/api/settings/public").then((r) => r.json()),
      api("GET", "/products/my"),
    ]);

    const paidEnabled = settings.settings?.paid_posting_enabled !== "false";
    const freeAllowed = parseInt(settings.settings?.free_posts_per_user || "2");
    const postCount = (myProducts.products || []).filter(
      (p) => p.status !== "deleted",
    ).length;
    const isActive =
      sub.subscription &&
      sub.subscription.status === "active" &&
      new Date(sub.subscription.expires_at) > new Date();
    const hasFreePost = freeAllowed > 0 && postCount < freeAllowed;

    if (!paidEnabled || isActive || hasFreePost) {
      subAlert.classList.add("hidden");
      form.style.opacity = "";
      form.style.pointerEvents = "";
      // Show free posts remaining hint
      if (hasFreePost && !isActive && paidEnabled) {
        const remaining = freeAllowed - postCount;
        toast(
          `Free post ${postCount + 1} of ${freeAllowed} — pay membership after your free posts run out.`,
          "default",
          4000,
        );
      }
    } else {
      subAlert.classList.remove("hidden");
      form.style.opacity = "0.4";
      form.style.pointerEvents = "none";
    }
  } catch {
    // On error, allow access (server will enforce)
    subAlert.classList.add("hidden");
    form.style.opacity = "";
    form.style.pointerEvents = "";
  }
}

async function handleImagePreview(input) {
  const files = Array.from(input.files);
  if (!files.length) return;
  const previews = document.getElementById("imagePreviews");
  uploadedImages = [];
  // Show loading spinners
  previews.innerHTML = files
    .map(
      () =>
        `<div class="preview-img-wrap">
            <div class="preview-img-loading"><i class="fas fa-spinner fa-spin"></i></div>
        </div>`,
    )
    .join("");
  try {
    const form = new FormData();
    files.forEach((f) => form.append("images", f));
    const res = await api("POST", "/uploads/images", form, true);
    if (res.success) {
      uploadedImages = res.images;
      renderUploadedPreviews();
      toast(
        `${res.images.length} image${res.images.length > 1 ? "s" : ""} uploaded!`,
        "success",
        2000,
      );
    } else {
      previews.innerHTML = "";
      toast(res.message || "Upload failed.", "error");
    }
  } catch {
    previews.innerHTML = "";
    toast("Image upload failed. Please try again.", "error");
  }
}

function renderUploadedPreviews() {
  const previews = document.getElementById("imagePreviews");
  previews.innerHTML = uploadedImages
    .map(
      (img, i) =>
        `<div class="preview-img-wrap${i === 0 ? " is-primary" : ""}">
            <img class="preview-img" src="${img.url}" alt="Image ${i + 1}">
            <button type="button" class="remove-img" onclick="removeUploadedImg(${i})" title="Remove"><i class="fas fa-times"></i></button>
        </div>`,
    )
    .join("");
  const countEl = document.getElementById("imageCount");
  if (countEl) {
    countEl.textContent = uploadedImages.length
      ? `${uploadedImages.length} photo${uploadedImages.length > 1 ? "s" : ""} selected — first photo will be the cover image`
      : "";
  }
}

function removeUploadedImg(idx) {
  uploadedImages.splice(idx, 1);
  if (!uploadedImages.length) {
    document.getElementById("imagePreviews").innerHTML = "";
    document.getElementById("adImages").value = "";
  } else {
    renderUploadedPreviews();
  }
}

async function handlePostAd(e) {
  if (e) e.preventDefault();
  if (!currentUser) {
    showPage("login");
    return;
  }
  const btn = document.getElementById("postAdBtn");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
  try {
    const form = new FormData();
    form.append("title", document.getElementById("adTitle").value);
    form.append("description", document.getElementById("adDescription").value);
    form.append("price", document.getElementById("adPrice").value);
    form.append("category_id", document.getElementById("adCategory").value);
    form.append("condition", document.getElementById("adCondition").value);
    form.append("location", document.getElementById("adLocation").value);
    form.append("negotiable", document.getElementById("adNegotiable").checked);
    const whatsapp = document.getElementById("adWhatsapp")?.value?.trim();
    if (whatsapp) form.append("whatsapp", whatsapp);
    const adLat = document.getElementById("adLat")?.value;
    const adLng = document.getElementById("adLng")?.value;
    if (adLat) form.append("lat", adLat);
    if (adLng) form.append("lng", adLng);
    if (uploadedImages.length > 0) {
      form.append("uploaded_images", JSON.stringify(uploadedImages));
    } else {
      const images = document.getElementById("adImages").files;
      for (const img of images) form.append("images", img);
    }

    const res = await api("POST", "/products", form, true);
    if (res.success) {
      toast("Listing submitted for review!", "success");
      document.getElementById("postAdForm").reset();
      document.getElementById("imagePreviews").innerHTML = "";
      uploadedImages = [];
      clearAdDraft();
      showPage("my-ads");
    } else {
      toast(res.message, "error");
      if (res.requiresSubscription) showPage("payments");
    }
  } catch (err) {
    toast(err.message || "Could not submit listing.", "error");
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Listing';
}

function handlePostAd_nav() {
  handlePostAdMobile();
}

// ─── DASHBOARD ─────────────────────────────────────────────────
async function loadDashboard() {
  if (!currentUser) {
    showPage("login");
    return;
  }
  document.getElementById("dashGreeting").textContent =
    `Welcome back, ${currentUser.full_name}! ${getGreetingEmoji()}`;

  try {
    const [me, favs, notifs] = await Promise.all([
      api("GET", "/auth/me"),
      api("GET", "/products/favorites"),
      api("GET", "/notifications"),
    ]);
    document.getElementById("dashActiveAds").textContent =
      me.user.active_listings || 0;
    document.getElementById("dashViews").textContent =
      me.user.total_listings || 0;
    document.getElementById("dashSaved").textContent =
      favs.favorites?.length || 0;

    const isActive =
      me.user.subscription_status === "active" &&
      me.user.subscription_expires &&
      new Date(me.user.subscription_expires) > new Date();
    const subIcon = document.getElementById("dashSubIcon");
    if (isActive) {
      const days = Math.ceil(
        (new Date(me.user.subscription_expires) - Date.now()) / 86400000,
      );
      document.getElementById("dashSubStatus").textContent = `${days}d`;
      document.getElementById("dashSubLabel").textContent = "Days Left";
      subIcon.className = "stat-icon green";
      subIcon.innerHTML = '<i class="fas fa-crown"></i>';
      document.getElementById("subBanner").classList.add("hidden");
    } else {
      document.getElementById("dashSubStatus").textContent = "None";
      document.getElementById("dashSubLabel").textContent = "Membership";
      subIcon.className = "stat-icon";
      subIcon.innerHTML = '<i class="fas fa-lock"></i>';
      document.getElementById("subBanner").classList.remove("hidden");
    }
    currentUser = me.user;

    const notifEl = document.getElementById("dashNotifications");
    if (notifs.notifications && notifs.notifications.length > 0) {
      notifEl.innerHTML = notifs.notifications
        .slice(0, 5)
        .map(
          (n) =>
            `<div class="notif-dash-item ${n.is_read ? "" : "unread"}">
                    <div class="ntitle">${escHtml(n.title)}</div>
                    <div class="nmsg">${escHtml(n.message)}</div>
                    <div class="notif-time">${timeAgo(n.created_at)}</div>
                </div>`,
        )
        .join("");
    } else {
      notifEl.innerHTML =
        '<div class="empty-state small"><i class="fas fa-bell-slash"></i><p>No notifications yet</p></div>';
    }
  } catch {}
  loadDashRecentAds();
}

async function loadDashRecentAds() {
  try {
    const res = await api("GET", "/products/my");
    const el = document.getElementById("dashRecentAds");
    const ads = res.products ? res.products.slice(0, 4) : [];
    if (ads.length === 0) {
      el.innerHTML =
        '<div class="empty-state small"><i class="fas fa-tag"></i><p>No listings yet. <a href="#" onclick="showPage(\'post-ad\')">Post your first ad!</a></p></div>';
    } else {
      el.innerHTML = `<div class="my-ads-list" style="padding:0 0 4px;">${ads
        .map(
          (p) => `
                <div class="ad-row" style="border-radius:0;padding:12px 20px;" onclick="openProduct('${p.id}')">
                    ${
                      p.images && p.images.length
                        ? `<img class="ad-row-img" src="${p.images[0].url}">`
                        : `<div class="ad-row-img-placeholder"><i class="fas fa-image"></i></div>`
                    }
                    <div class="ad-row-info">
                        <div class="ad-row-title">${escHtml(p.title)}</div>
                        <div class="ad-row-price">KES ${Number(p.price).toLocaleString()}</div>
                        <div class="ad-row-meta"><span class="status-badge ${p.status}">${p.status}</span><span>${timeAgo(p.created_at)}</span></div>
                    </div>
                </div>`,
        )
        .join("")}</div>`;
    }
  } catch {}
}

function getGreetingEmoji() {
  const h = new Date().getHours();
  if (h < 12) return "☀️";
  if (h < 17) return "🌤️";
  return "🌙";
}

// ─── MY ADS ───────────────────────────────────────────────────
let myAdsFilter = "";
async function loadMyAds(status = "") {
  if (!currentUser) {
    showPage("login");
    return;
  }
  try {
    const url = status ? `/products/my?status=${status}` : "/products/my";
    const res = await api("GET", url);
    const grid = document.getElementById("myAdsGrid");
    if (!res.products || res.products.length === 0) {
      grid.innerHTML =
        '<div class="empty-state"><i class="fas fa-tags"></i><h3>No listings found</h3><p><a href="#" onclick="showPage(\'post-ad\')">Post your first listing!</a></p></div>';
      return;
    }
    grid.innerHTML = res.products
      .map(
        (p) => `
            <div class="ad-row">
                ${
                  p.images && p.images.length
                    ? `<img class="ad-row-img" src="${p.images[0].url}" onclick="openProduct('${p.id}')">`
                    : `<div class="ad-row-img-placeholder" onclick="openProduct('${p.id}')"><i class="fas fa-image"></i></div>`
                }
                <div class="ad-row-info">
                    <div class="ad-row-title">${escHtml(p.title)}</div>
                    <div class="ad-row-price">KES ${Number(p.price).toLocaleString()}</div>
                    <div class="ad-row-meta">
                        <span class="status-badge ${p.status}">${p.status}</span>
                        <span><i class="fas fa-eye"></i> ${p.views_count || 0}</span>
                        <span>${timeAgo(p.created_at)}</span>
                        ${p.rejection_reason ? `<span style="color:var(--error);font-size:0.78rem;"><i class="fas fa-info-circle"></i> ${escHtml(p.rejection_reason)}</span>` : ""}
                    </div>
                </div>
                <div class="ad-row-actions">
                    <button class="btn-outline" onclick="openProduct('${p.id}')"><i class="fas fa-eye"></i></button>
                    ${p.status === "active" ? `<button class="btn-primary" style="background:var(--gradient)" onclick="showBoostModal('${p.id}')"><i class="fas fa-bolt"></i> Boost</button>` : ""}
                    <button class="btn-primary btn-danger" onclick="confirmDeleteAd('${p.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>`,
      )
      .join("");
  } catch {
    toast("Could not load your listings.", "error");
  }
}

function filterMyAds(status, btn) {
  myAdsFilter = status;
  document
    .querySelectorAll(".filter-tabs .tab")
    .forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  loadMyAds(status);
}

async function confirmDeleteAd(id) {
  if (!confirm("Delete this listing? This cannot be undone.")) return;
  try {
    const res = await api("DELETE", `/products/${id}`);
    if (res.success) {
      toast("Listing deleted.", "success");
      loadMyAds(myAdsFilter);
    } else toast(res.message, "error");
  } catch {
    toast("Could not delete listing.", "error");
  }
}

// ─── FAVORITES ─────────────────────────────────────────────────
async function loadFavorites() {
  if (!currentUser) {
    showPage("login");
    return;
  }
  try {
    const res = await api("GET", "/products/favorites");
    const grid = document.getElementById("favoritesGrid");
    grid.innerHTML =
      res.favorites && res.favorites.length
        ? res.favorites.map(renderProductCard).join("")
        : '<div class="empty-state"><i class="fas fa-heart"></i><h3>No saved listings</h3><p>Heart a listing to save it here.</p></div>';
  } catch {}
}

// ─── PAYMENTS ─────────────────────────────────────────────────
async function loadPayments() {
  if (!currentUser) {
    showPage("login");
    return;
  }
  try {
    const [sub, hist] = await Promise.all([
      api("GET", "/payments/subscription"),
      api("GET", "/payments/history"),
    ]);
    renderSubStatus(sub.subscription);
    renderPaymentHistory(hist.payments);
    const phoneEl = document.getElementById("mpesaPhone");
    if (phoneEl && currentUser.phone) phoneEl.value = currentUser.phone;
  } catch {}
}

function renderSubStatus(sub) {
  const el = document.getElementById("membershipStatus");
  const payForm = document.getElementById("payForm");
  if (!sub || sub.status === "none") {
    el.className = "membership-status inactive";
    el.innerHTML = '<i class="fas fa-times-circle"></i> No active membership';
    if (payForm) payForm.style.display = "";
  } else if (sub.status === "active") {
    const days = sub.days_remaining || 0;
    el.className = "membership-status active";
    el.innerHTML = `<i class="fas fa-check-circle"></i> Active — ${days} day${days !== 1 ? "s" : ""} remaining<br><small>Expires: ${new Date(sub.expires_at).toLocaleDateString("en-KE")}</small>`;
    if (payForm) payForm.style.display = "";
  } else {
    el.className = "membership-status expired";
    el.innerHTML =
      '<i class="fas fa-exclamation-circle"></i> Membership expired';
    if (payForm) payForm.style.display = "";
  }
}

function renderPaymentHistory(payments) {
  const el = document.getElementById("paymentHistoryList");
  if (!payments || payments.length === 0) {
    el.innerHTML =
      '<div class="empty-state small"><i class="fas fa-history"></i><p>No payment history</p></div>';
    return;
  }
  el.innerHTML = payments
    .map(
      (p) => `
        <div class="pay-hist-row">
            <div>
                <div class="pay-hist-amount">KES ${Number(p.amount).toLocaleString()}</div>
                <div style="font-size:0.72rem;color:var(--subtext2)">${p.payment_type === "boost" ? "⚡ Boost" : "👑 Membership"}${p.product_title ? ` — ${escHtml(p.product_title)}` : ""}</div>
                <div class="pay-hist-receipt">${p.megapay_receipt || p.status}</div>
            </div>
            <div style="text-align:right">
                <span class="status-badge ${p.status}">${p.status}</span>
                <div class="pay-hist-date">${new Date(p.created_at).toLocaleDateString("en-KE")}</div>
            </div>
        </div>`,
    )
    .join("");
}

async function initiatePayment() {
  if (!currentUser) {
    showPage("login");
    return;
  }
  const phone = document.getElementById("mpesaPhone").value.trim();
  if (!phone) {
    toast("Enter your M-Pesa phone number.", "error");
    return;
  }

  const btn = document.getElementById("payBtn");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending prompt...';

  try {
    const res = await api("POST", "/payments/initiate", { phone });
    if (res.success) {
      document.getElementById("paymentModalTitle").textContent =
        "MegaPay — M-Pesa";
      document.getElementById("paymentStatusMsg").textContent =
        "Check your phone and enter your M-Pesa PIN...";
      document.getElementById("paymentResult").classList.add("hidden");
      openModal("paymentCheckModal");
      startPaymentPolling(res.paymentId);
    } else {
      toast(res.message, "error");
    }
  } catch (err) {
    toast(err.message || "Payment failed.", "error");
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-mobile-alt"></i> Pay via M-Pesa';
}

function startPaymentPolling(paymentId) {
  let attempts = 0;
  const maxAttempts = 24;
  clearInterval(paymentPollInterval);
  paymentPollInterval = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(paymentPollInterval);
      document.getElementById("paymentStatusMsg").textContent =
        "Payment timed out. Check your history.";
      return;
    }
    try {
      const res = await api("GET", `/payments/status/${paymentId}`);
      const resultEl = document.getElementById("paymentResult");
      if (res.payment.status === "completed") {
        clearInterval(paymentPollInterval);
        document.getElementById("paymentStatusMsg").textContent =
          "Payment successful!";
        resultEl.innerHTML = `<div style="color:var(--success);font-size:1.1rem;margin-top:16px;font-weight:700;">
                    <i class="fas fa-check-circle fa-2x" style="display:block;margin-bottom:8px;"></i>
                    Membership activated!<br><small style="font-size:0.85rem;">Receipt: ${res.payment.receipt || ""}</small>
                </div>`;
        resultEl.classList.remove("hidden");
        toast("Membership activated! You can now post listings.", "success");
        setTimeout(() => {
          closeModal();
          loadPayments();
        }, 3000);
      } else if (res.payment.status === "failed") {
        clearInterval(paymentPollInterval);
        document.getElementById("paymentStatusMsg").textContent =
          "Payment failed. Please try again.";
        resultEl.innerHTML = `<div style="color:var(--error);margin-top:16px;"><i class="fas fa-times-circle fa-2x" style="display:block;margin-bottom:8px;"></i>${res.payment.failure_reason || "Payment was not completed."}</div>`;
        resultEl.classList.remove("hidden");
      }
    } catch {}
  }, 4000);
}

// ─── NOTIFICATIONS ─────────────────────────────────────────────
async function loadNotifications() {
  if (!currentUser) {
    showPage("login");
    return;
  }
  try {
    const res = await api("GET", "/notifications");
    const list = document.getElementById("notificationsList");
    if (!res.notifications || res.notifications.length === 0) {
      list.innerHTML =
        '<div class="empty-state"><i class="fas fa-bell-slash"></i><h3>No notifications</h3></div>';
      return;
    }
    const typeIcons = {
      subscription_activated: { cls: "success", icon: "fas fa-crown" },
      boost_activated: { cls: "success", icon: "fas fa-rocket" },
      payment_initiated: { cls: "", icon: "fas fa-mobile-alt" },
      payment_failed: { cls: "error", icon: "fas fa-times-circle" },
      product_approved: { cls: "success", icon: "fas fa-check-circle" },
      product_rejected: { cls: "error", icon: "fas fa-ban" },
      new_product_pending: { cls: "warning", icon: "fas fa-clock" },
    };
    list.innerHTML = res.notifications
      .map((n) => {
        const ic = typeIcons[n.type] || { cls: "", icon: "fas fa-bell" };
        return `<div class="notif-item ${n.is_read ? "" : "unread"}" onclick="markNotifRead('${n.id}', this)">
                <div class="notif-icon ${ic.cls}"><i class="${ic.icon}"></i></div>
                <div class="notif-body">
                    <div class="notif-title">${escHtml(n.title)}</div>
                    <div class="notif-msg">${escHtml(n.message)}</div>
                    <div class="notif-time">${timeAgo(n.created_at)}</div>
                </div>
            </div>`;
      })
      .join("");
    updateNotifBadge(res.unread_count);
  } catch {}
}

async function markNotifRead(id, el) {
  el.classList.remove("unread");
  try {
    await api("PUT", `/notifications/${id}/read`);
    loadNotifCount();
  } catch {}
}
async function markAllRead() {
  try {
    await api("PUT", "/notifications/all/read");
    toast("All marked as read.", "success");
    loadNotifications();
  } catch {}
}
async function loadNotifCount() {
  try {
    const res = await api("GET", "/notifications");
    updateNotifBadge(res.unread_count || 0);
  } catch {}
}
function updateNotifBadge(count) {
  const badge = document.getElementById("notifBadge");
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove("hidden");
  } else badge.classList.add("hidden");
}

// ─── PROFILE ──────────────────────────────────────────────────
async function loadProfile() {
  if (!currentUser) {
    showPage("login");
    return;
  }
  const [me] = await Promise.all([api("GET", "/auth/me"), getLocations()]);
  const u = me.user;
  document.getElementById("profileName").value = u.full_name || "";
  document.getElementById("profilePhone").value = u.phone || "";
  populateLocationSelect(
    document.getElementById("profileLocation"),
    u.location || "",
  );
  document.getElementById("profileBio").value = u.bio || "";
}

async function handleProfileUpdate(e) {
  e.preventDefault();
  try {
    const res = await api("PUT", "/auth/profile", {
      full_name: document.getElementById("profileName").value,
      phone: document.getElementById("profilePhone").value,
      location: document.getElementById("profileLocation").value,
      bio: document.getElementById("profileBio").value,
    });
    if (res.success) {
      toast("Profile updated!", "success");
      currentUser = { ...currentUser, ...res.user };
      document.getElementById("dropdownName").textContent =
        currentUser.full_name;
    } else toast(res.message, "error");
  } catch {
    toast("Update failed.", "error");
  }
}

async function handlePasswordChange(e) {
  e.preventDefault();
  const np = document.getElementById("newPw").value;
  const cp = document.getElementById("confirmPw").value;
  if (np !== cp) {
    toast("Passwords do not match.", "error");
    return;
  }
  try {
    const res = await api("PUT", "/auth/change-password", {
      current_password: document.getElementById("currentPw").value,
      new_password: np,
    });
    if (res.success) {
      toast("Password changed!", "success");
      document.getElementById("passwordForm").reset();
    } else toast(res.message, "error");
  } catch {
    toast("Password change failed.", "error");
  }
}

// ─── REPORT ───────────────────────────────────────────────────
function showReportModal() {
  if (!currentUser) {
    toast("Please login to report.", "warning");
    return;
  }
  openModal("reportModal");
}
async function submitReport() {
  try {
    const res = await api("POST", `/products/${currentProductId}/report`, {
      reason: document.getElementById("reportReason").value,
      description: document.getElementById("reportDesc").value,
    });
    if (res.success) {
      toast(res.message, "success");
      closeModal();
    } else toast(res.message, "error");
  } catch {
    toast("Could not submit report.", "error");
  }
}

// ─── ADMIN ────────────────────────────────────────────────────
function adminTab(name, btn) {
  document
    .querySelectorAll(".admin-section")
    .forEach((s) => s.classList.add("hidden"));
  document
    .querySelectorAll(".admin-tabs .tab")
    .forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  const sections = {
    dashboard: "adminDashboard",
    listings: "adminListings",
    users: "adminUsers",
    "payments-admin": "adminPayments",
    reports: "adminReports",
    newsletter: "adminNewsletter",
    settings: "adminSettings",
  };
  document.getElementById(sections[name])?.classList.remove("hidden");
  if (name === "dashboard") loadAdminDashboard();
  else if (name === "listings") loadAdminListings();
  else if (name === "users") loadAdminUsers();
  else if (name === "payments-admin") loadAdminPayments();
  else if (name === "reports") loadAdminReports();
  else if (name === "newsletter") loadAdminNewsletter();
  else if (name === "settings") loadAdminSettings();
}

async function loadAdminNewsletter() {
  const el = document.getElementById("adminNewsletterList");
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner-sm"></div>';
  try {
    const res = await api("GET", "/newsletter/subscribers");
    if (!res.success) {
      el.innerHTML =
        '<p style="color:var(--error)">Could not load subscribers.</p>';
      return;
    }
    el.innerHTML = `
            <div class="settings-card">
                <h3><i class="fas fa-newspaper"></i> Newsletter Subscribers</h3>
                <p class="settings-help">Total active subscribers: <strong>${res.total_active}</strong></p>
                ${
                  res.subscribers.length === 0
                    ? '<p style="color:var(--subtext);margin-top:12px;">No subscribers yet.</p>'
                    : `<div class="admin-table" style="margin-top:16px;"><table>
                        <thead><tr><th>Email</th><th>Name</th><th>Status</th><th>Joined</th></tr></thead>
                        <tbody>${res.subscribers
                          .map(
                            (s) => `<tr>
                            <td>${escHtml(s.email)}</td>
                            <td>${escHtml(s.name || "—")}</td>
                            <td><span style="font-size:0.75rem;padding:2px 8px;border-radius:50px;background:${s.is_active ? "rgba(76,175,80,0.15)" : "rgba(255,71,87,0.15)"};color:${s.is_active ? "#4caf50" : "var(--error)"}">${s.is_active ? "Active" : "Unsubscribed"}</span></td>
                            <td>${timeAgo(s.created_at)}</td>
                        </tr>`,
                          )
                          .join("")}</tbody>
                    </table></div>`
                }
            </div>`;
  } catch {
    el.innerHTML =
      '<p style="color:var(--error)">Error loading newsletter data.</p>';
  }
}

async function loadAdminSettings() {
  try {
    const res = await api("GET", "/admin/settings");
    if (!res.success) return;
    const get = (k) => res.settings.find((s) => s.key === k)?.value || "";
    const fee = get("posting_fee");
    const paidEnabled = get("paid_posting_enabled");

    document.getElementById("settingPostingFee").value = fee;
    document.getElementById("settingSubDays").value = get("subscription_days");
    document.getElementById("settingMinBoost").value = get("min_boost_amount");
    if (document.getElementById("settingFreePostsPerUser"))
      document.getElementById("settingFreePostsPerUser").value =
        get("free_posts_per_user") || "2";
    if (fee)
      document.getElementById("currentFeeDisplay").textContent = `KES ${fee}`;

    // Set the paid posting toggle
    const isEnabled = paidEnabled !== "false";
    const toggle = document.getElementById("paidPostingToggle");
    const label = document.getElementById("paidPostingLabel");
    if (toggle) {
      toggle.checked = isEnabled;
      if (label) {
        label.textContent = isEnabled ? "Enabled" : "Disabled";
        label.className = `toggle-label ${isEnabled ? "on" : "off"}`;
      }
    }
  } catch (e) {
    toast("Could not load settings.", "error");
  }
}

async function togglePaidPosting(checkbox) {
  const value = checkbox.checked ? "true" : "false";
  const label = document.getElementById("paidPostingLabel");
  try {
    const res = await api("PUT", "/admin/settings/paid_posting_enabled", {
      value,
    });
    if (res.success) {
      toast(res.message, "success");
      if (label) {
        label.textContent = checkbox.checked ? "Enabled" : "Disabled";
        label.className = `toggle-label ${checkbox.checked ? "on" : "off"}`;
      }
    } else {
      checkbox.checked = !checkbox.checked;
      toast(res.message || "Failed to update.", "error");
    }
  } catch (e) {
    checkbox.checked = !checkbox.checked;
    toast("Failed to update setting.", "error");
  }
}

async function saveSetting(key, inputId) {
  const value = document.getElementById(inputId).value.trim();
  if (!value || Number(value) < 0) {
    toast("Enter a valid number.", "error");
    return;
  }
  try {
    const res = await api("PUT", `/admin/settings/${key}`, { value });
    if (res.success) {
      toast(res.message, "success");
      if (key === "posting_fee") {
        document.getElementById("currentFeeDisplay").textContent =
          `KES ${value}`;
        if (window.publicSettings)
          window.publicSettings.posting_fee = Number(value);
        updatePostingFeeDisplays(Number(value));
      }
    } else {
      toast(res.message || "Failed to save.", "error");
    }
  } catch (e) {
    toast(e.message || "Failed to save.", "error");
  }
}

async function promoteUser() {
  const phone = document.getElementById("promotePhone").value.trim();
  const role = document.getElementById("promoteRole").value;
  const out = document.getElementById("promoteResult");
  out.innerHTML = "";
  if (!phone) {
    toast("Enter a phone number.", "error");
    return;
  }
  try {
    const res = await api("POST", "/admin/users/promote", { phone, role });
    if (res.success) {
      toast(res.message, "success");
      out.innerHTML = `<div class="success-banner"><i class="fas fa-check-circle"></i> ${res.message}</div>`;
      document.getElementById("promotePhone").value = "";
    }
  } catch (e) {
    out.innerHTML = `<div class="error-banner"><i class="fas fa-exclamation-circle"></i> ${e.message || "Failed."}</div>`;
  }
}

function updatePostingFeeDisplays(amount) {
  document.querySelectorAll("[data-posting-fee]").forEach((el) => {
    el.textContent = `KES ${amount}`;
  });
}

async function loadAdmin() {
  if (
    !currentUser ||
    (currentUser.role !== "admin" && currentUser.role !== "moderator")
  ) {
    toast("Admin access required.", "error");
    showPage("home");
    return;
  }
  loadAdminDashboard();
}

async function loadAdminDashboard() {
  try {
    const res = await api("GET", "/admin/dashboard");
    const s = res.stats;
    document.getElementById("adminStats").innerHTML = `
            <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-users"></i></div>
            <div class="stat-info"><span class="stat-num">${s.users.total}</span><span>Total Users</span></div></div>
            <div class="stat-card"><div class="stat-icon green"><i class="fas fa-tags"></i></div>
            <div class="stat-info"><span class="stat-num">${s.products.active}</span><span>Active Listings</span></div></div>
            <div class="stat-card"><div class="stat-icon orange"><i class="fas fa-clock"></i></div>
            <div class="stat-info"><span class="stat-num">${s.products.pending}</span><span>Pending Review</span></div></div>
            <div class="stat-card"><div class="stat-icon"><i class="fas fa-money-bill-wave"></i></div>
            <div class="stat-info"><span class="stat-num">KES ${Number(s.payments.total_revenue || 0).toLocaleString()}</span><span>Total Revenue</span></div></div>`;
  } catch {}
}

async function loadAdminListings() {
  try {
    const res = await api("GET", "/admin/products/pending");
    const el = document.getElementById("pendingListingsList");
    if (!res.products || res.products.length === 0) {
      el.innerHTML =
        '<div class="empty-state"><i class="fas fa-check-circle"></i><h3>No pending listings!</h3></div>';
      return;
    }
    el.innerHTML = `<div class="admin-table"><table>
            <thead><tr><th>Title</th><th>Seller</th><th>Price</th><th>Category</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>${res.products
              .map(
                (p) => `
                <tr>
                    <td><a href="#" onclick="openProduct('${p.id}');return false;">${escHtml(p.title)}</a></td>
                    <td>${escHtml(p.seller_name)}<br><small>${p.seller_phone}</small></td>
                    <td>KES ${Number(p.price).toLocaleString()}</td>
                    <td>${escHtml(p.category_name || "")}</td>
                    <td>${timeAgo(p.created_at)}</td>
                    <td><div class="admin-actions">
                        <button class="btn-success btn-primary" onclick="moderateProduct('${p.id}', 'approve')"><i class="fas fa-check"></i> Approve</button>
                        <button class="btn-danger btn-primary" onclick="moderateProduct('${p.id}', 'reject')"><i class="fas fa-times"></i> Reject</button>
                    </div></td>
                </tr>`,
              )
              .join("")}
            </tbody></table></div>`;
  } catch {}
}

async function moderateProduct(id, action) {
  pendingModerationId = id;
  pendingModerationAction = action;
  if (action === "approve") {
    document.getElementById("moderateTitle").textContent = "Approve Listing";
    document.getElementById("rejectReasonGroup").style.display = "none";
    document.getElementById("moderateConfirmBtn").className =
      "btn-primary btn-success";
    document.getElementById("moderateConfirmBtn").textContent = "Approve";
  } else {
    document.getElementById("moderateTitle").textContent = "Reject Listing";
    document.getElementById("rejectReasonGroup").style.display = "";
    document.getElementById("moderateConfirmBtn").className =
      "btn-primary btn-danger";
    document.getElementById("moderateConfirmBtn").textContent = "Reject";
  }
  openModal("moderateModal");
}

async function confirmModeration() {
  const reason = document.getElementById("rejectReason")?.value;
  if (pendingModerationAction === "reject" && !reason) {
    toast("Provide a rejection reason.", "error");
    return;
  }
  try {
    const res = await api(
      "PUT",
      `/admin/products/${pendingModerationId}/moderate`,
      {
        action: pendingModerationAction,
        reason,
      },
    );
    if (res.success) {
      toast(res.message, "success");
      closeModal();
      document.getElementById("rejectReason").value = "";
      loadAdminListings();
    } else toast(res.message, "error");
  } catch {
    toast("Action failed.", "error");
  }
}

async function loadAdminUsers() {
  const search = document.getElementById("userSearchInput")?.value || "";
  try {
    const res = await api(
      "GET",
      `/admin/users?search=${encodeURIComponent(search)}`,
    );
    const el = document.getElementById("adminUsersList");
    if (!res.users || res.users.length === 0) {
      el.innerHTML =
        '<div class="empty-state"><i class="fas fa-users"></i><h3>No users found</h3></div>';
      return;
    }
    el.innerHTML = `<div class="admin-table"><table>
            <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Membership</th><th>Listings</th><th>Joined</th><th>Actions</th></tr></thead>
            <tbody>${res.users
              .map((u) => {
                const isActive =
                  u.subscription_status === "active" &&
                  u.expires_at &&
                  new Date(u.expires_at) > new Date();
                return `<tr>
                    <td>${escHtml(u.full_name)} ${u.is_banned ? '<span class="status-badge rejected">Banned</span>' : ""}</td>
                    <td>${escHtml(u.email)}</td><td>${u.phone}</td>
                    <td><span class="status-badge ${isActive ? "active" : "expired"}">${isActive ? "Active" : "None"}</span></td>
                    <td>${u.active_listings || 0}</td>
                    <td>${new Date(u.created_at).toLocaleDateString("en-KE")}</td>
                    <td><div class="admin-actions">
                        ${
                          u.is_banned
                            ? `<button class="btn-success btn-primary" onclick="adminBanUser('${u.id}', false)"><i class="fas fa-unlock"></i> Unban</button>`
                            : `<button class="btn-danger btn-primary" onclick="adminBanUser('${u.id}', true)"><i class="fas fa-ban"></i> Ban</button>`
                        }
                    </div></td>
                </tr>`;
              })
              .join("")}
            </tbody></table></div>`;
  } catch {}
}

async function adminBanUser(id, ban) {
  const reason = ban ? prompt("Reason for ban:") : null;
  if (ban && !reason) return;
  try {
    const res = await api("PUT", `/admin/users/${id}/ban`, { ban, reason });
    if (res.success) {
      toast(res.message, "success");
      loadAdminUsers();
    } else toast(res.message, "error");
  } catch {}
}

async function loadAdminPayments() {
  try {
    const res = await api("GET", "/admin/payments");
    const el = document.getElementById("adminPaymentsList");
    if (!res.payments || res.payments.length === 0) {
      el.innerHTML =
        '<div class="empty-state"><i class="fas fa-money-bill"></i><h3>No payments yet</h3></div>';
      return;
    }
    el.innerHTML = `<div class="admin-table"><table>
            <thead><tr><th>User</th><th>Phone</th><th>Amount</th><th>Type</th><th>Receipt</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>${res.payments
              .map(
                (p) => `
                <tr>
                    <td>${escHtml(p.full_name)}</td>
                    <td>${p.phone_number}</td>
                    <td>KES ${Number(p.amount).toLocaleString()}</td>
                    <td><span style="font-size:0.8rem">${p.payment_type || "subscription"}</span></td>
                    <td><span style="color:var(--success);font-size:0.78rem">${p.megapay_receipt || "—"}</span></td>
                    <td><span class="status-badge ${p.status}">${p.status}</span></td>
                    <td>${new Date(p.created_at).toLocaleDateString("en-KE")}</td>
                </tr>`,
              )
              .join("")}
            </tbody></table></div>`;
  } catch {}
}

async function loadAdminReports() {
  try {
    const res = await api("GET", "/admin/reports");
    const el = document.getElementById("adminReportsList");
    if (!res.reports || res.reports.length === 0) {
      el.innerHTML =
        '<div class="empty-state"><i class="fas fa-flag"></i><h3>No reports</h3></div>';
      return;
    }
    el.innerHTML = `<div class="admin-table"><table>
            <thead><tr><th>Listing</th><th>Reason</th><th>Reporter</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>${res.reports
              .map(
                (r) => `
                <tr>
                    <td><a href="#" onclick="openProduct('${r.product_id}');return false;">${escHtml(r.product_title || "Listing")}</a></td>
                    <td>${r.reason}</td>
                    <td>${escHtml(r.reporter_name)}</td>
                    <td>${new Date(r.created_at).toLocaleDateString("en-KE")}</td>
                    <td><div class="admin-actions">
                        <button class="btn-danger btn-primary" onclick="dismissReport('${r.id}')">Dismiss</button>
                    </div></td>
                </tr>`,
              )
              .join("")}
            </tbody></table></div>`;
  } catch {}
}

async function dismissReport(id) {
  try {
    await api("DELETE", `/admin/reports/${id}`);
    toast("Report dismissed.", "success");
    loadAdminReports();
  } catch {}
}

// ─── MODALS ────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById("modalOverlay").classList.remove("hidden");
  document.getElementById(id).classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closeModal() {
  document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden"));
  document.getElementById("modalOverlay").classList.add("hidden");
  document.body.style.overflow = "";
  clearInterval(paymentPollInterval);
  document.getElementById("paymentResult").classList.add("hidden");
}

// ─── UTILITIES ────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}

// ─── INIT ─────────────────────────────────────────────────────
async function loadPublicSettings() {
  try {
    const r = await fetch("/api/settings/public");
    const data = await r.json();
    if (data.success) {
      window.publicSettings = data.settings;
      updatePostingFeeDisplays(data.settings.posting_fee);
    }
  } catch (e) {
    /* non-fatal */
  }
}

async function init() {
  await Promise.all([checkAuth(), loadPublicSettings()]);
  initGoogleAuth();
  const params = new URLSearchParams(window.location.search);
  const resetToken = params.get("token");
  if (resetToken) {
    history.replaceState({}, "", "/");
    const tokenEl = document.getElementById("resetToken");
    if (tokenEl) tokenEl.value = resetToken;
    showPage("reset-password");
  } else if (window.location.pathname === "/admin") {
    history.replaceState({}, "", "/");
    showPage("admin");
  } else {
    showPage("home");
  }
}

init();

// ─── GOOGLE AUTH ──────────────────────────────────────────────
let googleClientId = null;

async function initGoogleAuth() {
  try {
    // Wait for Google GSI library to load
    if (!window.google) {
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (window.google) {
            clearInterval(check);
            resolve();
          }
        }, 200);
        setTimeout(() => {
          clearInterval(check);
          resolve();
        }, 5000);
      });
    }
    const r = await fetch("/api/auth/google-client-id");
    const data = await r.json();
    if (!data.clientId || !window.google) return;
    googleClientId = data.clientId;
    google.accounts.id.initialize({
      client_id: googleClientId,
      callback: handleGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
      use_fedcm_for_prompt: false, // Avoid FedCM — works in all environments
    });
    // Render real Google buttons in the login/register containers
    // (renderButton opens a proper popup, works in iframes & all browsers)
    ["googleBtnLogin", "googleBtnRegister"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      google.accounts.id.renderButton(el, {
        type: "standard",
        theme: "filled_black",
        size: "large",
        text: id === "googleBtnRegister" ? "signup_with" : "continue_with",
        shape: "pill",
        width: Math.min(el.parentElement?.offsetWidth || 340, 400),
      });
    });
  } catch (e) {
    /* non-fatal */
  }
}

function triggerGoogleSignIn() {
  if (!window.google || !googleClientId) {
    toast(
      "Google Sign-In is loading, please try again in a moment.",
      "warning",
    );
    return;
  }
  // Fallback: prompt via One Tap if button not rendered
  google.accounts.id.prompt((n) => {
    if (n.isNotDisplayed() || n.isSkippedMoment()) {
      toast(
        "Google Sign-In popup was blocked. Please allow popups and try again.",
        "warning",
      );
    }
  });
}

async function handleGoogleCredential(response) {
  try {
    const res = await api("POST", "/auth/google", {
      credential: response.credential,
    });
    if (res.success) {
      authToken = res.token;
      localStorage.setItem("jiji_token", res.token);
      currentUser = res.user;
      updateNavUser();
      toast(
        `Welcome, ${res.user.full_name}! ${res.isNew ? "Account created." : "Logged in."}`,
        "success",
      );
      showPage("home");
    } else {
      toast(res.message || "Google sign-in failed.", "error");
    }
  } catch (e) {
    toast("Google sign-in failed. Please try again.", "error");
  }
}

// ─── SHOPS ────────────────────────────────────────────────────
let allShops = [];

async function loadShops() {
  if (currentUser) {
    document.getElementById("createShopBtn").style.display = "";
  } else {
    document.getElementById("createShopBtn").style.display = "none";
  }
  try {
    const res = await api("GET", "/shops");
    allShops = res.shops || [];
    renderShopsGrid(allShops);

    // Populate category filter
    const cats = [
      ...new Set(allShops.map((s) => s.category_name).filter(Boolean)),
    ];
    const filterEl = document.getElementById("shopCategoryFilter");
    filterEl.innerHTML =
      '<option value="">All Categories</option>' +
      cats
        .map((c) => `<option value="${escHtml(c)}">${escHtml(c)}</option>`)
        .join("");

    // Populate shop category select in create modal
    const catEl = document.getElementById("shopCategory");
    if (catEl) {
      try {
        const catRes = await api("GET", "/products/categories");
        catEl.innerHTML =
          '<option value="">— Select category —</option>' +
          (catRes.categories || [])
            .map((c) => `<option value="${c.id}">${escHtml(c.name)}</option>`)
            .join("");
      } catch {}
    }
  } catch (e) {
    document.getElementById("shopsGrid").innerHTML =
      '<div class="empty-state"><i class="fas fa-store-alt"></i><h3>Could not load shops</h3></div>';
  }
}

function filterShops() {
  const search = (
    document.getElementById("shopSearchInput")?.value || ""
  ).toLowerCase();
  const cat = document.getElementById("shopCategoryFilter")?.value || "";
  const filtered = allShops.filter((s) => {
    const matchSearch =
      !search ||
      s.name.toLowerCase().includes(search) ||
      (s.description || "").toLowerCase().includes(search) ||
      (s.location || "").toLowerCase().includes(search);
    const matchCat = !cat || s.category_name === cat;
    return matchSearch && matchCat;
  });
  renderShopsGrid(filtered);
}

function renderShopsGrid(shops) {
  const grid = document.getElementById("shopsGrid");
  if (!shops.length) {
    grid.innerHTML =
      '<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-store-alt"></i><h3>No shops found</h3><p>Be the first to create a shop in Chogoria!</p></div>';
    return;
  }
  grid.innerHTML = shops
    .map(
      (s) => `
        <div class="shop-card" onclick="openShop('${s.id}')">
            <div class="shop-cover">
                ${
                  s.cover_url
                    ? `<img src="${escHtml(s.cover_url)}" alt="${escHtml(s.name)}" loading="lazy">`
                    : `<div class="shop-cover-placeholder"><i class="fas fa-store-alt"></i></div>`
                }
                <div class="shop-logo">
                    ${s.logo_url ? `<img src="${escHtml(s.logo_url)}" alt="">` : `<i class="fas fa-store"></i>`}
                </div>
            </div>
            <div class="shop-body">
                <div class="shop-name">${escHtml(s.name)} ${s.is_verified ? '<span class="shop-verified"><i class="fas fa-check-circle"></i> Verified</span>' : ""}</div>
                <div class="shop-meta">
                    ${s.category_name ? `<span><i class="fas fa-tag"></i> ${escHtml(s.category_name)}</span>` : ""}
                    ${s.location ? `<span><i class="fas fa-map-marker-alt"></i> ${escHtml(s.location)}</span>` : ""}
                    ${s.opening_hours ? `<span><i class="fas fa-clock"></i> ${escHtml(s.opening_hours)}</span>` : ""}
                </div>
                ${s.description ? `<p style="font-size:0.8rem;color:var(--subtext);margin-bottom:10px;line-height:1.4;">${escHtml(s.description).substring(0, 80)}${s.description.length > 80 ? "…" : ""}</p>` : ""}
                <div class="shop-actions" onclick="event.stopPropagation()">
                    ${s.whatsapp_number ? `<a href="https://wa.me/${waNum(s.whatsapp_number)}?text=Hi, I found your shop on Jiji ya Chogoria!" target="_blank" rel="noopener" class="btn-primary" style="flex:1;text-align:center;padding:8px;font-size:0.8rem;text-decoration:none;border-radius:var(--radius-pill);display:flex;align-items:center;justify-content:center;gap:6px;"><i class="fab fa-whatsapp"></i> WhatsApp</a>` : ""}
                    <button class="btn-outline" style="flex:1;padding:8px;font-size:0.8rem;" onclick="openShop('${s.id}')"><i class="fas fa-eye"></i> View</button>
                </div>
            </div>
        </div>`,
    )
    .join("");
}

function waNum(phone) {
  let p = String(phone).replace(/\D/g, "");
  if (p.startsWith("0")) p = "254" + p.slice(1);
  if (p.startsWith("7") || p.startsWith("1")) p = "254" + p;
  return p;
}

async function openShop(id) {
  showPage("shop-detail");
  const el = document.getElementById("shopDetailContent");
  el.innerHTML =
    '<div class="container" style="padding:40px;text-align:center"><div class="loading-spinner-sm"></div></div>';
  try {
    const res = await api("GET", `/shops/${id}`);
    const s = res.shop;
    const products = res.products || [];
    el.innerHTML = `
        <div class="shop-detail-cover">
            ${s.cover_url ? `<img src="${escHtml(s.cover_url)}" alt="${escHtml(s.name)}">` : `<div style="height:100%;background:linear-gradient(135deg,#1a1a1a,#111);display:flex;align-items:center;justify-content:center;"><i class="fas fa-store-alt" style="font-size:3rem;color:var(--accent1);opacity:0.4;"></i></div>`}
        </div>
        <div class="container" style="padding-top:24px;padding-bottom:48px">
            <button class="btn-outline" onclick="showPage('shops')" style="margin-bottom:16px;"><i class="fas fa-arrow-left"></i> All Shops</button>
            <div class="shop-detail-header">
                <div class="shop-detail-logo">
                    ${s.logo_url ? `<img src="${escHtml(s.logo_url)}" alt="">` : `<i class="fas fa-store"></i>`}
                </div>
                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
                    <div>
                        <h1 style="margin-bottom:4px;font-size:1.4rem;">${escHtml(s.name)} ${s.is_verified ? '<span class="shop-verified"><i class="fas fa-check-circle"></i> Verified</span>' : ""}</h1>
                        ${s.description ? `<p style="color:var(--subtext);font-size:0.9rem;margin:0;">${escHtml(s.description)}</p>` : ""}
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        ${s.whatsapp_number ? `<a href="https://wa.me/${waNum(s.whatsapp_number)}?text=Hi, I found your shop on Jiji ya Chogoria!" target="_blank" rel="noopener" class="btn-primary" style="text-decoration:none;display:flex;align-items:center;gap:8px;"><i class="fab fa-whatsapp"></i> Chat on WhatsApp</a>` : ""}
                        ${s.maps_url ? `<a href="${escHtml(s.maps_url)}" target="_blank" rel="noopener" class="directions-btn"><i class="fas fa-map-marker-alt"></i> Get Directions</a>` : ""}
                    </div>
                </div>
                <div class="shop-info-grid">
                    ${s.location ? `<div class="shop-info-item"><i class="fas fa-map-marker-alt"></i><div><div class="shop-info-label">Location</div><div class="shop-info-value">${escHtml(s.location)}</div></div></div>` : ""}
                    ${s.category_name ? `<div class="shop-info-item"><i class="fas fa-tag"></i><div><div class="shop-info-label">Category</div><div class="shop-info-value">${escHtml(s.category_name)}</div></div></div>` : ""}
                    ${s.opening_hours ? `<div class="shop-info-item"><i class="fas fa-clock"></i><div><div class="shop-info-label">Hours</div><div class="shop-info-value">${escHtml(s.opening_hours)}</div></div></div>` : ""}
                    ${s.whatsapp_number ? `<div class="shop-info-item"><i class="fab fa-whatsapp"></i><div><div class="shop-info-label">WhatsApp</div><div class="shop-info-value">${escHtml(s.whatsapp_number)}</div></div></div>` : ""}
                </div>
            </div>
            <div class="section-title" style="margin-top:32px"><h2><i class="fas fa-tags"></i> Shop Listings</h2></div>
            ${
              products.length
                ? `<div class="products-grid">${products.map(renderProductCard).join("")}</div>`
                : '<div class="empty-state"><i class="fas fa-tags"></i><h3>No listings yet</h3><p>This shop hasn\'t posted any listings yet.</p></div>'
            }
        </div>`;
  } catch {
    el.innerHTML =
      '<div class="container" style="padding:40px;text-align:center"><div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>Could not load shop</h3></div></div>';
  }
}

function showCreateShopModal() {
  if (!currentUser) {
    showPage("login");
    return;
  }
  openModal("createShopModal");
}

async function handleCreateShop(e) {
  e.preventDefault();
  const btn = document.getElementById("createShopBtn2");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
  try {
    const res = await api("POST", "/shops", {
      name: document.getElementById("shopName").value.trim(),
      category_id: document.getElementById("shopCategory").value || null,
      description: document.getElementById("shopDescription").value.trim(),
      location: document.getElementById("shopLocation").value.trim(),
      whatsapp_number: document.getElementById("shopWhatsapp").value.trim(),
      opening_hours: document.getElementById("shopHours").value.trim(),
      maps_url: document.getElementById("shopMapsUrl").value.trim(),
    });
    if (res.success) {
      toast("Shop created! It will appear after review.", "success");
      closeModal();
      document.getElementById("createShopForm").reset();
      loadShops();
    } else {
      toast(res.message, "error");
    }
  } catch (e) {
    toast("Could not create shop.", "error");
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-store-alt"></i> Create Shop';
}

// ─── COMMUNITY CHAT ───────────────────────────────────────────
let chatPollInterval = null;
let lastChatTs = null;
let allChatMessages = [];

async function loadChat() {
  clearInterval(chatPollInterval);
  allChatMessages = [];
  lastChatTs = null;

  const inputRow = document.getElementById("chatInputRow");
  const loginPrompt = document.getElementById("chatLoginPrompt");
  if (currentUser) {
    inputRow.classList.remove("hidden");
    loginPrompt.classList.add("hidden");
  } else {
    inputRow.classList.add("hidden");
    loginPrompt.classList.remove("hidden");
  }

  await fetchChatMessages(true);
  chatPollInterval = setInterval(() => fetchChatMessages(false), 3000);
}

async function fetchChatMessages(initial = false) {
  try {
    const url = lastChatTs
      ? `/chat?since=${encodeURIComponent(lastChatTs)}`
      : "/chat";
    const res = await api("GET", url);
    const msgs = res.messages || [];
    if (msgs.length > 0) {
      if (initial) {
        allChatMessages = msgs;
      } else {
        allChatMessages = [...allChatMessages, ...msgs];
      }
      lastChatTs = msgs[msgs.length - 1].created_at;
      renderChatMessages(initial);
    } else if (initial) {
      document.getElementById("chatMessages").innerHTML =
        '<div class="empty-state small"><i class="fas fa-comments"></i><p>No messages yet. Start the conversation!</p></div>';
    }
  } catch {}
}

function renderChatMessages(scrollToBottom = false) {
  const el = document.getElementById("chatMessages");
  const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;

  el.innerHTML = allChatMessages
    .map((m) => {
      const isOwn = currentUser && m.user_id === currentUser.id;
      const isAdmin = m.user_role === "admin" || m.user_role === "moderator";
      const initials = (m.sender_name || "?")
        .split(" ")
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
      return `<div class="chat-msg ${isOwn ? "own" : ""} ${isAdmin ? "chat-admin" : ""}">
            <div class="chat-avatar">${m.avatar_url ? `<img src="${escHtml(m.avatar_url)}" alt="">` : initials}</div>
            <div>
                <div class="chat-bubble">
                    ${!isOwn ? `<div class="chat-sender">${escHtml(m.sender_name)}${isAdmin ? ' <i class="fas fa-shield-alt" style="font-size:0.65rem;color:var(--warning)"></i>' : ""}</div>` : ""}
                    <div class="chat-text">${escHtml(m.message)}</div>
                    <div class="chat-time">${timeAgo(m.created_at)}</div>
                </div>
            </div>
        </div>`;
    })
    .join("");

  if (scrollToBottom || wasAtBottom) {
    el.scrollTop = el.scrollHeight;
  }
}

async function sendChatMessage() {
  if (!currentUser) {
    toast("Please login to chat.", "warning");
    showPage("login");
    return;
  }
  const input = document.getElementById("chatInput");
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";
  try {
    const res = await api("POST", "/chat", { message: msg });
    if (res.success) {
      await fetchChatMessages(false);
    } else {
      toast(res.message || "Could not send message.", "error");
      input.value = msg;
    }
  } catch {
    toast("Could not send message.", "error");
    input.value = msg;
  }
}

// Stop chat polling when leaving chat page
const _origShowPage = showPage;
showPage = function (page) {
  if (page !== "chat" && chatPollInterval) {
    clearInterval(chatPollInterval);
    chatPollInterval = null;
  }
  _origShowPage(page);
};

// ─── DOWNLOAD APP PAGE ────────────────────────────────────────
async function loadDownloadApp() {
  try {
    const r = await fetch("/api/settings/public");
    const data = await r.json();
    const settings = data.settings || {};
    const apkUrl = settings.apk_url;
    const apkVersion = settings.apk_version;

    const btn = document.getElementById("apkDownloadBtn");
    const coming = document.getElementById("apkComingSoon");
    const versionLabel = document.getElementById("apkVersionLabel");

    if (apkUrl) {
      btn.href = apkUrl;
      btn.style.display = "inline-flex";
      if (apkVersion) versionLabel.textContent = `v${apkVersion}`;
      if (coming) coming.style.display = "none";
    } else {
      btn.style.display = "none";
      if (coming) coming.style.display = "";
    }
  } catch {}
}

// ─── NEWSLETTER ───────────────────────────────────────────────
async function subscribeNewsletter(e) {
  if (e) e.preventDefault();
  const btn = document.getElementById("newsletterBtn");
  const email = document.getElementById("newsletterEmail")?.value.trim();
  const name = document.getElementById("newsletterName")?.value.trim();
  if (!email) {
    toast("Enter your email address.", "error");
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  }
  try {
    const res = await fetch("/api/newsletter/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name: name || undefined }),
    }).then((r) => r.json());
    if (res.success) {
      toast(res.message, "success", 4500);
      if (document.getElementById("newsletterEmail"))
        document.getElementById("newsletterEmail").value = "";
      if (document.getElementById("newsletterName"))
        document.getElementById("newsletterName").value = "";
    } else {
      toast(res.message || "Could not subscribe.", "error");
    }
  } catch {
    toast("Could not subscribe. Please try again.", "error");
  }
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Subscribe';
  }
}

// ─── SHOP UNLOCK PAYMENT ──────────────────────────────────────
async function initiateShopUnlockPayment() {
  if (!currentUser) {
    showPage("login");
    return;
  }
  const phone = document.getElementById("shopUnlockPhone")?.value.trim();
  if (!phone) {
    toast("Enter your M-Pesa phone number.", "error");
    return;
  }
  const btn = document.getElementById("shopUnlockBtn");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
  }
  try {
    const res = await api("POST", "/payments/shop-unlock", { phone });
    if (res.success) {
      document.getElementById("paymentModalTitle").textContent =
        "Shop Unlock — KES 300";
      document.getElementById("paymentStatusMsg").textContent =
        "Check your phone and enter your M-Pesa PIN...";
      document.getElementById("paymentResult").classList.add("hidden");
      openModal("paymentCheckModal");
      startPaymentPolling(res.paymentId);
    } else {
      toast(res.message, "error");
    }
  } catch (err) {
    toast(err.message || "Payment failed. Try again.", "error");
  }
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-store-alt"></i> Unlock Shop';
  }
}

// ─── ADMIN: APK SETTINGS ─────────────────────────────────────
async function saveApkSetting() {
  const url = document.getElementById("settingApkUrl").value.trim();
  if (!url) {
    toast("Enter the APK URL.", "error");
    return;
  }
  try {
    const res = await api("PUT", "/admin/settings/apk_url", { value: url });
    if (res.success) {
      toast("APK URL saved!", "success");
      const infoEl = document.getElementById("currentApkInfo");
      const linkEl = document.getElementById("currentApkUrl");
      if (infoEl) {
        infoEl.classList.remove("hidden");
      }
      if (linkEl) {
        linkEl.href = url;
        linkEl.textContent = url.length > 50 ? url.substring(0, 50) + "…" : url;
      }
    } else toast(res.message, "error");
  } catch {
    toast("Save failed.", "error");
  }
}

// patch loadAdminSettings to also load APK + announcement
const _origLoadAdminSettings = loadAdminSettings;
loadAdminSettings = async function () {
  await _origLoadAdminSettings();
  try {
    const res = await api("GET", "/admin/settings");
    if (!res.success) return;
    const get = (k) => res.settings.find((s) => s.key === k)?.value || "";
    const apkUrl = get("apk_url");
    const apkVer = get("apk_version");
    const announcement = get("site_announcement");

    if (document.getElementById("settingApkUrl"))
      document.getElementById("settingApkUrl").value = apkUrl;
    if (document.getElementById("settingApkVersion"))
      document.getElementById("settingApkVersion").value = apkVer;
    if (document.getElementById("settingAnnouncement"))
      document.getElementById("settingAnnouncement").value = announcement;

    const infoEl = document.getElementById("currentApkInfo");
    const linkEl = document.getElementById("currentApkUrl");
    if (apkUrl && infoEl && linkEl) {
      infoEl.classList.remove("hidden");
      linkEl.href = apkUrl;
      linkEl.textContent =
        apkUrl.length > 50 ? apkUrl.substring(0, 50) + "…" : apkUrl;
    }
  } catch {}
};

// ─── ADMIN: FLAG PRODUCT ──────────────────────────────────────
async function adminFlagProduct(id, flag) {
  try {
    const res = await api("PUT", `/admin/products/${id}/flag`, { flag });
    if (res.success) {
      toast(res.message, "success");
      loadAdminListings();
    } else toast(res.message, "error");
  } catch {
    toast("Action failed.", "error");
  }
}

// ─── FORGOT PASSWORD ───────────────────────────────────────────
function loadForgotPassword() {
  const form = document.getElementById("forgotForm");
  if (form) form.reset();
}

async function handleForgotPassword(e) {
  if (e) e.preventDefault();
  const btn = document.getElementById("forgotBtn");
  const email = document.getElementById("forgotEmail").value.trim();
  if (!email) {
    toast("Enter your email address.", "error");
    return;
  }
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
  try {
    const res = await api("POST", "/auth/forgot-password", { email });
    if (res.success) {
      toast("Reset link sent! Check your email inbox.", "success", 5000);
      document.getElementById("forgotForm").reset();
      setTimeout(() => showPage("login"), 3000);
    } else {
      toast(res.message || "Could not send reset link.", "error");
    }
  } catch {
    toast("Request failed. Try again.", "error");
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Reset Link';
}

// ─── RESET PASSWORD ────────────────────────────────────────────
function loadResetPassword() {
  /* page is pre-filled via init() */
}

async function handleResetPassword(e) {
  if (e) e.preventDefault();
  const btn = document.getElementById("resetBtn");
  const token = document.getElementById("resetToken").value;
  const password = document.getElementById("resetPassword").value;
  const confirm = document.getElementById("resetPasswordConfirm").value;
  if (!token) {
    toast("Invalid reset link.", "error");
    showPage("login");
    return;
  }
  if (password.length < 6) {
    toast("Password must be at least 6 characters.", "error");
    return;
  }
  if (password !== confirm) {
    toast("Passwords do not match.", "error");
    return;
  }
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
  try {
    const res = await api("POST", "/auth/reset-password", { token, password });
    if (res.success) {
      toast("Password updated! You can now log in.", "success", 4000);
      document.getElementById("resetForm").reset();
      setTimeout(() => showPage("login"), 2500);
    } else {
      toast(res.message || "Reset failed.", "error");
    }
  } catch {
    toast("Request failed. Try again.", "error");
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-check"></i> Update Password';
}

// ─── AD DRAFT (localStorage) ───────────────────────────────────
function saveAdDraft() {
  try {
    const draft = {
      title: document.getElementById("adTitle")?.value || "",
      description: document.getElementById("adDescription")?.value || "",
      price: document.getElementById("adPrice")?.value || "",
      category: document.getElementById("adCategory")?.value || "",
      condition: document.getElementById("adCondition")?.value || "",
      location: document.getElementById("adLocation")?.value || "",
      negotiable: document.getElementById("adNegotiable")?.checked || false,
    };
    localStorage.setItem("jiji_ad_draft", JSON.stringify(draft));
  } catch {}
}

function restoreAdDraft() {
  try {
    const raw = localStorage.getItem("jiji_ad_draft");
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.title) document.getElementById("adTitle").value = d.title;
    if (d.description)
      document.getElementById("adDescription").value = d.description;
    if (d.price) document.getElementById("adPrice").value = d.price;
    if (d.category) document.getElementById("adCategory").value = d.category;
    if (d.condition) document.getElementById("adCondition").value = d.condition;
    if (d.location) document.getElementById("adLocation").value = d.location;
    if (d.negotiable) document.getElementById("adNegotiable").checked = true;
    if (d.title || d.description) toast("Draft restored.", "default", 2000);
  } catch {}
}

function clearAdDraft() {
  try {
    localStorage.removeItem("jiji_ad_draft");
  } catch {}
}

// ═══════════════════════════════════════════════════════════════
//  LOCATION SYSTEM
// ═══════════════════════════════════════════════════════════════

async function getLocations() {
  if (!locationsCache.length) {
    try {
      const res = await api("GET", "/locations");
      if (res.success) locationsCache = res.locations;
    } catch {}
  }
  return locationsCache;
}

function populateLocationSelect(selectEl, currentValue = "") {
  if (!selectEl || !locationsCache.length) return;
  const prevVal = currentValue || selectEl.value;
  selectEl.innerHTML =
    '<option value="">Select your area...</option>' +
    locationsCache
      .map(
        (l) =>
          `<option value="${escHtml(l.name)}"${l.name === prevVal ? " selected" : ""}>${escHtml(l.name)}${parseFloat(l.distance_from_chogoria) > 0 ? " (" + l.distance_from_chogoria + " km)" : ""}</option>`,
      )
      .join("");
}

async function loadLocationPicker() {
  try {
    await getLocations();
    const sel = document.getElementById("adLocation");
    if (!sel || !locationsCache.length) return;
    sel.innerHTML =
      '<option value="">Select location...</option>' +
      locationsCache
        .map(
          (l) =>
            `<option value="${escHtml(l.name)}" data-lat="${l.lat}" data-lng="${l.lng}">
                    ${escHtml(l.name)}${parseFloat(l.distance_from_chogoria) > 0 ? " (" + l.distance_from_chogoria + " km)" : ""}
                </option>`,
        )
        .join("");
    sel.onchange = function () {
      const opt = this.options[this.selectedIndex];
      document.getElementById("adLat").value = opt.dataset.lat || "";
      document.getElementById("adLng").value = opt.dataset.lng || "";
    };
    // Restore draft location
    const draft = JSON.parse(localStorage.getItem("jiji_ad_draft") || "{}");
    if (draft.location) sel.value = draft.location;
  } catch (e) {
    console.warn("Location picker load failed:", e);
  }
}

function setPostAdLocation(lat, lng, name) {
  const sel = document.getElementById("adLocation");
  if (sel) {
    let found = false;
    for (const opt of sel.options) {
      if (opt.value === name) {
        sel.value = name;
        found = true;
        break;
      }
    }
    if (!found && name) {
      const opt = new Option(`${name} (GPS)`, name);
      opt.dataset.lat = lat;
      opt.dataset.lng = lng;
      sel.add(opt);
      sel.value = name;
    }
  }
  document.getElementById("adLat").value = lat;
  document.getElementById("adLng").value = lng;
  const btn = document.getElementById("useLocationBtn");
  if (btn)
    btn.innerHTML = `<i class="fas fa-check" style="color:#4caf50"></i> ${name}`;
}

async function useMyLocationForFilter() {
  await useMyLocation(() => {
    const btn = document.getElementById("filterLocBtn");
    if (btn) btn.innerHTML = `<i class="fas fa-check"></i> Location set`;
    const radiusSel = document.getElementById("filterRadius");
    if (radiusSel && !radiusSel.value) radiusSel.value = "10";
    applyFilters();
  });
}

async function useMyLocation(callback) {
  if (!navigator.geolocation) {
    toast("Your browser does not support geolocation.", "error");
    return;
  }
  const btn =
    document.getElementById("useLocationBtn") ||
    document.getElementById("filterLocBtn");
  const origHTML = btn ? btn.innerHTML : "";
  if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting...';

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      let nearest = { name: "Chogoria Town", dist: Infinity };
      try {
        if (!locationsCache.length) {
          const r = await api("GET", "/locations");
          if (r.success) locationsCache = r.locations;
        }
        for (const loc of locationsCache) {
          const d = haversine(
            lat,
            lng,
            parseFloat(loc.lat),
            parseFloat(loc.lng),
          );
          if (d < nearest.dist) nearest = { name: loc.name, dist: d };
        }
      } catch {}

      userLocation = { lat, lng, name: nearest.name };
      localStorage.setItem("jiji_user_location", JSON.stringify(userLocation));

      if (currentUser) {
        try {
          await api("POST", "/locations/save", {
            lat,
            lng,
            location_name: nearest.name,
          });
        } catch {}
      }
      toast(`Location: ${nearest.name}`, "success");
      if (callback) callback(lat, lng, nearest.name);
    },
    () => {
      if (btn) btn.innerHTML = origHTML;
      toast("Could not get location. Please allow location access.", "error");
    },
    { timeout: 10000, maximumAge: 300000 },
  );
}

function initProductMap(lat, lng, title, locationName) {
  const mapEl = document.getElementById("productMap");
  if (!mapEl || typeof L === "undefined") return;

  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
  }

  try {
    leafletMap = L.map("productMap", {
      zoomControl: true,
      scrollWheelZoom: false,
    }).setView([lat, lng], 14);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(leafletMap);

    const pinIcon = L.divIcon({
      html: '<div class="map-marker-pin"><i class="fas fa-map-marker-alt"></i></div>',
      className: "",
      iconSize: [32, 40],
      iconAnchor: [16, 40],
      popupAnchor: [0, -42],
    });

    L.marker([lat, lng], { icon: pinIcon })
      .addTo(leafletMap)
      .bindPopup(
        `<strong style="color:#ff6b35">${title}</strong>${locationName ? `<br><small>${locationName}</small>` : ""}`,
      )
      .openPopup();

    if (userLocation) {
      const userIcon = L.divIcon({
        html: '<div class="map-marker-user"><i class="fas fa-user-circle"></i></div>',
        className: "",
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      L.marker([userLocation.lat, userLocation.lng], { icon: userIcon })
        .addTo(leafletMap)
        .bindPopup("<strong>Your location</strong>");

      const group = L.featureGroup([
        L.marker([lat, lng]),
        L.marker([userLocation.lat, userLocation.lng]),
      ]);
      leafletMap.fitBounds(group.getBounds().pad(0.25));
    }

    setTimeout(() => leafletMap && leafletMap.invalidateSize(), 250);
  } catch (e) {
    console.warn("Map error:", e);
  }
}

// ═══════════════════════════════════════════════════════════════
//  THEME TOGGLE
// ═══════════════════════════════════════════════════════════════
function toggleTheme() {
  const isLight =
    document.documentElement.getAttribute("data-theme") === "light";
  const next = isLight ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("jiji_theme", next);
  const btn = document.getElementById("themeToggle");
  if (btn)
    btn.innerHTML =
      next === "light"
        ? '<i class="fas fa-moon"></i>'
        : '<i class="fas fa-sun"></i>';
}

// ═══════════════════════════════════════════════════════════════
//  DM / MESSAGES SYSTEM
// ═══════════════════════════════════════════════════════════════

async function loadMessages() {
  if (!currentUser) {
    document.getElementById("dmConversationList").innerHTML =
      `<div class="empty-state small"><i class="fas fa-lock"></i><p><a href="#" onclick="showPage('login')">Login</a> to view messages</p></div>`;
    return;
  }
  stopDMPoll();
  currentConvId = null;
  showDMInbox();
  await loadDMInbox();
  loadDMUnreadCount();
}

async function loadDMInbox() {
  const list = document.getElementById("dmConversationList");
  try {
    const res = await api("GET", "/dm");
    if (!res.success) {
      list.innerHTML =
        '<div class="empty-state small"><p>Error loading messages.</p></div>';
      return;
    }
    const convs = res.conversations;
    const countEl = document.getElementById("dmInboxCount");
    if (countEl) countEl.textContent = convs.length || "";
    if (!convs.length) {
      list.innerHTML = `<div class="empty-state small" style="padding:32px 16px">
                <i class="fas fa-inbox"></i><p>No messages yet</p>
                <small>Contact a seller from a listing to start chatting</small></div>`;
      return;
    }
    dmConvMap.clear();
    convs.forEach((c) => dmConvMap.set(c.id, c));
    list.innerHTML = convs
      .map((c) => {
        const initials = (c.other_user_name || "?").charAt(0).toUpperCase();
        const avatarHtml = c.other_user_avatar
          ? `<img src="${escHtml(c.other_user_avatar)}" alt="">`
          : initials;
        const unread = parseInt(c.unread_count || 0);
        return `<div class="conv-item ${currentConvId === c.id ? "active" : ""}" data-cid="${c.id}" onclick="openDMThreadById('${c.id}')">
                <div class="conv-avatar">${avatarHtml}</div>
                <div class="conv-body">
                    <div class="conv-name">${escHtml(c.other_user_name || "Unknown")}</div>
                    ${c.product_title ? `<div class="conv-product"><i class="fas fa-tag" style="font-size:0.65rem"></i> ${escHtml(c.product_title)}</div>` : ""}
                    <div class="conv-preview">${escHtml(c.last_message || "Start a conversation...")}</div>
                </div>
                <div class="conv-time">${c.last_message_at ? timeAgo(c.last_message_at) : ""}</div>
                ${unread > 0 ? `<div class="conv-unread">${unread}</div>` : ""}
            </div>`;
      })
      .join("");
  } catch (err) {
    console.error(err);
    list.innerHTML =
      '<div class="empty-state small"><p>Could not load messages.</p></div>';
  }
}

function openDMThreadById(convId) {
  const conv = dmConvMap.get(convId);
  if (conv) openDMThread(convId, conv);
}

function showDMInbox() {
  document.getElementById("dmInbox").classList.remove("hidden");
  document.getElementById("dmThread").classList.add("hidden");
  document.getElementById("dmEmptyThread")?.classList.remove("hidden");
  stopDMPoll();
  currentConvId = null;
  dmLastMsgTime = null;
}

async function openDMThread(convId, conv) {
  currentConvId = convId;
  stopDMPoll();
  dmLastMsgTime = null;

  // Highlight active conv
  document
    .querySelectorAll(".conv-item")
    .forEach((el) => el.classList.remove("active"));
  const activeEl = document.querySelector(`.conv-item[onclick*="${convId}"]`);
  if (activeEl) activeEl.classList.add("active");

  // Show thread panel
  const inbox = document.getElementById("dmInbox");
  const thread = document.getElementById("dmThread");
  const empty = document.getElementById("dmEmptyThread");
  inbox.classList.add("hidden");
  thread.classList.remove("hidden");
  if (empty) empty.classList.add("hidden");

  // Set thread header
  document.getElementById("dmThreadName").textContent =
    conv.other_user_name || "User";
  document.getElementById("dmThreadSub").textContent = conv.product_title
    ? `Re: ${conv.product_title}`
    : "Direct message";

  // On desktop, keep inbox visible
  if (window.innerWidth > 640) {
    inbox.classList.remove("hidden");
  }

  await loadDMThread(convId);
  startDMPoll(convId);
  document.getElementById("dmInput")?.focus();
}

async function loadDMThread(convId) {
  const msgs = document.getElementById("dmMessages");
  try {
    const params = dmLastMsgTime
      ? `?since=${encodeURIComponent(dmLastMsgTime)}`
      : "";
    const res = await api("GET", `/dm/${convId}/messages${params}`);
    if (!res.success) return;

    if (!dmLastMsgTime) {
      // Full load
      if (!res.messages.length) {
        msgs.innerHTML = `<div class="empty-state small" style="flex:1"><i class="fas fa-comment-slash"></i><p>No messages yet. Say hi!</p></div>`;
      } else {
        msgs.innerHTML = res.messages.map((m) => renderDMBubble(m)).join("");
        msgs.scrollTop = msgs.scrollHeight;
      }
    } else if (res.messages.length) {
      // Poll: append new
      res.messages.forEach((m) => {
        const wrap = document.createElement("div");
        wrap.innerHTML = renderDMBubble(m);
        msgs.appendChild(wrap.firstChild);
      });
      msgs.scrollTop = msgs.scrollHeight;
    }

    if (res.messages.length) {
      dmLastMsgTime = res.messages[res.messages.length - 1].created_at;
    } else if (!dmLastMsgTime && res.messages.length === 0) {
      // Set a sentinel so future polls only fetch new
      dmLastMsgTime = new Date().toISOString();
    }

    loadDMUnreadCount();
  } catch (err) {
    console.error("loadDMThread error:", err);
  }
}

function renderDMBubble(m) {
  const isOwn = m.sender_id === currentUser?.id;
  const initials = (m.sender_name || "?").charAt(0).toUpperCase();
  const avatarHtml = m.sender_avatar
    ? `<img src="${m.sender_avatar}" style="width:28px;height:28px;border-radius:50%;object-fit:cover">`
    : initials;
  return `<div class="dm-bubble-wrap ${isOwn ? "own" : ""}">
        ${!isOwn ? `<div class="dm-bub-avatar">${avatarHtml}</div>` : ""}
        <div>
            <div class="dm-bubble">${escHtml(m.message)}</div>
            <div class="dm-time">${timeAgo(m.created_at)}</div>
        </div>
    </div>`;
}

async function sendDMMessage() {
  if (!currentConvId) return;
  const input = document.getElementById("dmInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  try {
    const res = await api("POST", `/dm/${currentConvId}/messages`, {
      message: text,
    });
    if (res.success) {
      const msgs = document.getElementById("dmMessages");
      const empty = msgs.querySelector(".empty-state");
      if (empty) empty.remove();
      const wrap = document.createElement("div");
      wrap.innerHTML = renderDMBubble(res.message);
      msgs.appendChild(wrap.firstChild);
      msgs.scrollTop = msgs.scrollHeight;
      dmLastMsgTime = res.message.created_at;
      loadDMInbox();
    } else {
      toast(res.message || "Could not send message.", "error");
      input.value = text;
    }
  } catch {
    toast("Could not send message.", "error");
    input.value = text;
  }
}

async function startDMWithSeller(
  sellerId,
  productId,
  productTitle,
  sellerName,
) {
  if (!currentUser) {
    toast("Login to message sellers.", "warning");
    showPage("login");
    return;
  }
  try {
    const res = await api("POST", "/dm", {
      other_user_id: sellerId,
      product_id: productId,
    });
    if (res.success) {
      showPage("messages");
      await loadDMInbox();
      await openDMThread(res.conversation_id, {
        id: res.conversation_id,
        other_user_name: sellerName,
        other_user_avatar: null,
        product_title: productTitle,
      });
    } else {
      toast(res.message || "Could not start conversation.", "error");
    }
  } catch {
    toast("Could not start conversation.", "error");
  }
}

function startDMPoll(convId) {
  dmPollTimer = setInterval(() => {
    if (currentConvId === convId) loadDMThread(convId);
  }, 5000);
}

function stopDMPoll() {
  if (dmPollTimer) {
    clearInterval(dmPollTimer);
    dmPollTimer = null;
  }
}

async function loadDMUnreadCount() {
  if (!currentUser) return;
  try {
    const res = await api("GET", "/dm/unread");
    updateDMBadge(res.unread || 0);
  } catch {}
}

// ─── MOBILE MENU: KEYBOARD + TOUCH CLOSE ──────────────────────
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMobileMenu();
});

// Swipe left on the sidebar to close it
(function initSwipeClose() {
  const menu = document.getElementById("mobileMenu");
  if (!menu) return;
  let startX = 0,
    startY = 0;
  menu.addEventListener(
    "touchstart",
    (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    },
    { passive: true },
  );
  menu.addEventListener(
    "touchend",
    (e) => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = Math.abs(e.changedTouches[0].clientY - startY);
      if (dx > 60 && dy < 80) closeMobileMenu(); // swipe right-to-left away → close
    },
    { passive: true },
  );
})();

function updateDMBadge(count) {
  const ids = ["dmBadge", "botDmBadge", "dropdownDmBadge", "mobileDmBadge"];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (count > 0) {
      el.textContent = count > 99 ? "99+" : count;
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
}
