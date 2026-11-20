import { CreateScheduleCommand, SchedulerClient } from "@aws-sdk/client-scheduler";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { setJobTrigger } from "./queue";

/**
 * AWS driver (board section 14): SQS for anything due within 15 minutes,
 * EventBridge Scheduler one-time schedules (targeting the same queue) for later timers.
 * Message body: {"jobId": "..."}; the worker claims the job row by id.
 */
export function installAwsJobTrigger(): void {
  if (process.env.QUEUE_DRIVER !== "sqs") return;
  const queueUrl = required("SQS_QUEUE_URL");
  const queueArn = required("SQS_QUEUE_ARN");
  const roleArn = required("SCHEDULER_ROLE_ARN");
  const group = process.env.SCHEDULER_GROUP ?? "default";
  const region = process.env.AWS_REGION ?? "ap-south-1";
  const sqs = new SQSClient({ region });
  const scheduler = new SchedulerClient({ region });

  setJobTrigger(async ({ id, runAt }) => {
    const delayMs = runAt.getTime() - Date.now();
    if (delayMs <= 15 * 60 * 1000) {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({ jobId: id }),
          DelaySeconds: Math.max(0, Math.min(900, Math.ceil(delayMs / 1000))),
        }),
      );
      return;
    }
    await scheduler.send(
      new CreateScheduleCommand({
        Name: `job-${id}`.slice(0, 64),
        GroupName: group,
        ScheduleExpression: `at(${runAt.toISOString().slice(0, 19)})`,
        ScheduleExpressionTimezone: "UTC",
        FlexibleTimeWindow: { Mode: "OFF" },
        ActionAfterCompletion: "DELETE",
        Target: { Arn: queueArn, RoleArn: roleArn, Input: JSON.stringify({ jobId: id }) },
      }),
    );
  });
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required when QUEUE_DRIVER=sqs`);
  return v;
}
