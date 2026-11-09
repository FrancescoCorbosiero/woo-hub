ALTER TABLE "vetrina_operations" ADD COLUMN "actor" text;--> statement-breakpoint
ALTER TABLE "vetrina_operations" ADD COLUMN "undone_by" text;--> statement-breakpoint
ALTER TABLE "vetrina_proposals" ADD COLUMN "actor" text;--> statement-breakpoint
ALTER TABLE "vetrina_proposals" ADD COLUMN "confirmed_by" text;