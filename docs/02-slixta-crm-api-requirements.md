# Slixta CRM — API Requirements for the SSW Paid Appointment Funnel

_Prepared for: Slixta engineering · Last updated: 13 Nov 2026_

## Summary

Sri Sri Wellbeing is launching a paid consultation funnel (₹500 Nadi Pariksha, booked online). Leads arrive from a website booking form, WhatsApp (an AI bot) and Instagram DMs (ManyChat). Our backend on AWS runs all the funnel rules and keeps its own database (the **Ops DB**) as the source of truth. It pushes every change into Slixta, where the centre teams and telecallers work.

We need Slixta for:

- **Contacts**, one per phone number, with the right centre owner
- **Stages**, following a fixed ranking
- **Appointments** linked to contacts
- **Activities**: messages, call outcomes, recordings, payments
- **Flags**: opt-out, wrong number, active human conversation
- **Telecaller tasks**, with dispositions sent back to us
- **Segments and campaigns**: Nurture, WhatsApp marketing templates
- **WhatsApp**: the brand number is connected in Slixta; we send through Slixta and receive every inbound message from Slixta

The request is **16 endpoints we call and 1 webhook you send**, grouped below. Paths are suggestions; please keep the behaviour.

---

## How the funnel uses Slixta

| Funnel moment | Our calls | What your team sees |
| --- | --- | --- |
| A new phone number arrives (form, WhatsApp, Instagram, payment) | Find by phone → create or update contact → consent → activity | Contact at **Enquiry** with source and campaign |
| Slot held, payment started | Stage update, appointment created (status Payment Pending) | **Payment Pending** |
| Payment failed or 15 min passed | Stage update, activity | **Checkout Abandoned / Payment Failed** |
| Recovery ended with no action | Stage update, add to Nurture segment | **Closed (Not Converted)**, in Nurture |
| Payment verified | Appointment Paid, stage update, activity with payment ID | **Confirmed or Paid** |
| AI reminder call finished | Activity with outcome, summary, recording link; appointment Confirmed if confirmed | Call outcome on the timeline |
| Bot or call needs a human | Task for the centre telecaller | Task in the telecaller's queue |
| Telecaller finishes a task | — | You send us the disposition (webhook) |
| Telecaller starts a WhatsApp chat or call | — | You send us "human active" (webhook); we pause all automation |
| Centre staff mark Visited, No Show or Enrolled | — | You send us the change (webhook) |
| Customer taps Stop on a campaign | Flag update | Opt-out flag on the contact |

---

## Stages and ranking

Please set up this pipeline. Our backend applies the ranking (a contact never moves backwards on a new entry event), but Slixta needs the `rank` stored so your UI and reports sort correctly.

| Rank | Stage key | Label |
| --- | --- | --- |
| 8 | `enrolled` | Enrolled |
| 7 | `visited` | Visited |
| 6 | `confirmed_paid` | Confirmed or Paid |
| 5 | `payment_pending` | Payment Pending |
| 4 | `abandoned_failed` | Checkout Abandoned or Payment Failed |
| 3 | `cancelled_no_show` | Cancelled or No Show |
| 2 | `enquiry` | Enquiry |
| 1 | `closed` | Closed (Not Converted) |

## Contact fields

Standard: `phone` (E.164, unique), `name`, `email` (secondary only, never used to match or create), `owner_id`, `centre`, `stage`.

Custom: `concern`, `preferred_language`, `source` (`web_form`, `whatsapp`, `instagram_dm`, `ctwa_ad`, `campaign`, `referral`, `qr`, `gbp`), `first_source`, `campaign`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `gclid`, `ctwa_clid`, `last_touch_at`, `ops_contact_id` (our ID), `resume_url`.

Flags (booleans with a timestamp and reason): `opted_out`, `wrong_number`, `human_active`, `promotional_consent`.

---

## Endpoints we call

### Contacts

