import { z } from 'zod';

// Run before browser schemas load. Even a caught Function() capability probe
// produces CSP violations in Firefox; the interpreter needs no unsafe-eval.
z.config({ jitless: true });
