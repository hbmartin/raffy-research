import type { HTMLAttributes } from 'react';

import { cn } from '@/platform/lib/tailwind/utils';

import raffyMark from './raffy-mark.png';

export const Logo = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span
    {...props}
    className={cn(
      'flex w-fit min-w-0 items-center gap-2 whitespace-nowrap text-foreground group-data-[collapsible=icon]:gap-0',
      className
    )}
  >
    <img
      src={raffyMark}
      alt=""
      width={32}
      height={32}
      className="size-8 shrink-0 group-data-[collapsible=icon]:size-7"
    />
    <span className="text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden sm:text-base">
      Raffy Research
    </span>
  </span>
);
