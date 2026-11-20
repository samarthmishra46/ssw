import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { closeDb } from "@ssw/db";
import { claimById, handlers, installAwsJobTrigger, runClaimed, runDueJobs } from "@ssw/funnel";

/**
 * Worker (board section 14): runs queued jobs and timers.
 *  QUEUE_DRIVER=sqs      long-polls SQS (messages from the web app and EventBridge Scheduler),
 *                        plus a 60 s safety-net tick
 *  QUEUE_DRIVER=postgres runs the tick every 15 s
 */

let stopping = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tickLoop(intervalMs: number) {
  while (!stopping) {
    try {
      const { ran, failed } = await runDueJobs();
      if (ran) console.info(`tick: ran ${ran} job(s), ${failed} not done`);
    } catch (err) {
      console.error("tick failed", err);
    }
    await sleep(intervalMs);
  }
}

async function sqsLoop() {
  const queueUrl = process.env.SQS_QUEUE_URL;
  if (!queueUrl) throw new Error("SQS_QUEUE_URL is required when QUEUE_DRIVER=sqs");
  const sqs = new SQSClient({ region: process.env.AWS_REGION ?? "ap-south-1" });
  while (!stopping) {
    try {
      const res = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20 }));
      for (const msg of res.Messages ?? []) {
        try {
          const { jobId } = JSON.parse(msg.Body ?? "{}") as { jobId?: string };
          if (jobId) {
            const job = await claimById(jobId);
            if (job) await runClaimed(job, handlers);
          }
          await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle }));
        } catch (err) {
          // Leave the message; SQS redelivers it, and after maxReceiveCount it goes to the DLQ.
          console.error("message failed", msg.MessageId, err);
        }
      }
    } catch (err) {
      console.error("sqs receive failed", err);
      await sleep(5_000);
    }
  }
}

async function main() {
  installAwsJobTrigger();
  const driver = process.env.QUEUE_DRIVER ?? "postgres";
  console.info(`worker started (queue driver: ${driver})`);
  if (driver === "sqs") await Promise.all([sqsLoop(), tickLoop(60_000)]);
  else await tickLoop(Number(process.env.TICK_INTERVAL_MS ?? 15_000));
  await closeDb();
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.info(`${sig} received, finishing current work`);
    stopping = true;
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
