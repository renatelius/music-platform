CREATE TYPE "public"."right_status" AS ENUM('active', 'suspended', 'revoked');--> statement-breakpoint
ALTER TABLE "track_rights" ADD COLUMN "status" "right_status" DEFAULT 'active' NOT NULL;