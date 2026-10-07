CREATE TABLE "not_performed_workouts" (
	"enrollment_id" text NOT NULL,
	"scheduled_workout_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "not_performed_workouts_enrollment_id_scheduled_workout_id_pk" PRIMARY KEY("enrollment_id","scheduled_workout_id")
);
--> statement-breakpoint
ALTER TABLE "not_performed_workouts" ADD CONSTRAINT "not_performed_workouts_enrollment_id_program_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."program_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "not_performed_workouts" ADD CONSTRAINT "not_performed_workouts_scheduled_workout_id_scheduled_workouts_id_fk" FOREIGN KEY ("scheduled_workout_id") REFERENCES "public"."scheduled_workouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "not_performed_workouts_scheduled_workout_id_idx" ON "not_performed_workouts" USING btree ("scheduled_workout_id");