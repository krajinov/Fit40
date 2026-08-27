ALTER TABLE "scheduled_workouts" DROP CONSTRAINT "scheduled_workouts_workout_id_workouts_id_fk";
--> statement-breakpoint
ALTER TABLE "scheduled_workouts" ADD CONSTRAINT "scheduled_workouts_workout_program_fk" FOREIGN KEY ("program_id","workout_id") REFERENCES "public"."workouts"("program_id","id") ON DELETE cascade ON UPDATE no action;