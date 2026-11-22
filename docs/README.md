# SSW Paid Appointment Funnel — Docs

Planning documents for the Sri Sri Wellbeing paid consultation funnel: Next.js landing pages, a custom backend on AWS, Slixta CRM, our own calendar, WhatsApp AI bot, Instagram (ManyChat), Razorpay and Bolna AI calls.

| File | Audience | What it covers |
| --- | --- | --- |
| [01-project-plan.md](01-project-plan.md) | Our team | The whole system mapped to the Figma board: channels, lead rules, payment check, recovery, reminders, telecalling, settlement, architecture, Ops DB, phases, open questions |
| [02-slixta-crm-api-requirements.md](02-slixta-crm-api-requirements.md) | Slixta engineering | Endpoints and webhook we need: contacts, stages, appointments, activities, flags, tasks, segments, WhatsApp inbox |
| [03-calendar-integration.md](03-calendar-integration.md) | Our calendar team | Replacing Cal.com: availability, 15-min holds, bookings, reception moves, webhooks |
| [04-deployment-vercel-aws.md](04-deployment-vercel-aws.md) | Our team / DevOps | Vercel demo, then AWS Mumbai: CloudFront, ECS Fargate, RDS, SQS, EventBridge, Secrets Manager, CloudWatch |
| [05-channel-integrations.md](05-channel-integrations.md) | Our team | Razorpay, WhatsApp + AI bot tools API, ManyChat, Bolna, Meta Pixel / CAPI, WhatsApp templates |
| [06-iam-partner-booking.md](06-iam-partner-booking.md) | Our team / ops | I AM Partner Booking API: how the funnel uses it, refund rule, keys, open questions for I AM, go-live |

**Sources:**

- `SSW_Ahmedabad_NadiPariksha_MASTER.html`: landing page and booking mock-up v1
- Figma board *Sri Sri Wellness — Paid Appointment Funnel v5 (Landing Page, WhatsApp, Instagram DM)*: all 14 sections reviewed on 13 Nov 2026
