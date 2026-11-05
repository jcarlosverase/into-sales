-- Spec 1022: Ajustes → Plan como IntoCredit: nombre del cliente y producto del último latido, y el resultado otro_producto (403).
ALTER TABLE "central_license" DROP CONSTRAINT "central_license_last_result_check";--> statement-breakpoint
ALTER TABLE "central_license" ADD COLUMN "customer_name" text;--> statement-breakpoint
ALTER TABLE "central_license" ADD COLUMN "product" text;--> statement-breakpoint
ALTER TABLE "central_license" ADD CONSTRAINT "central_license_last_result_check" CHECK ("central_license"."last_result" is null or "central_license"."last_result" in ('ok', 'llave_invalida', 'limite', 'rechazado', 'sin_respuesta', 'otro_producto'));