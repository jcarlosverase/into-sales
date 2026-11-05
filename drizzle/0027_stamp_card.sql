CREATE TABLE "apple_pass_registration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"card_id" text NOT NULL,
	"device_library_id" text NOT NULL,
	"push_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stamp_card" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"program_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"serial" text NOT NULL,
	"public_token_hash" text NOT NULL,
	"apple_auth_token_hash" text NOT NULL,
	"stamps" integer DEFAULT 0 NOT NULL,
	"stamps_required" integer NOT NULL,
	"rewards_redeemed" integer DEFAULT 0 NOT NULL,
	"last_stamp_at" timestamp with time zone,
	"pass_version" integer DEFAULT 1 NOT NULL,
	"google_object_saved" boolean DEFAULT false NOT NULL,
	"wallet_sync_pending" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stamp_card_stamps_check" CHECK ("stamp_card"."stamps" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stamp_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"card_id" text NOT NULL,
	"kind" text NOT NULL,
	"delta" integer NOT NULL,
	"stamps_after" integer NOT NULL,
	"source" text NOT NULL,
	"user_id" text,
	"forced" boolean DEFAULT false NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stamp_event_kind_check" CHECK ("stamp_event"."kind" in ('join', 'stamp', 'redeem', 'adjust')),
	CONSTRAINT "stamp_event_source_check" CHECK ("stamp_event"."source" in ('whatsapp', 'panel', 'qr'))
);
--> statement-breakpoint
CREATE TABLE "stamp_program" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"stamps_required" integer NOT NULL,
	"reward" text NOT NULL,
	"terms" text,
	"color" text NOT NULL,
	"min_hours_between_stamps" integer DEFAULT 0 NOT NULL,
	"join_phrase" text NOT NULL,
	"join_reply" text NOT NULL,
	"notify_on_complete" boolean DEFAULT false NOT NULL,
	"complete_template_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stamp_program_status_check" CHECK ("stamp_program"."status" in ('active', 'paused', 'archived')),
	CONSTRAINT "stamp_program_stamps_required_check" CHECK ("stamp_program"."stamps_required" between 2 and 30)
);
--> statement-breakpoint
ALTER TABLE "apple_pass_registration" ADD CONSTRAINT "apple_pass_registration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apple_pass_registration" ADD CONSTRAINT "apple_pass_registration_card_id_stamp_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."stamp_card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stamp_card" ADD CONSTRAINT "stamp_card_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stamp_card" ADD CONSTRAINT "stamp_card_program_id_stamp_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."stamp_program"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stamp_card" ADD CONSTRAINT "stamp_card_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stamp_event" ADD CONSTRAINT "stamp_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stamp_event" ADD CONSTRAINT "stamp_event_card_id_stamp_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."stamp_card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stamp_event" ADD CONSTRAINT "stamp_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stamp_program" ADD CONSTRAINT "stamp_program_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stamp_program" ADD CONSTRAINT "stamp_program_complete_template_id_template_id_fk" FOREIGN KEY ("complete_template_id") REFERENCES "public"."template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "apple_pass_registration_device_card_uq" ON "apple_pass_registration" USING btree ("device_library_id","card_id");--> statement-breakpoint
CREATE INDEX "apple_pass_registration_card_idx" ON "apple_pass_registration" USING btree ("card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stamp_card_program_contact_uq" ON "stamp_card" USING btree ("program_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stamp_card_serial_uq" ON "stamp_card" USING btree ("serial");--> statement-breakpoint
CREATE UNIQUE INDEX "stamp_card_public_token_uq" ON "stamp_card" USING btree ("public_token_hash");--> statement-breakpoint
CREATE INDEX "stamp_card_org_contact_idx" ON "stamp_card" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE INDEX "stamp_card_sync_pending_idx" ON "stamp_card" USING btree ("wallet_sync_pending") WHERE "stamp_card"."wallet_sync_pending" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "stamp_event_card_idempotency_uq" ON "stamp_event" USING btree ("card_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "stamp_event_org_created_idx" ON "stamp_event" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stamp_program_org_live_uq" ON "stamp_program" USING btree ("organization_id") WHERE "stamp_program"."status" <> 'archived';