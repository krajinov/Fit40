CREATE TABLE "planned_workouts" (
	"enrollment_id" text NOT NULL,
	"scheduled_workout_id" text NOT NULL,
	"planned_date" date NOT NULL,
	CONSTRAINT "planned_workouts_enrollment_id_scheduled_workout_id_pk" PRIMARY KEY("enrollment_id","scheduled_workout_id"),
	CONSTRAINT "planned_workouts_enrollment_date_unique" UNIQUE("enrollment_id","planned_date")
);
--> statement-breakpoint
ALTER TABLE "planned_workouts" ADD CONSTRAINT "planned_workouts_enrollment_id_program_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."program_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_workouts" ADD CONSTRAINT "planned_workouts_scheduled_workout_id_scheduled_workouts_id_fk" FOREIGN KEY ("scheduled_workout_id") REFERENCES "public"."scheduled_workouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planned_workouts_scheduled_workout_id_idx" ON "planned_workouts" USING btree ("scheduled_workout_id");