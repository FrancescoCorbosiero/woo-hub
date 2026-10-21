CREATE TABLE "vetrina_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"input" jsonb NOT NULL,
	"via" text NOT NULL,
	"locale" text NOT NULL,
	"label" text NOT NULL,
	"label_params" jsonb NOT NULL,
	"preview" jsonb NOT NULL,
	"digest" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"error" text,
	"operation_id" uuid,
	"replaced_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "vetrina_proposals_created_idx" ON "vetrina_proposals" USING btree ("created_at");