CREATE TABLE "appointments" (
	"id" text PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"contact_id" text NOT NULL,
	"centre" text NOT NULL,
	"programme" text NOT NULL,
	"channel" text NOT NULL,
	"who" text NOT NULL,
	"booker_name" text NOT NULL,
	"patient_name" text NOT NULL,
	"patient_is_adult" boolean NOT NULL,
	"language" text NOT NULL,
	"status" text NOT NULL,
	"slot_id" text,
	"slot_start" timestamp with time zone,
	"slot_end" timestamp with time zone,
	"resource_id" text,
	"reservation_id" text,
	"hold_expires_at" timestamp with time zone,
	"hold_extended" boolean DEFAULT false NOT NULL,
	"calendar_booking_id" text,
	"slixta_id" text,
	"fee_inr" integer NOT NULL,
	"terms_accepted_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"recovery_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"type" text NOT NULL,
	"granted" boolean NOT NULL,
	"text" text NOT NULL,
	"text_version" text NOT NULL,
	"source" text NOT NULL,
	"page" text,
	"ip" text,
	"user_agent" text,
	"appointment_ref" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"email" text,
	"language" text,
	"concern" text,
	"centre" text NOT NULL,
	"stage" text NOT NULL,
	"owner_id" text,
	"slixta_id" text,
	"opted_out" boolean DEFAULT false NOT NULL,
	"wrong_number" boolean DEFAULT false NOT NULL,
	"human_active" boolean DEFAULT false NOT NULL,
	"automation_paused" boolean DEFAULT false NOT NULL,
	"promotional_consent" boolean DEFAULT false NOT NULL,
	"first_source" text NOT NULL,
	"last_source" text NOT NULL,
	"first_attribution" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_attribution" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_touch_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dev_calendar_reservations" (
	"reservation_id" text PRIMARY KEY NOT NULL,
	"slot_id" text NOT NULL,
	"centre" text NOT NULL,
	"ref" text NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"contact_id" text,
	"appointment_id" text,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"last_error" text,
	"dedupe_key" text,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text,
	"appointment_id" text,
	"direction" text NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"template" text,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"client_ref" text,
	"provider_message_id" text,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"appointment_id" text,
	"contact_id" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"appointment_id" text NOT NULL,
	"provider" text NOT NULL,
	"order_id" text,
	"payment_link_id" text,
	"payment_id" text,
	"amount_paise" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text NOT NULL,
	"method" text,
	"failure_reason" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_issues" ADD CONSTRAINT "payment_issues_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_issues" ADD CONSTRAINT "payment_issues_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_ref_uq" ON "appointments" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "appointments_contact_idx" ON "appointments" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "consents_contact_idx" ON "consents" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_phone_uq" ON "contacts" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "contacts_slixta_idx" ON "contacts" USING btree ("slixta_id");--> statement-breakpoint
CREATE INDEX "dev_cal_slot_idx" ON "dev_calendar_reservations" USING btree ("slot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dev_cal_booked_uq" ON "dev_calendar_reservations" USING btree ("slot_id") WHERE status = 'booked';--> statement-breakpoint
CREATE INDEX "events_contact_idx" ON "events" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_uq" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_client_ref_uq" ON "messages" USING btree ("client_ref");--> statement-breakpoint
CREATE INDEX "messages_provider_idx" ON "messages" USING btree ("provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_uq" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_appointment_idx" ON "payments" USING btree ("appointment_id");