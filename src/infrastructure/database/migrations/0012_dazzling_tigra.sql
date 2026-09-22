ALTER TABLE "exercise_logs" ADD COLUMN "source" text DEFAULT 'template' NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "next_occurrence_key" integer;--> statement-breakpoint
ALTER TABLE "exercise_logs" ADD CONSTRAINT "exercise_logs_source_check" CHECK ("exercise_logs"."source" IN ('template', 'user_added'));