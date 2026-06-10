# Billable — Invoicing that pays for itself

Billable is a SaaS web app that lets freelancers, studios, and small businesses
create polished invoices in under a minute, track what's paid / pending / overdue,
and export print-ready PDFs — all from the browser.

## What's inside

| File | Purpose |
|---|---|
| `index.html` | Marketing landing page — hero, features, pricing, FAQ |
| `app.html` | The product — auth, dashboard, invoices, clients, settings |
| `css/landing.css` | Landing page styles |
| `css/app.css` | App + invoice document + print styles |
| `js/app.js` | All application logic (auth, data, charts, CRUD, PDF preview) |

## Features

- **Auth** — sign up / log in (client-side, localStorage), plus a one-click demo workspace
- **Dashboard** — collected / outstanding / overdue totals, 6-month revenue chart (canvas), activity feed
- **Invoices** — full CRUD, line items with live totals, tax & discount, multi-currency (USD, EUR, GBP, CAD, AUD, JPY, INR), status workflow (draft → sent → paid) with automatic overdue detection, search & filters
- **PDF export** — pixel-perfect invoice preview with a print stylesheet (`⬇ Download PDF / Print` → save as PDF)
- **Clients** — client book with per-client billed totals and invoice counts
- **Settings** — business profile, default currency/tax, plan switching (Starter / Pro / Business), JSON data export
- **Monetization** — freemium pricing tiers (Starter $0, Pro $12/mo, Business $29/mo); plan checkout is stubbed where Stripe would plug in

## Running it

No build step, no dependencies. Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Click **✨ Explore with demo data** on the app's login screen to see it fully populated.

## Notes

All data persists in `localStorage` under the `billable:` namespace. The
architecture keeps a clean seam (the `save()` / data-layer functions in
`js/app.js`) for swapping in a real backend + Stripe billing later.
