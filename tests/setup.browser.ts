import { afterEach, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';

vi.mock('@/platform/env/client', () => ({
  envClient: {
    VITE_BASE_URL: 'http://localhost:3000',
    VITE_ENV_COLOR: 'gold',
    VITE_ENV_EMOJI: undefined,
    VITE_ENV_NAME: 'TEST',
    VITE_IS_DEMO: false,
    VITE_VISUAL_TEST: false,
  },
}));

afterEach(cleanup);
