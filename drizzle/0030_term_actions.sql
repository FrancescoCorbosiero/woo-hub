CREATE TABLE "term_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"taxonomy" text NOT NULL,
	"parent" integer DEFAULT 0 NOT NULL,
	"name_key" text NOT NULL,
	"name" text NOT NULL,
	"term_id" integer NOT NULL,
	"operation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vetrina_operations" ADD COLUMN "term" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "term_aliases_key_idx" ON "term_aliases" USING btree ("taxonomy","parent","name_key");