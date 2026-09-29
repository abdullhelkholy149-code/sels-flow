import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

type ContainerProps = HTMLAttributes<HTMLDivElement> & {
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
};

const SIZES: Record<NonNullable<ContainerProps['size']>, string> = {
  sm: 'max-w-3xl',
  md: 'max-w-5xl',
  lg: 'max-w-7xl',
};

/** Horizontal page gutter that respects the document direction. */
export function Container({ size = 'md', className, children, ...props }: ContainerProps) {
  return (
    <div className={cn('mx-auto w-full px-4 sm:px-6', SIZES[size], className)} {...props}>
      {children}
    </div>
  );
}
