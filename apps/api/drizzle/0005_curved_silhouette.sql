CREATE TYPE "public"."change_entity" AS ENUM('track_like', 'release_save', 'artist_follow', 'playlist', 'playlist_item', 'settings');--> statement-breakpoint
CREATE TYPE "public"."change_op" AS ENUM('upsert', 'delete');--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"user_id" uuid NOT NULL,
	"key" uuid NOT NULL,
	"route" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "library_artists" (
	"user_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"followed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_artists_user_id_artist_id_pk" PRIMARY KEY("user_id","artist_id")
);
--> statement-breakpoint
CREATE TABLE "library_releases" (
	"user_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_releases_user_id_release_id_pk" PRIMARY KEY("user_id","release_id")
);
--> statement-breakpoint
CREATE TABLE "library_tracks" (
	"user_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"liked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_tracks_user_id_track_id_pk" PRIMARY KEY("user_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "playlist_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"playlist_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"position" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playlist_items_playlist_position_unique" UNIQUE("playlist_id","position")
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "playlists_name_length" CHECK (char_length("playlists"."name") BETWEEN 1 AND 100),
	CONSTRAINT "playlists_description_length" CHECK ("playlists"."description" IS NULL OR char_length("playlists"."description") <= 300)
);
--> statement-breakpoint
CREATE TABLE "user_change_log" (
	"user_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"entity" "change_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	"op" "change_op" NOT NULL,
	"payload" jsonb,
	"mutation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_change_log_user_id_seq_pk" PRIMARY KEY("user_id","seq")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "change_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_artists" ADD CONSTRAINT "library_artists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_artists" ADD CONSTRAINT "library_artists_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_releases" ADD CONSTRAINT "library_releases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_releases" ADD CONSTRAINT "library_releases_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_tracks" ADD CONSTRAINT "library_tracks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_tracks" ADD CONSTRAINT "library_tracks_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_change_log" ADD CONSTRAINT "user_change_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "library_artists_user_followed_idx" ON "library_artists" USING btree ("user_id","followed_at");--> statement-breakpoint
CREATE INDEX "library_artists_artist_id_idx" ON "library_artists" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "library_releases_user_saved_idx" ON "library_releases" USING btree ("user_id","saved_at");--> statement-breakpoint
CREATE INDEX "library_releases_release_id_idx" ON "library_releases" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "library_tracks_user_liked_idx" ON "library_tracks" USING btree ("user_id","liked_at");--> statement-breakpoint
CREATE INDEX "library_tracks_track_id_idx" ON "library_tracks" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "playlist_items_track_id_idx" ON "playlist_items" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "playlists_owner_id_idx" ON "playlists" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "user_change_log_created_at_idx" ON "user_change_log" USING btree ("created_at");