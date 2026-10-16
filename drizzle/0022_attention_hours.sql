ALTER TABLE "agent_profile" ADD COLUMN "reply_mode" text DEFAULT 'always' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "attention_hours" jsonb;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "attention_timezone" text;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD CONSTRAINT "agent_profile_reply_mode_check" CHECK ("agent_profile"."reply_mode" in ('always', 'outside_hours'));