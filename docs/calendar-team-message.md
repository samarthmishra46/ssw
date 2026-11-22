**Subject: Sri Sri Wellbeing booking website: calendar API we need**

Hi team,

We're building the Sri Sri Wellbeing paid consultation booking website (₹500 Nadi Pariksha, paid online). Our calendar app replaces Cal.com, so the website and, later, the WhatsApp bot will get slots and make bookings through the calendar's API.

The full spec, with example requests and responses, is attached: **03-calendar-integration.md**. Below is the summary.

**If the calendar already has an API**, please send us its documentation. We'll adapt to it and only ask for what's missing.

## What the website does with the calendar

1. Shows **live slots** for the next 7 days (starting tomorrow) for a centre.
2. When the visitor picks a time, **holds that slot for 15 minutes** while they pay.
3. If payment succeeds, **confirms the booking**. If not, the hold **expires on its own** and the slot is free again.
4. When reception moves, cancels or adds a booking, the calendar **tells us**, so the CRM and WhatsApp reminders stay correct.

## Endpoints we need

| # | Endpoint | Purpose |
| --- | --- | --- |
| 1 | `GET /v1/centres/{centre}/availability?service=&from=&to=&language=` | Bookable slots per day, after working hours, busy times, buffers, daily limits, holds and bookings. Each slot has an ID, start and end time |
| 2 | `POST /v1/holds` | Hold a slot for 15 minutes. Returns a reservation ID and expiry time. Returns `409` if the slot was just taken |
| 3 | `DELETE /v1/holds/{reservationId}` | Release a hold (visitor changes the time) |
| 4 | `POST /v1/holds/{reservationId}/extend` | Extend a hold once by up to 5 minutes (payment screen opened late) |
| 5 | `POST /v1/bookings` | Confirm the hold as a booking after payment. If the hold expired but the slot is still free, book it anyway; if the slot is gone, return `409` |
| 6 | `GET /v1/bookings/{ref}` | Get one booking |
| 7 | `GET /v1/bookings?centre=&date=` | All bookings for a centre and day (daily reconciliation) |
| 8 | `PATCH /v1/bookings/{ref}` | Move or cancel a booking |

The paths are suggestions; the behaviour is what matters.

## Webhook from the calendar to us

`POST https://<our-domain>/api/webhooks/calendar`

| Event | When |
| --- | --- |
| `hold.expired` | A hold ended without payment |
| `booking.created` | Reception added a walk-in or phone booking (please include the customer's phone number) |
| `booking.moved` | Reception moved a booking, to another time or another centre |
| `booking.cancelled` | Booking cancelled |
| `booking.attended` / `booking.no_show` | If the calendar records attendance |

Each event needs a unique ID, the booking reference, and a timestamp. Please sign it with HMAC-SHA256 using a shared secret, and retry if our server doesn't answer with 200.

## Must-haves

- **No double booking:** two people can never hold or book the same slot at the same time.
- **Holds expire on the server:** an unpaid hold frees the slot by itself after 15 minutes.
- **Safe retries:** the same `Idempotency-Key` header on a hold or booking returns the first result instead of creating a second one.
- **Times** in ISO 8601 with the `+05:30` offset.
- **Auth:** an API key per environment (staging and production).
- **Speed:** availability under 300 ms; holds under 500 ms.

## Questions

1. Does the calendar already sync with the doctors' Google Calendars (busy times in, bookings out)?
2. Do server-side holds with automatic expiry already exist, or is this new work?
3. Is capacity per doctor (one guest per slot) or per centre?
4. Can availability be filtered by the doctor's consultation language (Gujarati, Hindi, English)?
5. Can reception move bookings between centres?
6. Does the calendar record attended / no-show?
7. When can we get a staging URL and API key, and roughly when will endpoints 1–5 be ready? Those are needed first. 6–8 and the webhook can follow.

Our side is built and tested against a mock calendar, so we can start testing as soon as staging is available. Happy to get on a call.

Thanks,
[Your name]
[Company / phone]
