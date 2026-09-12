# Deploying worksetu-new

## 1. Push to GitHub

```bash
git add -A
git commit -m "feat: new Worksetu frontend (redesigned UI, same backend)"
git remote add origin https://github.com/harsshadmax/worksetunew.git   # already set if you're using the same clone
git push -u origin main
```

## 2. Deploy on Render (static site)

1. Render dashboard → **New +** → **Static Site**.
2. Connect the `harsshadmax/worksetunew` GitHub repository.
3. Build settings:
   - **Build Command:** leave empty, or `echo "no build step"`
   - **Publish Directory:** `.` (repo root)
4. Deploy. Render will give you a URL like `https://worksetu-new.onrender.com`.

`render.yaml` in this repo already describes this as a Blueprint, so
"New + → Blueprint" pointed at the repo works too and picks up the same
settings automatically.

## 3. Required backend configuration change (not a code change)

This is the one thing that has to happen on the **existing** backend for
the new frontend to be able to call it at all: its CORS allowlist
(`CORS_ALLOWED_ORIGINS` environment variable on the `worksetu-api` Render
service) currently only permits `https://worksetu-web.onrender.com`. Add
this new site's exact deployed origin to that same variable
(comma-separated, no trailing slash), e.g.:

```
CORS_ALLOWED_ORIGINS=https://worksetu-web.onrender.com,https://worksetu-new.onrender.com
```

This is an environment variable on the shared production backend service —
not a line of backend code — but it does touch the existing live service,
so do this deliberately (Render dashboard → `worksetu-api` → Environment),
not as a side effect of deploying the new site. Nothing else about the
backend needs to change: same database, same routes, same auth.

## 4. About the reported UAE lag

Two separate things were contributing to it, and only one is fixable from
the frontend alone:

- **Frontend-side (fixed by this rewrite):** the original site loaded
  Tailwind's Play CDN (in-browser CSS compilation on every load), Vue's
  development build, and — separately, found and fixed directly on the
  original site — several JavaScript bugs that leaked `IntersectionObserver`
  instances on every login/logout, compounding into worse lag the longer a
  session ran. This rewrite ships plain precompiled CSS, Vue's production
  build, no observer-based animations, parallelized (not sequential) auth
  requests, and a non-blocking logout.
- **Infrastructure-side (not fixable by any frontend):** `worksetu-api` runs
  on Render's **Singapore** region. Round-trip latency from the UAE to
  Singapore is inherently high (undersea-cable distance, not a
  configuration issue) — no frontend code change reduces that base
  latency. What this rewrite *does* do is minimize the **number** of
  sequential round trips per action, which reduces the multiplier on that
  latency, but a further real fix (e.g. a backend/CDN presence closer to
  the Middle East, or an edge cache in front of read-heavy endpoints like
  `/public/stats` and `/services`) is a backend/infrastructure change and
  was out of scope here per "zero backend changes."

## 5. Extending past the v1 MVP scope

All of the following can be added without any backend change, since the
backend already supports them — they were simply left out of this first
pass to ship a working core flow quickly:

- **More admin pages** (Continuity Monitor, Live Worker Operations,
  Customers/Bookings/Cooperatives directories, Services Settings,
  Notifications, Reports, Audit Logs, Settings) — same pattern as the
  Admin dashboard already here: add a nav tab, a `view` branch, and a
  `GET`/`PATCH` call to the existing admin routes.
- **Live updates via Socket.io** — the backend already runs a Socket.io
  server; add `socket.io-client` back to `api.js` (removed here to keep
  the initial payload smaller) and reintroduce `connectSocket`/
  `onSocketEvent` exactly as in the original `api.js`.
- **Multi-language support** — the backend has no i18n; this was purely a
  frontend translations file in the original site. Port `translations.js`
  and a `t()` helper the same way.
- **Booking tracking/timeline, reviews, wallet redemption, incentives,
  welfare, worker profile/documents** — all existing, working backend
  routes not yet wired into this new UI.
