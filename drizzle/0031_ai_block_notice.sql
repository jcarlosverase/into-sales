-- 1027: el proveedor de IA frena los pedidos sin que la llave esté mal.
ALTER TABLE "ai_credentials" ADD COLUMN "blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_credentials" ADD COLUMN "blocked_reason" text;