| # | Method and path | Purpose |
| --- | --- | --- |
| 1 | `GET /v1/contacts?phone=+91XXXXXXXXXX` | Find by phone. Returns the contact, stage, owner and flags, or an empty list |
| 2 | `POST /v1/contacts` | Create a contact (only when step 1 found no match), with `owner_id` set to the centre owner |
| 3 | `PATCH /v1/contacts/{id}` | Update fields, stage, owner, flags |
| 4 | `POST /v1/contacts/{id}/consents` | Record a consent: type, granted, wording text + version, source, time, IP |
| 5 | `POST /v1/contacts/{id}/activities` | Add a timeline entry (types below) |
| 6 | `GET /v1/contacts/duplicates?since=…` | Contacts sharing a phone or email, for our weekly hygiene report |

### Appointments

| # | Method and path | Purpose |
| --- | --- | --- |
| 7 | `POST /v1/appointments` | Create an appointment linked to a contact (one per booking attempt) |
| 8 | `PATCH /v1/appointments/{ref}` | Update status, slot, payment details |

Appointment statuses: `payment_pending`, `paid`, `confirmed`, `rescheduled`, `cancelled`, `no_show`, `visited`, `payment_issue`, `expired`.

### Tasks

| # | Method and path | Purpose |
| --- | --- | --- |
| 9 | `POST /v1/tasks` | Create a callback or chat task for a centre telecaller, with reason and full context |
| 10 | `PATCH /v1/tasks/{id}` | Close or update a task from our side (for example, the customer paid on their own) |

Task reasons: `bot_handoff`, `clinical_question`, `complaint`, `advisor_requested`, `unreachable_after_calls`, `receipt_not_delivered`, `no_show_followup`, `not_enrolled_followup`, `payment_issue`, `no_consent_followup`.

### Segments and campaigns

| # | Method and path | Purpose |
| --- | --- | --- |
| 11 | `POST /v1/segments/{segment_key}/members` | Add contacts to a segment (for example `nurture`) |
| 12 | `DELETE /v1/segments/{segment_key}/members/{contact_id}` | Remove (for example, when they book) |

### WhatsApp through Slixta

The brand's WhatsApp Business number is connected in Slixta. Our backend needs to send through it and to receive every inbound message (for the AI bot, consent and opt-out rules).

| # | Method and path | Purpose |
| --- | --- | --- |
| 13 | `POST /v1/whatsapp/templates/send` | Send an approved template (confirmation, recovery, reminders) with variables and button URLs. Returns a `message_id` |
| 14 | `POST /v1/whatsapp/messages` | Send a session message (text, reply buttons, list) inside the 24-hour customer window. Used for AI bot replies. Returns a `message_id` |

Both messages must appear in the contact's chat in Slixta, so telecallers see what the bot and automations sent.

Template send example (13):

```json
{
  "to": "+919876543210",
  "template": "booking_confirmed",
  "language": "en",
  "variables": { "name": "Asha", "date": "Fri 14 Nov", "time": "10:15 am", "centre": "Sri Sri Wellbeing Ahmedabad", "ref": "AHM-482913", "reception": "8511606276" },
  "buttons": [{ "type": "url", "index": 0, "param": "AHM-482913?t=<signed-token>" }],
  "client_ref": "msg-AHM-482913-confirmed"
}
```

`client_ref` is our idempotency key: a repeat with the same value must not send twice.

### Metadata and centres

| # | Method and path | Purpose |
| --- | --- | --- |
| 15 | `GET /v1/meta` | Stages, custom fields, segments, task types with IDs |
| 16 | `GET /v1/users?role=owner,telecaller` | Users with their centre, so we can route ownership and tasks |

---

## Payload examples

### Create contact (2)

```json
{
  "phone": "+919876543210",
  "name": "Asha Patel",
  "email": "asha@example.com",
  "owner_id": "u_ahm_owner",
  "centre": "ahmedabad",
  "stage": "enquiry",
  "fields": {
    "concern": "joints",
    "preferred_language": "Gujarati",
    "source": "web_form",
    "first_source": "web_form",
    "campaign": "ahm-joints-nov",
    "utm_source": "facebook",
    "utm_medium": "paid",
    "utm_campaign": "ahm-joints-nov",
    "utm_content": "stairs-video",
    "fbclid": "IwAR...",
    "ops_contact_id": "c_01JD...",
    "resume_url": "https://<our-domain>/ahmedabad/joints?t=<signed-token>",
    "last_touch_at": "2026-11-14T10:05:12+05:30"
  },
  "flags": { "promotional_consent": false }
}
```

