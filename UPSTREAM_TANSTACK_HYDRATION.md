# TanStack Start: bind hydration completion to its document

Draft upstream reproduction and fix proposal for `@tanstack/react-start-client`.
The published `1.168.34` React wrapper calls
`coreHydrateStart().finally(() => window.$_TSR?.h())`. It reads the private
bootstrap global after route imports finish. In WebKit, a hard reload can commit
a replacement document while an import from the previous document is pending.
When that old promise settles, the wrapper can call `h()` on the replacement
document's bootstrap state. It also calls `h()` when hydration rejects.

Minimal test: stub `coreHydrateStart()` with a pending promise, record the first
`window.document` and `window.$_TSR`, start React hydration, replace both with a
new document/bootstrap as a hard reload would, then resolve or reject the old
promise. Assert neither bootstrap is signaled and the replacement document can
hydrate independently. The app's
`tests/unit/composition/client-hydration.unit.spec.ts` and WebKit SSR test cover
the same ownership race.

Proposed immediate upstream fix: capture the document and bootstrap *before*
calling core hydration; signal the captured bootstrap only on successful
hydration and only while both captured values still belong to the current
document. Add the resolve, reject, and hard-reload cases to the React Start
client tests. A public document-bound completion hook would then let apps use
the supported API instead of accessing `window.$_TSR`; the local
`start-hydration-compat` shim can be removed when that hook ships.
