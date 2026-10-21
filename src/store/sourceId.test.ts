import { describe, it, expect } from 'vitest'
import {
  normalizeDatasetId, legacyPlanStorageKey, planIndexKey, planKey, planKeyPrefix, isStorageKeyOf,
  isSameDataSet, customDisplayName,
} from './sourceId'

describe('normalizeDatasetId', () => {
  it('drops trailing slashes', () => {
    expect(normalizeDatasetId('kompetenz-seablock/')).toBe('kompetenz-seablock')
    expect(normalizeDatasetId('kompetenz-seablock//')).toBe('kompetenz-seablock')
  })

  it('leaves ids without a trailing slash unchanged', () => {
    expect(normalizeDatasetId('nullius')).toBe('nullius')
  })
})

describe('plan storage keys', () => {
  it('ignores trailing slashes in the source id', () => {
    expect(legacyPlanStorageKey('kompetenz-seablock/')).toBe(legacyPlanStorageKey('kompetenz-seablock'))
    expect(planIndexKey('kompetenz-seablock/')).toBe(planIndexKey('kompetenz-seablock'))
    expect(planKey('kompetenz-seablock/', 'p1')).toBe(planKey('kompetenz-seablock', 'p1'))
  })

  it('differs per source', () => {
    expect(legacyPlanStorageKey('nullius')).not.toBe(legacyPlanStorageKey('custom:a.json'))
  })

  it('puts a plan key under its data set prefix, which ends in a slash', () => {
    expect(planKeyPrefix('nullius').endsWith('/')).toBe(true)
    expect(planKey('nullius', 'p1').startsWith(planKeyPrefix('nullius'))).toBe(true)
  })
})

describe('isStorageKeyOf', () => {
  it('matches the legacy, index and plan keys of a data set, with :corrupt copies', () => {
    const id = 'custom:a.json#1'
    for (const key of [legacyPlanStorageKey(id), planIndexKey(id), planKey(id, 'p'), planKey(id, 'p') + ':corrupt', planIndexKey(id) + ':corrupt']) {
      expect(isStorageKeyOf(key, id), key).toBe(true)
    }
  })

  it('does not match an upload whose name only starts like it', () => {
    const id = 'custom:a.json#1'
    const other = 'custom:a.json#12'
    for (const key of [legacyPlanStorageKey(other), planIndexKey(other), planKey(other, 'p'), legacyPlanStorageKey(other) + ':corrupt']) {
      expect(isStorageKeyOf(key, id), key).toBe(false)
    }
  })
})

describe('isSameDataSet', () => {
  it.each([
    ['nullius', 'nullius', true],
    ['kompetenz-seablock/', 'kompetenz-seablock', true],
    ['kompetenz-seablock', 'nullius', false],
    ['custom:a.json#0000abcd', 'custom:b.json#0000abcd', true],
    ['custom:a.json#0000abcd', 'custom:a.json#1111ffff', false],
    ['custom:a.json', 'custom:b.json', false],
    ['nullius', 'custom:nullius#0000abcd', false],
  ])('%s vs %s is %s', (a, b, expected) => {
    expect(isSameDataSet(a, b)).toBe(expected)
  })
})

describe('customDisplayName', () => {
  it('drops the fingerprint of an upload id', () => {
    expect(customDisplayName('custom:my#file.json#0000abcd')).toBe('my#file.json')
  })

  it('is null for bundled ids', () => {
    expect(customDisplayName('nullius')).toBeNull()
  })
})
