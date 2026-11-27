import { describe, expect, it } from 'vitest'
import { DESKTOP_HOST_KEY, readDesktopHost } from './desktop'

const scope = (value: unknown) => ({ [DESKTOP_HOST_KEY]: value })

describe('readDesktopHost', () => {
  it('is undefined in a browser, where nothing wrote the global', () => {
    expect(readDesktopHost({})).toBeUndefined()
  })

  it('reads both shapes the app writes', () => {
    expect(readDesktopHost(scope({ bridge: 'running' }))).toEqual({ bridge: 'running' })
    expect(readDesktopHost(scope({ bridge: { error: 'Port 34199 is already in use.' } }))).toEqual({
      bridge: { error: 'Port 34199 is already in use.' },
    })
  })

  it('ignores anything else', () => {
    for (const value of [{ bridge: 42 }, 'running', null, { bridge: 'stopped' }, { bridge: {} }]) {
      expect(readDesktopHost(scope(value)), JSON.stringify(value)).toBeUndefined()
    }
  })
})
