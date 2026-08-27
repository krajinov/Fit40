CREATE TABLE "exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"primary_muscle" text NOT NULL,
	"secondary_muscles" text[] DEFAULT '{}' NOT NULL,
	"equipment" text NOT NULL,
	"difficulty" text NOT NULL,
	"movement_pattern" text NOT NULL,
	"considerations" jsonb DEFAULT '[]' NOT NULL,
	CONSTRAINT "exercises_slug_unique" UNIQUE("slug"),
	CONSTRAINT "chk_exercises_difficulty" CHECK ("exercises"."difficulty" IN ('beginner', 'intermediate', 'advanced')),
	CONSTRAINT "chk_exercises_movement_pattern" CHECK ("exercises"."movement_pattern" IN ('squat', 'hinge', 'push_horizontal', 'push_vertical', 'pull_horizontal', 'pull_vertical', 'carry', 'core'))
);
--> statement-breakpoint
CREATE TABLE "program_weeks" (
	"program_id" text NOT NULL,
	"week_number" integer NOT NULL,
	CONSTRAINT "program_weeks_pkey" PRIMARY KEY("program_id","week_number"),
	CONSTRAINT "chk_program_weeks_week_number" CHECK ("program_weeks"."week_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "scheduled_workouts" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"week_number" integer NOT NULL,
	"workout_id" text NOT NULL,
	"order_in_week" integer NOT NULL,
	CONSTRAINT "chk_scheduled_workouts_order" CHECK ("scheduled_workouts"."order_in_week" > 0),
	CONSTRAINT "chk_scheduled_workouts_week_number" CHECK ("scheduled_workouts"."week_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "training_programs" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"difficulty" text NOT NULL,
	"goal" text NOT NULL,
	"duration_weeks" integer NOT NULL,
	"workouts_per_week" integer NOT NULL,
	CONSTRAINT "training_programs_slug_unique" UNIQUE("slug"),
	CONSTRAINT "chk_training_programs_duration_weeks" CHECK ("training_programs"."duration_weeks" > 0),
	CONSTRAINT "chk_training_programs_workouts_per_week" CHECK ("training_programs"."workouts_per_week" > 0),
	CONSTRAINT "chk_training_programs_difficulty" CHECK ("training_programs"."difficulty" IN ('beginner', 'intermediate', 'advanced')),
	CONSTRAINT "chk_training_programs_goal" CHECK ("training_programs"."goal" IN ('strength', 'hypertrophy', 'endurance', 'mobility', 'general-fitness', 'weight-loss', 'strength-and-mobility'))
);
--> statement-breakpoint
CREATE TABLE "workout_exercises" (
	"workout_id" text NOT NULL,
	"exercise_order" integer NOT NULL,
	"exercise_id" text NOT NULL,
	"prescription_type" text NOT NULL,
	"sets" integer NOT NULL,
	"min_reps" integer,
	"max_reps" integer,
	"duration_seconds" integer,
	"rest_seconds" integer DEFAULT 0 NOT NULL,
	"notes" text,
	CONSTRAINT "workout_exercises_pkey" PRIMARY KEY("workout_id","exercise_order"),
	CONSTRAINT "chk_workout_exercises_sets" CHECK ("workout_exercises"."sets" > 0),
	CONSTRAINT "chk_workout_exercises_exercise_order" CHECK ("workout_exercises"."exercise_order" > 0),
	CONSTRAINT "chk_workout_exercises_prescription" CHECK (
        (
          "workout_exercises"."prescription_type" = 'reps'
          AND "workout_exercises"."min_reps" IS NOT NULL
          AND "workout_exercises"."max_reps" IS NOT NULL
          AND "workout_exercises"."duration_seconds" IS NULL
        )
        OR
        (
          "workout_exercises"."prescription_type" = 'duration'
          AND "workout_exercises"."duration_seconds" IS NOT NULL
          AND "workout_exercises"."min_reps" IS NULL
          AND "workout_exercises"."max_reps" IS NULL
        )
      ),
	CONSTRAINT "chk_workout_exercises_reps_range" CHECK ("workout_exercises"."max_reps" >= "workout_exercises"."min_reps")
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"estimated_duration_minutes" integer NOT NULL,
	CONSTRAINT "chk_workouts_estimated_duration" CHECK ("workouts"."estimated_duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "exercise_logs" (
	"session_id" text NOT NULL,
	"exercise_order" integer NOT NULL,
	"exercise_id" text NOT NULL,
	"prescription_type" text NOT NULL,
	"sets" integer NOT NULL,
	"min_reps" integer,
	"max_reps" integer,
	"duration_seconds" integer,
	"rest_seconds" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "exercise_logs_pkey" PRIMARY KEY("session_id","exercise_order"),
	CONSTRAINT "chk_exercise_logs_exercise_order" CHECK ("exercise_logs"."exercise_order" > 0),
	CONSTRAINT "chk_exercise_logs_sets" CHECK ("exercise_logs"."sets" > 0),
	CONSTRAINT "chk_exercise_logs_prescription" CHECK (
        (
          "exercise_logs"."prescription_type" = 'reps'
          AND "exercise_logs"."min_reps" IS NOT NULL
          AND "exercise_logs"."max_reps" IS NOT NULL
          AND "exercise_logs"."duration_seconds" IS NULL
        )
        OR
        (
          "exercise_logs"."prescription_type" = 'duration'
          AND "exercise_logs"."duration_seconds" IS NOT NULL
          AND "exercise_logs"."min_reps" IS NULL
          AND "exercise_logs"."max_reps" IS NULL
        )
      )
);
--> statement-breakpoint
CREATE TABLE "set_logs" (
	"session_id" text NOT NULL,
	"exercise_order" integer NOT NULL,
	"set_number" integer NOT NULL,
	"type" text NOT NULL,
	"reps" integer,
	"duration_seconds" integer,
	"weight_kg" numeric(6, 2),
	"rpe" integer,
	CONSTRAINT "set_logs_pkey" PRIMARY KEY("session_id","exercise_order","set_number"),
	CONSTRAINT "chk_set_logs_set_number" CHECK ("set_logs"."set_number" > 0),
	CONSTRAINT "chk_set_logs_type" CHECK (
        (
          "set_logs"."type" = 'reps'
          AND "set_logs"."reps" IS NOT NULL
          AND "set_logs"."duration_seconds" IS NULL
        )
        OR
        (
          "set_logs"."type" = 'duration'
          AND "set_logs"."duration_seconds" IS NOT NULL
          AND "set_logs"."reps" IS NULL
        )
      ),
	CONSTRAINT "chk_set_logs_rpe_range" CHECK ("set_logs"."rpe" IS NULL OR ("set_logs"."rpe" >= 1 AND "set_logs"."rpe" <= 10))
);
--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"scheduled_workout_id" text NOT NULL,
	"workout_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "workout_sessions_scheduled_workout_id_unique" UNIQUE("scheduled_workout_id"),
	CONSTRAINT "chk_workout_sessions_started_at" CHECK ("workout_sessions"."started_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "program_weeks" ADD CONSTRAINT "program_weeks_program_id_training_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."training_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_workouts" ADD CONSTRAINT "scheduled_workouts_program_id_training_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."training_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_workouts" ADD CONSTRAINT "scheduled_workouts_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_program_id_training_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."training_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_logs" ADD CONSTRAINT "exercise_logs_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_scheduled_workout_id_scheduled_workouts_id_fk" FOREIGN KEY ("scheduled_workout_id") REFERENCES "public"."scheduled_workouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_workouts_program_week_order_idx" ON "scheduled_workouts" USING btree ("program_id","week_number","order_in_week");