import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

type DivProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
};

export function Card({ className, children, ...props }: DivProps) {
  return (
    <div className={cn('card p-5', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: DivProps) {
  return (
    <div className={cn('mb-3 flex flex-col gap-1', className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: DivProps) {
  return (
    <div className={cn('text-base font-semibold text-ink', className)} {...props}>
      {children}
    </div>
  );
}

export function CardBody({ className, children, ...props }: DivProps) {
  return (
    <div className={cn('text-sm leading-relaxed text-ink-muted', className)} {...props}>
      {children}
    </div>
  );
}
