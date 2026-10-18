/** Presence only: no history metrics or previews cross this boundary. */
export type ExerciseHistoryPresenceDto =
  | { readonly status: 'present' }
  | { readonly status: 'absent' }
  | {
      readonly status: 'unavailable';
      /** Server-only diagnostic, logged by view assembly; never passed to UI. */
      readonly cause: unknown;
    };

/** Map only successful reads; failures must retain their unavailable state. */
export function toExerciseHistoryPresenceDto(hasOccurrence: boolean): ExerciseHistoryPresenceDto {
  return { status: hasOccurrence ? 'present' : 'absent' };
}
