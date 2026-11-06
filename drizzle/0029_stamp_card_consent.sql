-- 1023, D13: el consentimiento del cliente al guardar la tarjeta en su celular.
ALTER TABLE "stamp_card" ADD COLUMN "consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stamp_card" ADD COLUMN "consent_version" text;