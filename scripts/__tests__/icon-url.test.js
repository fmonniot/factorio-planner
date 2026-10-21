import { describe, it, expect, vi } from 'vitest'
import { iconPublicUrl } from '../icon-url.js'

describe('iconPublicUrl', () => {
  it('maps the icons dir to a public-relative URL', () => {
    expect(iconPublicUrl('/repo/public/data/nullius/icons', '/repo/public')).toBe('/data/nullius/icons')
  })

  it('maps the technology subdir', () => {
    expect(iconPublicUrl('/repo/public/data/nullius/icons/technology', '/repo/public')).toBe('/data/nullius/icons/technology')
  })

  it('never returns an absolute path for a dir outside public', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const out = iconPublicUrl('/elsewhere/icons', '/repo/public')
      expect(out.startsWith('/')).toBe(false)
      expect(out).not.toContain('/repo/public')
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
