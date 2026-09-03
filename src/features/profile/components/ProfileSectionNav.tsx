import { cn } from '@/lib/utils';

/**
 * Desktop section index for the profile/onboarding forms (locked design):
 * numbered anchors into the five section cards. Hidden on mobile.
 */
export const PROFILE_SECTIONS = [
  { id: 'personal', number: '01', label: 'Personal details' },
  { id: 'training', number: '02', label: 'Training' },
  { id: 'body-metrics', number: '03', label: 'Body metrics' },
  { id: 'equipment', number: '04', label: 'Equipment' },
  { id: 'considerations', number: '05', label: 'Considerations' },
] as const;

export interface ProfileSectionNavProps {
  readonly className?: string;
}

export function ProfileSectionNav({ className }: ProfileSectionNavProps) {
  return (
    <nav aria-label="Profile sections" className={cn('flex flex-col gap-1', className)}>
      {PROFILE_SECTIONS.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className="flex items-center gap-3 rounded-[10px] px-4 py-3 outline-none transition-colors hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="text-[13px] font-semibold text-ink-3">{section.number}</span>
          <span className="text-[15px] font-medium text-ink-2">{section.label}</span>
        </a>
      ))}
    </nav>
  );
}