Headers: `Authorization: Bearer <key>`, `Idempotency-Key: contact-create-c_01JD...`

Response `201`: `{ "id": "ct_7Hq2", "owner_id": "u_ahm_owner" }`. If the phone already exists, return `409` with the existing `id`, so a race never creates a second contact.

### Update contact (3)

```json
{
  "stage": "payment_pending",
  "fields": { "last_touch_at": "2026-11-14T10:07:40+05:30", "campaign": "ahm-joints-nov" },
  "owner_id": "u_ahm_owner",
  "notify_owner_ids": []
}
```

When we reassign to another centre we pass both owners in `notify_owner_ids`, so Slixta can notify them.

### Consent (4)

```json
{
  "type": "booking_contact",
  "granted": true,
  "text": "I agree to Sri Sri Wellbeing using these details to arrange my consultation, and to contact me about this booking on WhatsApp or by phone...",
  "text_version": "web-2026-11-v1",
  "source": "web_form",
  "captured_at": "2026-11-14T10:05:12+05:30",
  "ip": "203.0.113.24"
}
```

Types: `booking_contact`, `terms_no_refund`, `promotional`, `followup_offers`.

### Activity (5)

```json
{
  "type": "ai_call",
  "occurred_at": "2026-11-13T10:15:00+05:30",
  "appointment_ref": "AHM-482913",
  "summary": "Confirmed attendance. Asked about parking.",
  "data": { "outcome": "confirmed", "duration_s": 74, "recording_url": "https://...", "provider": "bolna" }
}
```

Activity types: `lead_created`, `touch` (new source or campaign), `consent`, `slot_held`, `payment_started`, `payment_failed`, `payment_captured`, `hold_expired`, `whatsapp_template_sent`, `whatsapp_delivered`, `whatsapp_failed`, `recovery_step`, `ai_call`, `bot_conversation_summary`, `booking_confirmed`, `rescheduled`, `cancelled`, `payment_issue_opened`, `payment_issue_resolved`, `settlement`.

### Appointment (7)

```json
{
  "ref": "AHM-482913",
  "contact_id": "ct_7Hq2",
  "centre": "ahmedabad",
  "service": "nadi-pariksha",
  "patient": { "name": "Ramesh Patel", "relation": "parent", "is_adult": true },
  "slot_start": "2026-11-14T10:15:00+05:30",
  "slot_end": "2026-11-14T10:45:00+05:30",
  "practitioner": "Dr. ...",
  "status": "payment_pending",
  "amount_inr": 500,
  "payment": { "provider": "razorpay", "order_id": "order_N8x..." },
  "channel": "web_form"
}
```

### Task (9)

```json
{
  "contact_id": "ct_7Hq2",
  "assignee_id": "u_ahm_telecaller",
  "type": "callback",
  "reason": "clinical_question",
  "due_at": "2026-11-14T11:00:00+05:30",
  "context": "WhatsApp bot hand-off. Customer asked if Nadi Pariksha is safe during pregnancy. Chat transcript is on the timeline.",
  "appointment_ref": null
}
```

Response `201`: `{ "id": "tk_19" }`.

---

## Webhook you send to us

`POST https://<our-domain>/api/webhooks/slixta`

```json
{
  "id": "evt_01H...",
  "type": "task.disposition",
  "occurred_at": "2026-11-14T11:20:00+05:30",
  "data": {
    "task_id": "tk_19",
    "contact_id": "ct_7Hq2",
    "disposition": "payment_issue",
    "note": "Charged twice per customer",
    "user_id": "u_ahm_telecaller"
  }
}
```

