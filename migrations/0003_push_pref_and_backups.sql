CREATE TYPE "public"."backup_kind" AS ENUM('database', 'files');--> statement-breakpoint
CREATE TABLE "backup_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "backup_kind" NOT NULL,
	"trigger" text NOT NULL,
	"requested_by" uuid,
	"storage_key" text,
	"tables" integer,
	"rows" integer,
	"files" integer,
	"size_bytes" integer,
	"status" text DEFAULT 'completed' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "push" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_logs" ADD CONSTRAINT "backup_logs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_logs_created_idx" ON "backup_logs" USING btree ("created_at");