CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"birth_year" integer NOT NULL,
	"experience_level" text NOT NULL,
	"primary_goal" text NOT NULL,
	"available_equipment" text[] DEFAULT '{}'::text[] NOT NULL,
	"physical_considerations" text[] DEFAULT '{}'::text[] NOT NULL,
	"preferred_days_per_week" integer NOT NULL,
	"preferred_session_minutes" integer NOT NULL,
	"height_cm" integer,
	"weight_kg" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_birth_year_check" CHECK ("profiles"."birth_year" >= 1900),
	CONSTRAINT "profiles_experience_level_check" CHECK ("profiles"."experience_level" IN ('beginner','intermediate','advanced')),
	CONSTRAINT "profiles_primary_goal_check" CHECK ("profiles"."primary_goal" IN ('strength','hypertrophy','endurance','mobility','general-fitness','weight-loss','strength-and-mobility')),
	CONSTRAINT "profiles_available_equipment_check" CHECK ("profiles"."available_equipment" <@ ARRAY['bodyweight','dumbbell','barbell','resistance-band','kettlebell','bench','machine','pull-up-bar']::text[]),
	CONSTRAINT "profiles_available_equipment_unique_check" CHECK (NOT fit40_text_array_has_duplicates("profiles"."available_equipment")),
	CONSTRAINT "profiles_available_equipment_non_empty_check" CHECK (cardinality("profiles"."available_equipment") > 0),
	CONSTRAINT "profiles_physical_considerations_check" CHECK ("profiles"."physical_considerations" <@ ARRAY['knee-sensitive','lower-back-sensitive','shoulder-sensitive','limited-mobility']::text[]),
	CONSTRAINT "profiles_physical_considerations_unique_check" CHECK (NOT fit40_text_array_has_duplicates("profiles"."physical_considerations")),
	CONSTRAINT "profiles_days_per_week_check" CHECK ("profiles"."preferred_days_per_week" >= 1 AND "profiles"."preferred_days_per_week" <= 7),
	CONSTRAINT "profiles_session_minutes_check" CHECK ("profiles"."preferred_session_minutes" >= 10 AND "profiles"."preferred_session_minutes" <= 240),
	CONSTRAINT "profiles_height_check" CHECK ("profiles"."height_cm" IS NULL OR ("profiles"."height_cm" >= 100 AND "profiles"."height_cm" <= 250)),
	CONSTRAINT "profiles_weight_check" CHECK ("profiles"."weight_kg" >= 30 AND "profiles"."weight_kg" <= 500),
	CONSTRAINT "profiles_updated_at_check" CHECK ("profiles"."updated_at" >= "profiles"."created_at")
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;