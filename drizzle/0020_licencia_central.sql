CREATE TABLE "central_license" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"key_cipher" text NOT NULL,
	"key_iv" text NOT NULL,
	"key_tag" text NOT NULL,
	"key_last4" text NOT NULL,
	"last_attempt_at" timestamp,
	"last_result" text,
	"last_ok_at" timestamp,
	"plan_code" text,
	"plan_name" text,
	"customer_status" text,
	"next_heartbeat_seconds" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "central_license_last_result_check" CHECK ("central_license"."last_result" is null or "central_license"."last_result" in ('ok', 'llave_invalida', 'limite', 'rechazado', 'sin_respuesta')),
	CONSTRAINT "central_license_customer_status_check" CHECK ("central_license"."customer_status" is null or "central_license"."customer_status" in ('active', 'suspended'))
);
--> statement-breakpoint
ALTER TABLE "central_license" ADD CONSTRAINT "central_license_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "central_license_org_uq" ON "central_license" USING btree ("organization_id");