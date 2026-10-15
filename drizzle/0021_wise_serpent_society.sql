CREATE TABLE "vetrina_operation_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"product_id" integer NOT NULL,
	"variation_id" integer,
	"field" text NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "vetrina_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"input" jsonb NOT NULL,
	"label" text NOT NULL,
	"term_key" text,
	"status" text DEFAULT 'running' NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"changed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"section" jsonb,
	"undo" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "vetrina_operation_items" ADD CONSTRAINT "vetrina_operation_items_operation_id_vetrina_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."vetrina_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vetrina_operation_items_operation_idx" ON "vetrina_operation_items" USING btree ("operation_id","product_id");--> statement-breakpoint
CREATE INDEX "vetrina_operations_created_idx" ON "vetrina_operations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "vetrina_operations_term_idx" ON "vetrina_operations" USING btree ("term_key","created_at");