| Event type | When | What we do |
| --- | --- | --- |
| `task.disposition` | Telecaller saves a disposition: `confirmed`, `change_sent_to_reception`, `unreachable`, `clinical_escalation`, `payment_issue`, `not_ready` | Confirm appointment, open Payment Issue, add to Nurture, etc. |
| `conversation.human_started` | Telecaller starts a call or WhatsApp chat | Pause the AI bot and all automation for the contact |
| `conversation.human_ended` | Telecaller closes the conversation | Resume automation |
| `contact.stage_changed` | Staff set Visited, No Show, Enrolled (with programme + revenue for Enrolled) | Start the matching follow-up journey |
| `contact.flag_changed` | Opt-out or wrong number set in Slixta | Stop automation |
| `contact.owner_changed` | Owner reassigned manually | Update our record |
| `contact.merged` | Manual merge after the hygiene report | Repoint our records to the master contact |
| `whatsapp.message_received` | Any inbound WhatsApp message on the brand number, including button replies (Confirm, Stop, Book Now, Resume Payment) and Click-to-WhatsApp ad referral data (`ctwa_clid`, ad ID) | Run lead rules and flags, pass to the AI bot, handle Stop as opt-out |
| `whatsapp.message_status` | Sent, delivered, read or failed, for every message sent through endpoints 13 and 14 and by telecallers | Detect "receipt not delivered" (possible wrong number) and log delivery |

Inbound message example:

```json
{
  "id": "evt_01H...",
  "type": "whatsapp.message_received",
  "occurred_at": "2026-11-13T18:02:11+05:30",
  "data": {
    "message_id": "wamid.HBg...",
    "from": "+919876543210",
    "contact_id": "ct_7Hq2",
    "type": "button",
    "text": "Stop",
    "button_payload": "STOP",
    "referral": { "ctwa_clid": "ARAkL...", "source_id": "1202...", "source_type": "ad" },
    "handled_by_human": false
  }
}
```

`handled_by_human` is true when a telecaller has the conversation open; we then skip the bot.

Headers: `X-Slixta-Signature: sha256=<HMAC-SHA256 of "{timestamp}.{raw body}">`, `X-Slixta-Timestamp`. Retry with backoff on non-2xx for at least 24 hours. Each event has a unique `id` so we can ignore duplicates.

---

## Non-functional requirements

| Area | Requirement |
| --- | --- |
| Auth | Server-to-server API key (Bearer) or OAuth client credentials; separate sandbox and production keys |
| Sandbox | A test workspace we can reset, before integration starts |
| Idempotency | Honour `Idempotency-Key` on POST / PATCH for 24 h |
| Uniqueness | Phone is unique per workspace; a duplicate create returns `409` with the existing ID |
| Webhook security | HMAC-SHA256 signature + timestamp, shared secret |
| Rate limits | Documented per-minute limit; `429` with `Retry-After` |
| Errors | JSON `{ "code", "message" }`; `400`, `401`, `404`, `409`, `429` |
| Speed | Under 1 s at p95 for find / create / update contact |
| Formats | ISO 8601 with `+05:30`; phone in E.164 |
| Data location | Please confirm where data is stored (India region preferred) |

---

## Open questions for Slixta

- [ ] Auth method, sandbox availability, rate limits
- [ ] Can you build the endpoints and webhook above, and in what order? Phase 1 needs 1–5, 7–9, 13, 15–16 and the webhook (`task.disposition`, `contact.stage_changed`, `contact.flag_changed`, `whatsapp.message_status`). Phase 2 adds 14 and `whatsapp.message_received`
- [ ] Which WhatsApp provider is behind Slixta's integration, and are template approvals managed in Slixta?
- [ ] Can inbound messages be forwarded to us in real time (under 2 s), so the AI bot can reply quickly?
- [ ] Campaign button replies (Book Now / Stop): are they included in `whatsapp.message_received`, and does Slixta set the opt-out flag itself on Stop?
- [ ] Do you support segments by API, and a per-contact limit on campaign messages?
- [ ] Can staff record programme and revenue when marking Enrolled, and is that included in the webhook?
