CREATE TABLE "exercise_logs" (
	"session_id" text NOT NULL,
	"exercise_order" integer NOT NULL,
	"exercise_id" text NOT NULL,
	"prescription_type" text NOT NULL,
	"sets" integer NOT NULL,
	"min_reps" integer,
	"max_reps" integer,
	"duration_seconds" integer,
	"rest_seconds" integer NOT NULL,
	CONSTRAINT "exercise_logs_session_id_exercise_order_pk" PRIMARY KEY("session_id","exercise_order"),
	CONSTRAINT "exercise_logs_exercise_order_check" CHECK ("exercise_logs"."exercise_order" > 0),
	CONSTRAINT "exercise_logs_sets_check" CHECK ("exercise_logs"."sets" > 0),
	CONSTRAINT "exercise_logs_min_reps_check" CHECK ("exercise_logs"."min_reps" > 0),
	CONSTRAINT "exercise_logs_max_reps_check" CHECK ("exercise_logs"."max_reps" >= "exercise_logs"."min_reps"),
	CONSTRAINT "exercise_logs_duration_seconds_check" CHECK ("exercise_logs"."duration_seconds" > 0),
	CONSTRAINT "exercise_logs_rest_seconds_check" CHECK ("exercise_logs"."rest_seconds" >= 0),
	CONSTRAINT "exercise_logs_prescription_check" CHECK ((
        ("exercise_logs"."prescription_type" = 'reps' AND "exercise_logs"."min_reps" IS NOT NULL AND "exercise_logs"."max_reps" IS NOT NULL AND "exercise_logs"."duration_seconds" IS NULL)
        OR
        ("exercise_logs"."prescription_type" = 'duration' AND "exercise_logs"."duration_seconds" IS NOT NULL AND "exercise_logs"."min_reps" IS NULL AND "exercise_logs"."max_reps" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"primary_muscle" text NOT NULL,
	"secondary_muscles" text[] DEFAULT '{}'::text[] NOT NULL,
	"equipment" text NOT NULL,
	"difficulty" text NOT NULL,
	"movement_pattern" text NOT NULL,
	"considerations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "exercises_slug_unique" UNIQUE("slug"),
	CONSTRAINT "exercises_primary_muscle_check" CHECK ("exercises"."primary_muscle" IN ('chest','back','shoulders','quadriceps','hamstrings','glutes','calves','biceps','triceps','core','full-body')),
	CONSTRAINT "exercises_secondary_muscles_check" CHECK ("exercises"."secondary_muscles" <@ ARRAY['chest','back','shoulders','quadriceps','hamstrings','glutes','calves','biceps','triceps','core','full-body']::text[]),
	CONSTRAINT "exercises_equipment_check" CHECK ("exercises"."equipment" IN ('bodyweight','dumbbell','barbell','resistance-band','kettlebell','bench','machine','pull-up-bar')),
	CONSTRAINT "exercises_difficulty_check" CHECK ("exercises"."difficulty" IN ('beginner','intermediate','advanced')),
	CONSTRAINT "exercises_movement_pattern_check" CHECK ("exercises"."movement_pattern" IN ('squat','hinge','push-horizontal','push-vertical','pull-horizontal','pull-vertical','carry','core','isolation','locomotion')),
	CONSTRAINT "exercises_considerations_check" CHECK ((
        jsonb_typeof("exercises"."considerations") = 'array'
        AND (jsonb_array_length("exercises"."considerations") = 0
          OR (jsonb_path_exists("exercises"."considerations", 'strict $[*].consideration')
              AND jsonb_path_exists("exercises"."considerations", 'strict $[*].level')))
        AND NOT jsonb_path_exists(
          "exercises"."considerations",
          'strict $[*] ? ((@.consideration != "knee-sensitive" && @.consideration != "lower-back-sensitive" && @.consideration != "shoulder-sensitive" && @.consideration != "limited-mobility") || (@.level != "suitable" && @.level != "caution" && @.level != "unsuitable"))'
        )
      ))
);
--> statement-breakpoint
CREATE TABLE "program_weeks" (
	"program_id" text NOT NULL,
	"week_number" integer NOT NULL,
	CONSTRAINT "program_weeks_program_id_week_number_pk" PRIMARY KEY("program_id","week_number"),
	CONSTRAINT "program_weeks_week_number_check" CHECK ("program_weeks"."week_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "scheduled_workouts" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"week_number" integer NOT NULL,
	"workout_id" text NOT NULL,
	"order_in_week" integer NOT NULL,
	CONSTRAINT "scheduled_workouts_id_workout_id_unique" UNIQUE("id","workout_id"),
	CONSTRAINT "scheduled_workouts_order_in_week_check" CHECK ("scheduled_workouts"."order_in_week" > 0)
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
	CONSTRAINT "set_logs_session_id_exercise_order_set_number_pk" PRIMARY KEY("session_id","exercise_order","set_number"),
	CONSTRAINT "set_logs_set_number_check" CHECK ("set_logs"."set_number" > 0),
	CONSTRAINT "set_logs_reps_check" CHECK ("set_logs"."reps" > 0),
	CONSTRAINT "set_logs_duration_seconds_check" CHECK ("set_logs"."duration_seconds" > 0),
	CONSTRAINT "set_logs_weight_kg_check" CHECK ("set_logs"."weight_kg" >= 0),
	CONSTRAINT "set_logs_rpe_check" CHECK ("set_logs"."rpe" >= 1 AND "set_logs"."rpe" <= 10),
	CONSTRAINT "set_logs_type_check" CHECK ((
        ("set_logs"."type" = 'reps' AND "set_logs"."reps" IS NOT NULL AND "set_logs"."duration_seconds" IS NULL)
        OR
        ("set_logs"."type" = 'duration' AND "set_logs"."duration_seconds" IS NOT NULL AND "set_logs"."reps" IS NULL)
      ))
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
	CONSTRAINT "training_programs_duration_weeks_check" CHECK ("training_programs"."duration_weeks" > 0),
	CONSTRAINT "training_programs_workouts_per_week_check" CHECK ("training_programs"."workouts_per_week" > 0),
	CONSTRAINT "training_programs_difficulty_check" CHECK ("training_programs"."difficulty" IN ('beginner','intermediate','advanced')),
	CONSTRAINT "training_programs_goal_check" CHECK ("training_programs"."goal" IN ('strength','hypertrophy','endurance','mobility','general-fitness','weight-loss','strength-and-mobility'))
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
	"rest_seconds" integer NOT NULL,
	"notes" text,
	CONSTRAINT "workout_exercises_workout_id_exercise_order_pk" PRIMARY KEY("workout_id","exercise_order"),
	CONSTRAINT "workout_exercises_exercise_order_check" CHECK ("workout_exercises"."exercise_order" > 0),
	CONSTRAINT "workout_exercises_sets_check" CHECK ("workout_exercises"."sets" > 0),
	CONSTRAINT "workout_exercises_min_reps_check" CHECK ("workout_exercises"."min_reps" > 0),
	CONSTRAINT "workout_exercises_max_reps_check" CHECK ("workout_exercises"."max_reps" >= "workout_exercises"."min_reps"),
	CONSTRAINT "workout_exercises_duration_seconds_check" CHECK ("workout_exercises"."duration_seconds" > 0),
	CONSTRAINT "workout_exercises_rest_seconds_check" CHECK ("workout_exercises"."rest_seconds" >= 0),
	CONSTRAINT "workout_exercises_prescription_check" CHECK ((
        ("workout_exercises"."prescription_type" = 'reps' AND "workout_exercises"."min_reps" IS NOT NULL AND "workout_exercises"."max_reps" IS NOT NULL AND "workout_exercises"."duration_seconds" IS NULL)
        OR
        ("workout_exercises"."prescription_type" = 'duration' AND "workout_exercises"."duration_seconds" IS NOT NULL AND "workout_exercises"."min_reps" IS NULL AND "workout_exercises"."max_reps" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"scheduled_workout_id" text NOT NULL,
	"workout_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "workout_sessions_scheduled_workout_id_unique" UNIQUE("scheduled_workout_id")
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text NOT NULL,
	"estimated_duration_minutes" integer NOT NULL,
	CONSTRAINT "workouts_program_id_id_unique" UNIQUE("program_id","id")
);
--> statement-breakpoint
ALTER TABLE "exercise_logs" ADD CONSTRAINT "exercise_logs_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_logs" ADD CONSTRAINT "exercise_logs_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_weeks" ADD CONSTRAINT "program_weeks_program_id_training_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."training_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_workouts" ADD CONSTRAINT "scheduled_workouts_program_id_training_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."training_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_workouts" ADD CONSTRAINT "scheduled_workouts_week_fk" FOREIGN KEY ("program_id","week_number") REFERENCES "public"."program_weeks"("program_id","week_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_workouts" ADD CONSTRAINT "scheduled_workouts_program_workout_fk" FOREIGN KEY ("program_id","workout_id") REFERENCES "public"."workouts"("program_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_exercise_log_fk" FOREIGN KEY ("session_id","exercise_order") REFERENCES "public"."exercise_logs"("session_id","exercise_order") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_scheduled_workout_id_scheduled_workouts_id_fk" FOREIGN KEY ("scheduled_workout_id") REFERENCES "public"."scheduled_workouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_occurrence_template_fk" FOREIGN KEY ("scheduled_workout_id","workout_id") REFERENCES "public"."scheduled_workouts"("id","workout_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_program_id_training_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."training_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercise_logs_exercise_id_idx" ON "exercise_logs" USING btree ("exercise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_workouts_position_unique" ON "scheduled_workouts" USING btree ("program_id","week_number","order_in_week");--> statement-breakpoint
CREATE INDEX "scheduled_workouts_workout_id_idx" ON "scheduled_workouts" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "workout_exercises_exercise_id_idx" ON "workout_exercises" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_workout_id_idx" ON "workout_sessions" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "workouts_program_id_idx" ON "workouts" USING btree ("program_id");