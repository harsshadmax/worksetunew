# Worksetu — redesigned frontend

A new, independent frontend for the Worksetu cooperative-services platform. This
is a **pure frontend rework**: it talks to the exact same production backend
(`https://worksetu-api.onrender.com`) as the original site
(`https://worksetu-web.onrender.com`) — same routes, same request/response
contract, same authentication model. No backend or database code was
touched to build this.

## What's here (v1 / MVP scope)

- Landing page with live platform stats and the service catalog
- Login + registration for Customer, Worker, and Admin roles
- Customer: browse services, submit a booking request, view booking history
- Worker: toggle availability, see incoming dispatch offers (accept/decline),
  wallet summary (earnings, dividend share)
- Admin: registrar dashboard summary stats

Deliberately **not** in this first pass (see `DEPLOY.md` for why, and how to
add them back without any backend change): the ~12 other admin sub-pages,
multi-language support, live Socket.io push updates, incentives/welfare/map
pages, review/rating flow, wallet redemption.

## Design

The visual design (color palette, typography, card layout, the "demo login
by role" pattern) is adapted from a reference design system — a clean,
navy-and-slate, Inter-typeface admin UI. No branding, copy, or
subject-matter content from that reference was carried over; only the
generic visual language.

## Local development

This is a static site with no build step — three files (`index.html`,
`api.js`, `app.js`) plus `styles.css`. Serve the directory with any static
file server, e.g.:

```bash
npx http-server . -p 5500
```

Then open `http://localhost:5500`. It will call the real production API
directly (see `index.html`'s `window.WORKSETU_API_BASE`), so you're
exercising real backend data from your first load.

## Files

- `index.html` — page shell + all view templates
- `app.js` — Vue 3 application logic (Composition API)
- `api.js` — backend API client (token handling, request wrapper) — same
  contract as the original site's `api.js`
- `styles.css` — hand-written design system, no CSS framework
- `render.yaml` — Render static-site Blueprint
- `DEPLOY.md` — step-by-step push + deploy guide, plus the one required
  backend **configuration** change (not a code change) and performance notes
