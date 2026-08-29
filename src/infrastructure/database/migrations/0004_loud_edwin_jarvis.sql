CREATE TABLE "program_enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"program_id" text NOT NULL,
	"enrolled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "program_enrollments_user_program_unique" UNIQUE("user_id","program_id")
);
--> statement-breakpoint
-- One-time data cleanup (approved for this migration): all pre-existing
-- workout_sessions rows are development-only data created before user
-- ownership existed, have no attributable owner, and cannot satisfy the new
-- NOT NULL user_id column. Deleting them (cascading to exercise_logs and
-- set_logs) is required before the column can be added. No production data
-- exists to preserve.
DELETE FROM "workout_sessions";
--> statement-breakpoint
ALTER TABLE "workout_sessions" DROP CONSTRAINT "workout_sessions_scheduled_workout_id_unique";--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "enrollment_id" text;--> statement-breakpoint
ALTER TABLE "program_enrollments" ADD CONSTRAINT "program_enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_enrollments" ADD CONSTRAINT "program_enrollments_program_id_training_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."training_programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_enrollment_id_program_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."program_enrollments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workout_sessions_user_id_idx" ON "workout_sessions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_enrollment_occurrence_unique" UNIQUE("enrollment_id","scheduled_workout_id");