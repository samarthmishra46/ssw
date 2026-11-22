CREATE TABLE "iam_bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"appointment_ref" text NOT NULL,
	"landing_page_id" text NOT NULL,
	"key_fingerprint" text NOT NULL,
	"partner_booking_id" text NOT NULL,
	"expert_id" text NOT NULL,
	"expert_name" text,
	"mode" text NOT NULL,
	"centre_code" text,
	"slot_start_raw" text NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"duration_minutes" integer,
	"hold_id" text NOT NULL,
	"hold_expires_at" timestamp with time zone NOT NULL,
	"hold_status" text NOT NULL,
	"hold_email" text,
	"fee_paise" integer NOT NULL,
	"discount_paise" integer,
	"amount_paid_paise" integer,
	"payment_reference" text,
	"paid_at" timestamp with time zone,
	"confirm_request_body" text,
	"confirm_state" text DEFAULT 'pending' NOT NULL,
	"confirm_attempts" integer DEFAULT 0 NOT NULL,
	"confirm_error_code" text,
	"confirm_error_reason" text,
	"confirm_last_response" jsonb,
	"iam_booking_id" text,
	"session_booking_id" text,
	"account_state" text,
	"late_confirmation" boolean,
	"iam_status" text,
	"iam_status_checked_at" timestamp with time zone,
	"refund_state" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "resource_name" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "consult_mode" text DEFAULT 'offline' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "charge_paise" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "iam_bookings_hold_uq" ON "iam_bookings" USING btree ("hold_id");--> statement-breakpoint
CREATE UNIQUE INDEX "iam_bookings_partner_uq" ON "iam_bookings" USING btree ("partner_booking_id");--> statement-breakpoint
CREATE INDEX "iam_bookings_ref_idx" ON "iam_bookings" USING btree ("appointment_ref");--> statement-breakpoint
CREATE INDEX "iam_bookings_booking_idx" ON "iam_bookings" USING btree ("iam_booking_id");