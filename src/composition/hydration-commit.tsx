import { type ReactNode, useLayoutEffect } from 'react';

import { markInitialHydrationCommitted } from './start-client-hydration';

export const HydrationCommit = ({
  document,
  isCurrent,
  children,
}: {
  document: Document;
  isCurrent: () => boolean;
  children: ReactNode;
}) => {
  useLayoutEffect(() => {
    if (isCurrent()) markInitialHydrationCommitted(document);
  }, [document, isCurrent]);
  return children;
};
