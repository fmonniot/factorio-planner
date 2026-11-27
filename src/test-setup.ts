import '@testing-library/jest-dom/vitest'

// No unit test reaches a real network: a component that fetches (the data sets' info.json) gets a 404 unless the test
// stubs its own answer. Assigned, not stubbed, so `vi.unstubAllGlobals()` falls back to this and not to the real fetch.
globalThis.fetch = () => Promise.resolve(new Response('', { status: 404 }))
