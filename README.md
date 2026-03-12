# ATLTechEvents

Unified, read-only calendar for Atlanta tech events aggregated from Tech Square ATL, Atlanta Tech Village, and ATDC.

## Features

- Daily scraping pipeline (three sources)
- Normalized event model and Postgres storage
- Read-only API: `GET /api/events`
- List and calendar views with filters

## Getting Started

1. Create a Postgres database and set `DATABASE_URL`.
2. Install dependencies.
3. Run Prisma migrations and generate the client.
4. Start the dev server.

## Environment

Create a `.env` file:

```
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/atltechevents"
```

## Scripts

- `npm run dev` – start the app
- `npm run scrape` – run the daily scraper

## Analytics

Vercel Web Analytics is enabled in the app shell via `@vercel/analytics`.
Enable Analytics for the project in the Vercel dashboard to start collecting visit metrics.

## Scheduled Scraping

Daily scraping is configured with GitHub Actions at `.github/workflows/daily-scrape.yml`.

Required repository secret:

- `DATABASE_URL` – production Postgres connection string

The workflow runs daily and can also be triggered manually from the Actions tab.

## Open Questions

- Include virtual/online events or only Atlanta-based physical events?
- Should past events be hidden entirely or accessible via a filter?
- Branding: neutral or explicitly “ATL Tech Community”?
