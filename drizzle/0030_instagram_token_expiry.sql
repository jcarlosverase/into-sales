-- 1025: cuándo vence el token de Instagram y cuándo se renovó.
ALTER TABLE "instagram_credentials" ADD COLUMN "token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instagram_credentials" ADD COLUMN "token_refreshed_at" timestamp with time zone;