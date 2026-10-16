ALTER TABLE "lead" ADD COLUMN "follow_up_on" date;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "follow_up_note" text;--> statement-breakpoint
CREATE INDEX "lead_org_follow_up_idx" ON "lead" USING btree ("organization_id","follow_up_on");