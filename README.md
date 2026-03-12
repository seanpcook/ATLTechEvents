# ATLTechEvents

Unified, read-only calendar for Atlanta tech events aggregated from Tech Square ATL, Atlanta Tech Village, and ATDC.

## Features

- Daily scraping pipeline (three sources)
- Normalized event model and Postgres storage
- Read-only API: `GET /api/events`
- List and calendar views with filters

## Getting Started

1. Get your Neon connection string from this project:
   - Org: org-solitary-mouse-70844258
   - Project: ancient-frost-89263007 (ATLTechEvents)
   - Recommended branch for local development: dev (br-falling-mountain-a8wrnxe3)
2. Copy .env.example to .env and set DATABASE_URL.
3. Install dependencies.
4. Run Prisma migrations and generate the client.
5. Start the dev server.

## Environment

Create a .env file from .env.example. Use a Neon pooled connection string for serverless-safe local and deployment behavior.

Example format:

```
DATABASE_URL="postgresql://<user>:<password>@<endpoint>-pooler.<region>.azure.neon.tech/neondb?sslmode=require"
```

Notes:

- Keep sslmode=require for Neon.
- Use the branch-specific connection string from the Neon Console so migrations and app reads target the intended branch.
- This project currently uses a single DATABASE_URL for both Prisma migrate and runtime reads.

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
