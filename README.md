# SSW Paid Appointment Funnel

Next.js landing pages and booking flow for Sri Sri Wellbeing's ₹500 Nadi Pariksha consultation, with the funnel backend: Ops DB, lead rules, Slixta CRM sync, our own calendar, Razorpay, WhatsApp through Slixta, and checkout recovery. Phase 1 of the plan in [docs/](docs/README.md).

## Run it locally (no accounts needed)

```bash
npm install
npm run dev            # http://localhost:3000/ahmedabad/joints
```

With no environment variables set, everything runs locally:

| Part | Local behaviour |
| --- | --- |
| Database | PGlite (Postgres in-process) in `apps/web/.data/pglite`, migrated automatically |
| Slixta | Mock client, logs every call (`[slixta:mock]`) |
| Calendar | Mock calendar with the mock-up's slot grid; holds are real (15 min, no double booking) |
| Razorpay | Test mode: the pay step shows "Payment succeeds / Payment fails" buttons |
| WhatsApp | Messages are recorded in the `messages` table and logged |
| Jobs and timers | A 15 s ticker inside the dev server runs due jobs |

To use real partners, copy [.env.example](.env.example) to `apps/web/.env.local` and fill in the keys. Each partner switches from mock to live as soon as its credentials are present (`/api/health` shows which are live).

## Layout

```
apps/web        Next.js: centre landing pages (pre-rendered), booking card, API routes, webhooks
apps/worker     Queue worker for AWS (SQS + EventBridge) or a Postgres tick loop
packages/core   Funnel rules: phone, stage ranking, lead rules, signed links, signatures, schedules, schemas
packages/content Centres and programme copy (add a centre or campaign here)
packages/db     Ops DB schema (Drizzle) and migrations
packages/integrations  Slixta, calendar, Razorpay, Meta CAPI clients (live + mock)
packages/funnel Application services: booking, payments, recovery, reminders, webhooks, jobs
docs/           Plan, Slixta and calendar API specs, deployment guide, channel integrations
```

## Pages and endpoints

- Landing pages: `/ahmedabad/joints`, `/ahmedabad/sleep`, `/ahmedabad/women` (UTM parameters are captured automatically)
- Booking status (linked from the WhatsApp receipt): `/booking/<ref>?t=<token>`
- Booking API: `POST /api/leads`, `GET /api/slots`, `POST /api/holds`, `POST /api/holds/release`, `POST /api/payments/order`, `POST /api/payments/verify`, `GET /api/bookings/status`, `GET /api/bookings/ics`
- Webhooks: `POST /api/webhooks/razorpay`, `/api/webhooks/calendar`, `/api/webhooks/slixta`
- Ops: `GET /api/cron/tick` (Vercel Cron), `GET /api/health`

## Tests

```bash
npm test               # rules + full funnel scenarios on an in-memory database (Vitest)
npm run test:e2e       # booking in Chrome, phone and desktop sizes (Playwright, uses installed Chrome)
npm run typecheck
npm run lint
```

## Deploy

- **Vercel demo:** import the repo with root directory `apps/web`, add a Postgres database (Neon) and set `DATABASE_URL`, `LINK_SIGNING_SECRET`, `CRON_SECRET`, `SITE_URL`. `apps/web/vercel.json` adds the per-minute job cron.
- **AWS production:** one Docker image ([Dockerfile](Dockerfile)) runs as the `web` and `worker` Fargate services, with RDS, SQS, EventBridge Scheduler and CloudFront. Step by step in [docs/04-deployment-vercel-aws.md](docs/04-deployment-vercel-aws.md).

Database changes: edit `packages/db/src/schema.ts`, then `npm run db:generate` and `npm run db:migrate`.
# ssw
