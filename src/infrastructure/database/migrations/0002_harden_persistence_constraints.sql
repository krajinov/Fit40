ALTER TABLE "workout_exercises" DROP CONSTRAINT "chk_workout_exercises_reps_range";--> statement-breakpoint
ALTER TABLE "workout_sessions" DROP CONSTRAINT "chk_workout_sessions_started_at";--> statement-breakpoint
ALTER TABLE "set_logs" DROP CONSTRAINT "set_logs_session_id_workout_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "scheduled_workouts" ADD CONSTRAINT "scheduled_workouts_program_week_fk" FOREIGN KEY ("program_id","week_number") REFERENCES "public"."program_weeks"("program_id","week_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_exercise_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_logs" ADD CONSTRAINT "exercise_logs_exercise_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_exercise_log_fk" FOREIGN KEY ("session_id","exercise_order") REFERENCES "public"."exercise_logs"("session_id","exercise_order") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_workouts_workout_id_idx" ON "scheduled_workouts" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "workout_exercises_exercise_id_idx" ON "workout_exercises" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "workouts_program_id_idx" ON "workouts" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "exercise_logs_exercise_id_idx" ON "exercise_logs" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_workout_id_idx" ON "workout_sessions" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_started_at_idx" ON "workout_sessions" USING btree ("started_at");--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "chk_exercises_equipment" CHECK ("exercises"."equipment" IN ('bodyweight', 'dumbbell', 'barbell', 'resistance-band', 'kettlebell', 'bench', 'machine', 'pull-up-bar'));--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "chk_exercises_primary_muscle" CHECK ("exercises"."primary_muscle" IN ('chest', 'back', 'shoulders', 'quadriceps', 'hamstrings', 'glutes', 'calves', 'biceps', 'triceps', 'core', 'full-body'));--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "chk_workout_exercises_rest_seconds" CHECK ("workout_exercises"."rest_seconds" >= 0);--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "chk_workout_exercises_min_reps" CHECK ("workout_exercises"."min_reps" IS NULL OR "workout_exercises"."min_reps" > 0);--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "chk_workout_exercises_max_reps" CHECK ("workout_exercises"."max_reps" IS NULL OR "workout_exercises"."max_reps" > 0);--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "chk_workout_exercises_duration" CHECK ("workout_exercises"."duration_seconds" IS NULL OR "workout_exercises"."duration_seconds" > 0);--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "chk_workout_exercises_reps_range" CHECK ("workout_exercises"."min_reps" IS NULL OR "workout_exercises"."max_reps" IS NULL OR "workout_exercises"."max_reps" >= "workout_exercises"."min_reps");--> statement-breakpoint
ALTER TABLE "exercise_logs" ADD CONSTRAINT "chk_exercise_logs_rest_seconds" CHECK ("exercise_logs"."rest_seconds" >= 0);--> statement-breakpoint
ALTER TABLE "exercise_logs" ADD CONSTRAINT "chk_exercise_logs_min_reps" CHECK ("exercise_logs"."min_reps" IS NULL OR "exercise_logs"."min_reps" > 0);--> statement-breakpoint
ALTER TABLE "exercise_logs" ADD CONSTRAINT "chk_exercise_logs_max_reps" CHECK ("exercise_logs"."max_reps" IS NULL OR "exercise_logs"."max_reps" > 0);--> statement-breakpoint
ALTER TABLE "exercise_logs" ADD CONSTRAINT "chk_exercise_logs_reps_range" CHECK ("exercise_logs"."min_reps" IS NULL OR "exercise_logs"."max_reps" IS NULL OR "exercise_logs"."max_reps" >= "exercise_logs"."min_reps");--> statement-breakpoint
ALTER TABLE "exercise_logs" ADD CONSTRAINT "chk_exercise_logs_duration" CHECK ("exercise_logs"."duration_seconds" IS NULL OR "exercise_logs"."duration_seconds" > 0);--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "chk_set_logs_reps" CHECK ("set_logs"."reps" IS NULL OR "set_logs"."reps" > 0);--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "chk_set_logs_duration" CHECK ("set_logs"."duration_seconds" IS NULL OR "set_logs"."duration_seconds" > 0);--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "chk_set_logs_weight" CHECK ("set_logs"."weight_kg" IS NULL OR "set_logs"."weight_kg" >= 0);--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "chk_workout_sessions_completed_at" CHECK ("workout_sessions"."completed_at" IS NULL OR "workout_sessions"."completed_at" >= "workout_sessions"."started_at");