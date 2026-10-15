ALTER TABLE "store_index" ADD COLUMN "image" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_index" ADD COLUMN "visibility" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_index" ADD COLUMN "menu_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_index" ADD COLUMN "total_sales" integer DEFAULT 0 NOT NULL;