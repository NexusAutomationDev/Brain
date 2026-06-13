-- Fix: convert memories_user_key_idx from regular index to unique index
-- Required for onConflictDoUpdate in long-term.ts writeProfile()
DROP INDEX IF EXISTS "memories_user_key_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "memories_user_key_idx" ON "memories" USING btree ("user_id","key");
