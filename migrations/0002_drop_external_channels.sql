ALTER TABLE "notification_delivery_logs" ALTER COLUMN "channel" SET DATA TYPE text;--> statement-breakpoint
DELETE FROM "notification_delivery_logs" WHERE "channel" NOT IN ('in_app');--> statement-breakpoint
DROP TYPE "public"."notification_channel";--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'push');--> statement-breakpoint
ALTER TABLE "notification_delivery_logs" ALTER COLUMN "channel" SET DATA TYPE "public"."notification_channel" USING "channel"::"public"."notification_channel";--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP COLUMN "whatsapp";