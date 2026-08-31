import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Responsive page container (locked design): centers the 1120px desktop
 * column with mobile-first gutters. Desktop screens use 40-48px top and 80px
 * bottom padding; defaults match the program/workout screens and can be
 * overridden per page via className.
 */
export interface PageContainerProps {
  readonly children: ReactNode;
  readonly className?: string;
}

export function PageContainer({ children, className }: PageContainerProps) {
  return (
    <div className={cn('mx-auto w-full max-w-[1120px] px-5 pt-5 pb-10 md:px-8 md:pt-10 md:pb-20', className)}>
      {children}
    </div>
  );
}
