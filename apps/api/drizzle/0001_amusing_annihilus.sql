CREATE TYPE "public"."artist_role" AS ENUM('main', 'featured', 'remixer', 'composer', 'lyricist', 'producer');--> statement-breakpoint
CREATE TYPE "public"."audio_codec" AS ENUM('mp3', 'aac', 'opus', 'vorbis', 'flac', 'alac', 'pcm');--> statement-breakpoint
CREATE TYPE "public"."quality_tier" AS ENUM('lossy', 'lossless', 'hires');--> statement-breakpoint
CREATE TYPE "public"."release_type" AS ENUM('album', 'single', 'ep', 'compilation', 'live');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('fma', 'jamendo', 'label', 'artist_upload', 'user_upload', 'synthetic');--> statement-breakpoint
CREATE TYPE "public"."track_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "artists" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artists_source_external_unique" UNIQUE("source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "release_artists" (
	"release_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"role" "artist_role" DEFAULT 'main' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "release_artists_release_id_artist_id_role_pk" PRIMARY KEY("release_id","artist_id","role")
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" text NOT NULL,
	"type" "release_type" DEFAULT 'album' NOT NULL,
	"release_date" date,
	"url" text,
	"cover_key" text,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "releases_source_external_unique" UNIQUE("source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" "source_kind" NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_kind_name_unique" UNIQUE("kind","name")
);
--> statement-breakpoint
CREATE TABLE "track_artists" (
	"track_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"role" "artist_role" DEFAULT 'main' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "track_artists_track_id_artist_id_role_pk" PRIMARY KEY("track_id","artist_id","role")
);
--> statement-breakpoint
CREATE TABLE "track_assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"track_id" uuid NOT NULL,
	"codec" "audio_codec" NOT NULL,
	"container" text NOT NULL,
	"bitrate_kbps" integer,
	"sample_rate_hz" integer NOT NULL,
	"bit_depth" integer,
	"channels" integer NOT NULL,
	"quality" "quality_tier" NOT NULL,
	"s3_key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_assets_s3_key_unique" UNIQUE("s3_key"),
	CONSTRAINT "track_assets_track_format_unique" UNIQUE NULLS NOT DISTINCT("track_id","codec","bitrate_kbps")
);
--> statement-breakpoint
CREATE TABLE "track_loudness" (
	"track_id" uuid PRIMARY KEY NOT NULL,
	"integrated_lufs" real NOT NULL,
	"true_peak_dbtp" real NOT NULL,
	"loudness_range_lu" real,
	"replay_gain_db" real NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "track_rights" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"track_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"license" text NOT NULL,
	"license_url" text,
	"attribution" text NOT NULL,
	"source_url" text,
	"territories" text[],
	"allow_stream" boolean DEFAULT true NOT NULL,
	"allow_offline" boolean DEFAULT false NOT NULL,
	"allow_preview" boolean DEFAULT true NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_rights_valid_range" CHECK ("track_rights"."valid_to" IS NULL OR "track_rights"."valid_from" IS NULL OR "track_rights"."valid_to" > "track_rights"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"release_id" uuid NOT NULL,
	"title" text NOT NULL,
	"disc_number" integer DEFAULT 1 NOT NULL,
	"track_number" integer,
	"duration_ms" integer,
	"explicit" boolean DEFAULT false NOT NULL,
	"instrumental" boolean,
	"isrc" text,
	"status" "track_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"master_key" text,
	"source_codec" "audio_codec",
	"source_sample_rate_hz" integer,
	"source_bit_depth" integer,
	"source_bitrate_kbps" integer,
	"source_channels" integer,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracks_source_external_unique" UNIQUE("source_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "artists" ADD CONSTRAINT "artists_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_artists" ADD CONSTRAINT "release_artists_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_artists" ADD CONSTRAINT "release_artists_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_artists" ADD CONSTRAINT "track_artists_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_artists" ADD CONSTRAINT "track_artists_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_assets" ADD CONSTRAINT "track_assets_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_loudness" ADD CONSTRAINT "track_loudness_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_rights" ADD CONSTRAINT "track_rights_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_rights" ADD CONSTRAINT "track_rights_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_artists_artist_id_idx" ON "release_artists" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "track_artists_artist_id_idx" ON "track_artists" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "track_rights_track_id_idx" ON "track_rights" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "tracks_release_id_idx" ON "tracks" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "tracks_status_idx" ON "tracks" USING btree ("status");