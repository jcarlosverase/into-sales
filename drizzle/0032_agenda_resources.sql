-- Spec 1029: profesionales o recursos con su propio horario. Se puede ejecutar dos veces.
CREATE TABLE IF NOT EXISTS "agenda_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text DEFAULT 'person' NOT NULL,
	"name" text NOT NULL,
	"weekly_hours" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN IF NOT EXISTS "resource_id" text;--> statement-breakpoint
ALTER TABLE "calendar_settings" ADD COLUMN IF NOT EXISTS "agent_resource_mode" text DEFAULT 'first_free' NOT NULL;--> statement-breakpoint
ALTER TABLE "offered_slot" ADD COLUMN IF NOT EXISTS "resource_id" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agenda_resource" ADD CONSTRAINT "agenda_resource_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "booking" ADD CONSTRAINT "booking_resource_id_agenda_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."agenda_resource"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "offered_slot" ADD CONSTRAINT "offered_slot_resource_id_agenda_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."agenda_resource"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agenda_resource_org_position_idx" ON "agenda_resource" USING btree ("organization_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agenda_resource_org_name_uq" ON "agenda_resource" USING btree ("organization_id",lower("name")) WHERE "agenda_resource"."active" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_org_resource_when_idx" ON "booking" USING btree ("organization_id","resource_id","scheduled_at");--> statement-breakpoint
-- El índice de hoy se recrea solo para lo que no tiene profesional.
DROP INDEX IF EXISTS "booking_org_active_slot_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booking_org_active_slot_uq" ON "booking" USING btree ("organization_id","scheduled_at") WHERE "booking"."status" in ('agendada','realizada') and "booking"."is_test" = false and "booking"."resource_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booking_resource_active_slot_uq" ON "booking" USING btree ("organization_id","resource_id","scheduled_at") WHERE "booking"."status" in ('agendada','realizada') and "booking"."is_test" = false and "booking"."resource_id" is not null;
