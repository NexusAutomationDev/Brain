CREATE TABLE "knowledge_chunks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "collection" text NOT NULL,
    "content" text NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "embedding_model" text NOT NULL,
    "chunk_index" integer NOT NULL,
    "total_chunks" integer NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fup_config" (
    "brain_type" text PRIMARY KEY NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "intervals_seconds" integer[] NOT NULL,
    "min_hour" integer NOT NULL,
    "max_hour" integer NOT NULL,
    "allowed_days" text[] NOT NULL,
    "timezone" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "fup_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "fup_step" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "fup_next_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_message_at" timestamptz;
