# Channel Integrations — Razorpay, WhatsApp + AI Bot, ManyChat, Bolna, Meta

_Last updated: 13 Nov 2026 · Covers Figma board sections 2B, 2C, 4, 5, 6, 8, 12, 13_

Our backend is the only system that talks to each channel, so every message, payment and call is logged in the Ops DB and the rules (consent, flags, stage ranking) are always applied.

---

## 1. Razorpay

| Use | Razorpay feature | Tagging |
| --- | --- | --- |
| Landing page payment | **Orders** + Checkout (name and phone prefilled) | `notes: { lead_id, centre_id, appointment_ref }`, `receipt: appointment_ref` |
| WhatsApp bot payment | **Payment Links**, expiring with the 15-min hold | Same `notes`; `reference_id: appointment_ref` |
| Resume payment (recovery) | New Order or Payment Link after rechecking the slot | Same appointment, new order |

Check Razorpay's minimum `expire_by` for Payment Links. If it is above 15 minutes, keep the link's expiry at the minimum and enforce the 15-minute hold on our side: a payment after the hold is handled as "paid, slot may be gone".

### Webhooks we subscribe to

`order.paid`, `payment.captured`, `payment.failed`, `payment_link.paid`, `payment_link.expired`, `refund.processed`

### Verification (board section 4)

Every webhook must pass all four checks before anything changes:

1. `X-Razorpay-Signature` = HMAC-SHA256 of the raw body with the webhook secret
2. Amount = the centre's fee (₹500 = 50000 paise) and currency INR
3. Order ID / payment link ID matches the appointment we stored
4. `notes.lead_id` matches the appointment's contact

Any mismatch opens a **Payment Issue** instead of confirming. Webhooks are processed idempotently by Razorpay event ID.

### Reconciliation (board sections 11, 12)

- **Daily**: list yesterday's payments from the Razorpay API and match each to an appointment, a calendar booking and a Slixta appointment. Gaps open Payment Issues.
- **Weekly**: match the settlement log to Razorpay settlement reports for sign-off by accounts.
- **Technical reversals**: refund through the Razorpay API only after the operations owner approves it in the Payment Issue.

---

## 2. WhatsApp Business API + the client's AI bot (board 2B)

The brand's WhatsApp number is connected **inside Slixta** (decided 13 Nov 2026). Slixta forwards inbound messages to us as `whatsapp.message_received` webhooks, and we send through Slixta's template and session-message APIs (doc 02, endpoints 13 and 14).

### Our responsibilities

| Responsibility | Detail |
| --- | --- |
| Receive every inbound message | Slixta webhook `whatsapp.message_received` to `POST /api/webhooks/slixta` (signature verified) |
| Identify the contact | Normalise phone, duplicate check, capture `ctwa_clid` / ad referral for Click-to-WhatsApp ads |
| Enforce flags | Opt-out, wrong number, human active → no bot reply; log the touch, notify the owner |
| Enforce consent | No consent on record → reply only inside the open 24-hour chat window, no templates, no calls |
| Hand off to the bot | Forward message + context to the client's AI bot |
| Send all outbound messages | Bot replies, templates, reminders, through Slixta's send APIs; log each with delivery status from `whatsapp.message_status` |

### Messages we forward to the bot

`POST {AI_BOT_URL}/messages`

```json
{
  "conversation_id": "wa_+919876543210",
  "message": { "id": "wamid.HBg...", "type": "text", "text": "Do you have a slot tomorrow morning?", "received_at": "2026-11-13T18:02:11+05:30" },
  "contact": {
    "id": "c_01JD...",
    "name": "Asha Patel",
    "stage": "enquiry",
    "centre": "ahmedabad",
    "language": "Gujarati",
    "consents": { "booking_contact": true, "promotional": false },
    "open_appointment": null
  },
  "context": { "entry": "ctwa_ad", "campaign": "ahm-joints-nov", "prefilled_from": "landing:ahmedabad/joints" }
}
```

### Bot Tools API (we expose, the bot calls)

Base: `https://<our-domain>/api/bot/v1`, header `Authorization: Bearer <BOT_TOOLS_API_KEY>`.

| Tool | Method and path | Does |
| --- | --- | --- |
| Send reply | `POST /messages` | Sends the bot's reply through our WhatsApp sender (text, buttons, list) |
| Record consent | `POST /consents` | Stores consent text, time, source = WhatsApp |
| Get slots | `GET /slots?centre=ahmedabad&language=Gujarati&from=…` | Live slots from our calendar |
| Hold and pay | `POST /bookings` | Checks consent, holds the slot 15 min, sets Payment Pending, returns a Razorpay payment link. The bot must state the no-refund policy before calling it |
| Save enquiry | `POST /enquiries` | Saves as Enquiry in Slixta, adds to Nurture if follow-up consent was given |
| Hand off | `POST /handoffs` | Creates a telecaller task (clinical question, complaint, asks for a person); pauses the bot for this contact |
| Centre info | `GET /centres/{centre}` | Address, hours, map, fee, reception number, FAQs for answers |

Example: hold and pay

```json
{
  "conversation_id": "wa_+919876543210",
  "centre": "ahmedabad",
  "slot_id": "s_8f2b",
  "name": "Asha Patel",
  "concern": "joints",
  "no_refund_policy_stated": true
}
```

