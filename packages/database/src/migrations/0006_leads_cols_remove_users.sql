DROP TABLE IF EXISTS "users";
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "id_deal" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "id_contato" text;
