export { FunnelError, bookingToken, readToken, refFromToken, siteUrl, allowMockPayments } from "./config";
export {
  submitDetails,
  getSlots,
  holdSlot,
  releaseSlot,
  createPaymentOrder,
  verifyCheckoutPayment,
  completeMockPayment,
  handlePaymentCaptured,
  handlePaymentFailed,
  onPaymentTimeout,
  getBookingStatus,
  type Screen,
  type RequestMeta,
} from "./booking";
export { handleRazorpayWebhook, handleCalendarWebhook, handleSlixtaWebhook } from "./webhooks";
export { ingestEntryEvent, setStage } from "./leads";
export { openPaymentIssue } from "./payment-issues";
export { tick, enqueue, cancelJobs, claimById, runClaimed, type JobType } from "./jobs/queue";
export { installAwsJobTrigger } from "./jobs/aws";
export { handlers } from "./handlers";
export { logEvent, alert } from "./events";

import { handlers } from "./handlers";
import { tick } from "./jobs/queue";

/** Run every due job once with the standard handlers. */
export function runDueJobs(opts?: { maxJobs?: number }) {
  return tick(handlers, opts);
}
