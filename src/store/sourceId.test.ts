import { describe, it, expect } from 'vitest'
import { normalizeDatasetId } from './sourceId'

describe('normalizeDatasetId', () => {
  it('drops trailing slashes', () => {
    expect(normalizeDatasetId('kompetenz-seablock/')).toBe('kompetenz-seablock')
    expect(normalizeDatasetId('kompetenz-seablock//')).toBe('kompetenz-seablock')
  })

  it('leaves ids without a trailing slash unchanged', () => {
    expect(normalizeDatasetId('nullius')).toBe('nullius')
  })
})
