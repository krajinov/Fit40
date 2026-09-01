import Link from 'next/link';
import { Calendar, Ruler, Dumbbell } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { EQUIPMENT_LABELS } from '@/features/exercises/exercise-labels';
import { calculateAge } from '@/features/dashboard/dashboard-labels';
import type { UserProfileDto } from '@/application/dto/user-profile';

interface ProfileSummaryCardProps {
  readonly profile: UserProfileDto;
  readonly now: Date;
  readonly className?: string;
}

/**
 * "Your profile" side card (locked design): eyebrow, Edit link, three
 * summary rows (born/age, height/weight, training days/minutes) and the
 * equipment chips. All values come straight from the profile DTO.
 */
export function ProfileSummaryCard({ profile, now, className }: ProfileSummaryCardProps) {
  const age = calculateAge(profile.birthYear, now);

  const measurements =
    profile.heightCm === null
      ? `${profile.weightKg} kg`
      : `${profile.heightCm} cm · ${profile.weightKg} kg`;

  return (
    <section
      aria-label="Your profile"
      className={cn('flex flex-col gap-5 rounded-card border border-border bg-card p-7', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-accent-foreground">YOUR PROFILE</p>
        <Link
          href="/profile"
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          Edit
        </Link>
      </div>

      <ul className="flex flex-col gap-3.5">
        <li className="flex items-center gap-2.5">
          <Calendar aria-hidden="true" className="size-[18px] text-ink-3" />
          <span className="text-[15px] text-ink-2">
            Born {profile.birthYear} · {age} {age === 1 ? 'year' : 'years'}
          </span>
        </li>
        <li className="flex items-center gap-2.5">
          <Ruler aria-hidden="true" className="size-[18px] text-ink-3" />
          <span className="text-[15px] text-ink-2">{measurements}</span>
        </li>
        <li className="flex items-center gap-2.5">
          <Dumbbell aria-hidden="true" className="size-[18px] text-ink-3" />
          <span className="text-[15px] text-ink-2">
            Trains {profile.preferredDaysPerWeek}{' '}
            {profile.preferredDaysPerWeek === 1 ? 'day' : 'days'} ·{' '}
            {profile.preferredSessionMinutes} minutes
          </span>
        </li>
      </ul>

      {profile.availableEquipment.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <p className="text-[13px] font-medium tracking-wide text-ink-3">EQUIPMENT</p>
          <div className="flex flex-wrap gap-2">
            {profile.availableEquipment.map((equipment) => (
              <span
                key={equipment}
                className="inline-flex h-7 items-center rounded-pill bg-surface-2 px-3 text-[13px] font-medium text-ink-2"
              >
                {EQUIPMENT_LABELS[equipment]}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
