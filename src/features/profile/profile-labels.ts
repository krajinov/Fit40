/**
 * Presentation labels and curated option lists for profile/onboarding forms.
 *
 * Reuses the existing equipment and program-goal label maps; adds profile-
 * specific labels for experience level and physical considerations.
 */

import type { PhysicalConsideration } from '@/domain/types/exercise';
import type { ExperienceLevel } from '@/domain/types/profile';

export const EXPERIENCE_LEVEL_LABELS: Record<ExperienceLevel, string> = {
  beginner: 'New to training (under 1 year)',
  intermediate: 'Some experience (1–3 years)',
  advanced: 'Experienced (3+ years)',
};

export const PHYSICAL_CONSIDERATION_LABELS: Record<PhysicalConsideration, string> = {
  'knee-sensitive': 'Sensitive knees',
  'lower-back-sensitive': 'Sensitive lower back',
  'shoulder-sensitive': 'Sensitive shoulders',
  'limited-mobility': 'Limited mobility',
};

/**
 * Curated session-length choices. The authoritative range remains 10–240
 * minutes (enforced by the domain factory and the Zod boundary); these are
 * simply the options the form offers.
 */
export const SESSION_MINUTE_OPTIONS = [30, 45, 60, 90] as const;

export function formatSessionMinutes(minutes: number): string {
  return `${minutes} minutes`;
}

export function formatDaysPerWeek(days: number): string {
  return days === 1 ? '1 day per week' : `${days} days per week`;
}
