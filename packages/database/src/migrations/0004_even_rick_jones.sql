CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unique_id" text NOT NULL,
	"nome" text,
	"numero" text NOT NULL,
	"ia_ativada" boolean DEFAULT true NOT NULL,
	"fullpp" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "memories_user_key_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "leads_numero_unique_idx" ON "leads" USING btree ("numero");--> statement-breakpoint
CREATE UNIQUE INDEX "memories_user_key_idx" ON "memories" USING btree ("user_id","key");