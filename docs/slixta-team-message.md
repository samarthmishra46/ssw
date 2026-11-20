**Subject: Sri Sri Wellbeing funnel: Slixta integration details we need**

Hi Slixta team,

Thanks for sharing the Submit a Lead (`/submits`) and Add Interactions (`/extinteractions`) APIs. We're building the Sri Sri Wellbeing paid consultation funnel (₹500 Nadi Pariksha, booked and paid online), and we plan to send every lead and every funnel step into Slixta through these two endpoints.

To finish the integration, we need the following from you.

## 1. Access

- API key (`X-Api-Key`), `orgId` and `dataSourceId`
- A **test org** (or test data source) with its own key, so our testing doesn't create real leads
- The `agentEmail` we should use on interactions sent by our system
- One `dataSourceId` per centre, or one for everything? We start with Ahmedabad; more centres will follow.

## 2. Submit a Lead (`/submits`)

1. When the same phone number is submitted again, does Slixta **update the existing lead** or create a new one? We need exactly one lead per phone number.
2. Can the response include the **lead ID**? Today we only get 200 OK.
3. How is a lead assigned to the **right centre owner**? By `dataSourceId`, by `_pageLink`, or by a field we send (for example `_centre`)?
4. Does a later submit update the custom fields (latest campaign, concern, last touch)?

## 3. Interactions and workflows (`/extinteractions`)

Our system runs the timers (for example the 15-minute payment window and the recovery messages at 2, 24 and 48 hours) and sends an interaction at the right moment. We'd like a Slixta workflow on each interaction type to do the action listed below.

Please confirm that workflows can **change the stage, create a task for the centre telecaller, send an approved WhatsApp template using values from `extpayload`, and add or remove a lead from a segment**.

| iType | When we send it | Workflow action in Slixta |
| --- | --- | --- |
| `lead_created` | Visitor submits their details (also sent via `/submits`) | Stage → Enquiry |
| `slot_held` | Visitor picks a slot (held for 15 min) | Stage → Payment Pending |
| `payment_started` | Razorpay checkout opened | Log only |
| `payment_failed` | Razorpay reports a failure | Log only |
| `checkout_abandoned` | No payment within 15 minutes | Stage → Checkout Abandoned or Payment Failed; send WhatsApp **resume_payment** (Resume Payment button with `_resumeUrl`) |
| `recovery_explainer` | 2 hours later, still not paid | Send WhatsApp **consult_explainer** |
| `recovery_trust` | 24 hours later | Send WhatsApp **trust_faq** |
| `recovery_final` | 48 hours later | Send WhatsApp **final_reminder** (Resume Payment + Talk to an Advisor) |
| `recovery_closed` | No action after the final reminder | Stage → Closed (Not Converted); add to **Nurture** segment |
| `booking_confirmed` | Payment verified and slot booked | Stage → Confirmed or Paid; send WhatsApp **booking_confirmed** (receipt, date and time, address, map, no-refund note, reception number); notify centre team; remove from Nurture |
| `reminder_24h` | 24 hours before the visit | Send WhatsApp **reminder_24h** (Confirm button) |
| `visit_day` | Morning of the visit | Send WhatsApp **visit_day** (map, arrival instructions) |
| `booking_rescheduled` | Reception moves the booking | Update booking fields; notify owner |
| `booking_cancelled` | Booking cancelled | Stage → Cancelled or No Show |
| `no_show` | Guest did not come | Stage → Cancelled or No Show; send WhatsApp **no_show_kind**; telecaller task |
| `telecaller_task` | Bot hand-off, advisor requested, unreachable, receipt not delivered | Create task for the centre telecaller with `_taskReason` and `_taskContext` |
| `payment_issue` | Payment mismatch, paid but slot gone, charged twice | Create telecaller task; pause automation; alert operations owner |

We'll share the WhatsApp template texts for approval. Please tell us whether templates are submitted and approved through Slixta.

**Duplicates:** our system retries when a call fails. Every interaction carries a unique `_eventId`. Can Slixta ignore an interaction whose `_eventId` it has already received?

### Stages to set up (ranked high to low)

Enrolled · Visited · Confirmed or Paid · Payment Pending · Checkout Abandoned or Payment Failed · Cancelled or No Show · Enquiry · Closed (Not Converted)

### Custom fields we'll send (please create and map them)

| Field | Example |
| --- | --- |
| `_centre` | ahmedabad |
| `_concern` | joints / sleep / women |
| `_language` | Gujarati |
| `_who` | Myself / My parent / My daughter / Someone else |
| `_patientName` | Ramesh Patel |
| `_patientIsAdult` | true |
| `_bookingRef` | AHM-482913 |
| `_slotStart` | epoch ms |
| `_slotLabel` | Saturday, 14 November, 9:30 am |
| `_amountInr` | 500 |
| `_orderId`, `_paymentId` | Razorpay IDs |
| `_resumeUrl` | personal link to resume booking |
| `_bookingUrl` | link to the booking details page |
| `_source` | web_form / whatsapp / instagram_dm / reception |
| `_utm_source`, `_utm_medium`, `_utm_campaign`, `_utm_content`, `_utm_term` | from the ad link |
| `_fbclid`, `_gclid` | ad click IDs |
| `_consentText`, `_consentVersion`, `_consentAt` | proof of WhatsApp/call consent |
| `_promotionalConsent` | true / false |
| `_taskReason`, `_taskContext` | for telecaller tasks |
| `_eventId` | unique ID per interaction |

## 4. Updates from Slixta to us (webhook)

This is the main thing missing. We need Slixta to call our endpoint when something changes on the Slixta side:

`POST https://<our-domain>/api/webhooks/slixta` (JSON)

| Event | Why we need it |
| --- | --- |
| Telecaller saves a disposition (confirmed, change sent to reception, unreachable, clinical escalation, payment issue, not ready) | Update the booking, open a payment issue, or move to Nurture |
| Staff set stage Visited, No Show or Enrolled (with programme and revenue for Enrolled) | Start the right follow-up |
| Lead opts out, or replies **STOP** / taps Stop on WhatsApp | Stop all automated messages |
| Telecaller starts or ends a call/chat with the lead | Pause our automation while a human is talking |
| WhatsApp message failed or delivered | A failed booking confirmation means the number may be wrong, so we create a call task |
| Inbound WhatsApp messages and button replies (Confirm, Book Now) | Phase 2: our AI bot replies through Slixta |

Each event should include the lead's phone number (and Slixta lead ID), the event type, a unique event ID and a timestamp. For security, please sign the request (HMAC-SHA256 of the body with a shared secret) or send a shared secret header.

## 5. Other questions

1. Does Slixta have an **appointment** record linked to a lead, or should we keep booking details as fields and interactions on the lead?
2. Can we **look up a lead by phone** (stage, owner, opt-out flag) through an API?
3. If inbound WhatsApp messages can't be forwarded to us, how can our AI bot receive and reply to customers on the brand number, which is connected in Slixta? (Needed for phase 2.)
4. What are the **rate limits**, and what error responses should we expect besides 200?
5. Where is lead data stored (India region preferred)?

## Timeline

Our side is ready and waiting for the keys. If you can share the test org credentials and answers to sections 1–3 first, we can start testing right away. The webhook (section 4) is needed before go-live.

Happy to get on a call to go through this.

Thanks,
[Your name]
[Company / phone]
