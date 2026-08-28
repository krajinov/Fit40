// Fit40 Database Schema
//
// Entry point for all Drizzle table definitions. `client.ts` imports this
// module as `* as schema` so that every table is registered with the Drizzle
// instance.

export { exercises } from './exercises';
export {
  programWeeks,
  scheduledWorkouts,
  trainingPrograms,
  workoutExercises,
  workouts,
} from './programs';
export { profiles } from './profiles';
export { exerciseLogs, setLogs, workoutSessions } from './sessions';
export { authSessions, users } from './users';