```json
{
  "appointment_ref": "AHM-482913",
  "slot": { "start": "2026-11-14T10:15:00+05:30", "end": "2026-11-14T10:45:00+05:30" },
  "payment_link": "https://rzp.io/i/abc123",
  "expires_at": "2026-11-13T18:20:00+05:30"
}
```

Errors: `403 consent_required`, `409 slot_unavailable`, `423 contact_paused` (human active / opted out).

### WhatsApp templates to get approved by Meta

| Template | Category | When | Buttons |
| --- | --- | --- | --- |
| `booking_confirmed` | Utility | After verified payment: receipt, date/time, address, map, checklist, no-refund note, reception number | Open map |
| `resume_payment` | Utility | Recovery, immediately | Resume Payment (personal link) |
| `consult_explainer` | Marketing | Recovery +2 h | Book now |
| `trust_faq` | Marketing | Recovery +24 h | Book now |
| `final_reminder` | Marketing | Recovery +48 h | Resume Payment, Talk to an Advisor |
| `reminder_24h` | Utility | 24 h before | Confirm, Call reception |
| `visit_day` | Utility | Morning of the visit: map and arrival instructions | Open map |
| `call_missed` | Utility | AI call not answered | Call reception |
| `no_show_kind` | Utility | After a no-show | Call reception |
| `not_enrolled_followup` | Marketing | After a visit without enrolment | Talk to an Advisor |
| Campaign templates | Marketing | Nurture campaigns from Slixta | Book Now, Stop |

Marketing templates go only to contacts with promotional consent and no flags. The category is set by Meta at approval time; recovery messages may be classed as marketing.

---

## 3. ManyChat — Instagram DM (board 2C)

ManyChat answers basic questions, then asks for phone and consent. With both, it calls us with an **External Request** action:

`POST https://<our-domain>/api/integrations/manychat/lead`, header `Authorization: Bearer <MANYCHAT_WEBHOOK_SECRET>`

```json
{
  "subscriber_id": "123456789",
  "instagram_username": "asha.p",
  "name": "Asha Patel",
  "phone": "9876543210",
  "consent": { "granted": true, "text": "Yes, you can contact me on WhatsApp and by phone", "captured_at": "2026-11-13T17:40:00+05:30" },
  "concern": "joints",
  "centre": "ahmedabad",
  "campaign": "ig-comment-joints"
}
```

We run the duplicate check, save the contact as **Enquiry, source Instagram DM**, and return the fields ManyChat maps into buttons:

```json
{
  "booking_link": "https://<our-domain>/ahmedabad/joints?t=<signed-token>",
  "whatsapp_link": "https://wa.me/91XXXXXXXXXX?text=Hi%2C%20I%27d%20like%20to%20book%20a%20Nadi%20Pariksha%20at%20Ahmedabad%20(ref%20IG-7Q2K)"
}
```

No phone or no consent: ManyChat keeps the conversation in Instagram and we create nothing (Meta retargeting only).

---

## 4. Bolna AI — reminder calls (board 8)

| Item | Detail |
| --- | --- |
| Agent | One Bolna agent per language, Sarvam voices; script confirms attendance and handles change / cancel / human-needed |
| Trigger | Our scheduler creates the outbound call through the Bolna API at the scheduled time, inside the centre's calling hours |
| Call 1 | 24 h before the slot; skipped if booked less than 24 h ahead |
| Call 2 | Day of visit at 8 am or 4 h before, whichever is later |
| Retry | No answer / busy → one retry after 30 min + `call_missed` WhatsApp |
| Data passed | Name, centre, date and time, practitioner, reception number, language |
| Result | Bolna webhook to `POST /api/webhooks/bolna` with status, extracted outcome, summary, transcript and recording URL |

Outcome mapping:

| Outcome | Action |
| --- | --- |
| `confirmed` | Appointment Confirmed |
| `no_answer` / `busy` | Retry once, then telecaller task |
| `change_or_cancel` | Reception number given, no-refund explained, flag to reception (task) |
| `human_needed` | Telecaller task |
| `wrong_number` / `opt_out` | Stop automation, set flag in Slixta |

Every outcome, summary and recording link is written to the contact in Slixta as an `ai_call` activity.

---

## 5. Meta Pixel + Conversions API

| Event | Browser (Pixel) | Server (CAPI) | Trigger |
| --- | --- | --- | --- |
| `PageView` | Yes | No | Landing page |
| `Lead` | Yes | Yes | Step 1 saved |
| `InitiateCheckout` | Yes | Yes | Razorpay opened |
| `Purchase` | No | Yes | Verified payment webhook (₹500) |

- Browser and server events share an `event_id` so Meta de-duplicates them.
- Server events send hashed phone, `fbc` / `fbp` cookies, client IP and user agent.
- Visitors who never submit step 1 are covered by Pixel audiences (board 2A "form not submitted").
- Click-to-WhatsApp leads are attributed with the `ctwa_clid` from the WhatsApp webhook.

---

## Open questions

- [x] WhatsApp number lives in Slixta; templates are sent through Slixta (template approval process to confirm with Slixta)
- [ ] AI bot: endpoint, auth, and whether it can call our tools API
- [ ] ManyChat plan with External Request, and who builds the flow
- [ ] Bolna account, one agent per language or one multilingual agent, calling hours per centre
- [ ] Razorpay: one account for all centres, or one per centre (affects settlement matching)
