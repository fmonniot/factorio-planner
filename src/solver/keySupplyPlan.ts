import type { FluidRange } from '../data/flowKey'
import { flowKey, isTemperatureTag, versatility } from '../data/flowKey'
import type { ClassifiedSystem, FluidKeySupply } from './build'
import type { KeySupplyPlan } from './blockResult'
import { itemKeys } from './flowKeys'
import { maxFit, type AllocKey } from './keyAllocation'

/** The keys a connection set offers of one fluid, as the allocator takes them: one per offered key, offers summed. */
export function allocKeysOf(fluid: string, ks: FluidKeySupply): AllocKey[] {
  const byKey = new Map<string, AllocKey>()
  for (const o of ks.offers) {
    const key = flowKey(fluid, o.tag)
    const k = byKey.get(key) ?? { key, tag: o.tag, offer: 0, versatility: versatility(o.tag, ks.ranges) }
    k.offer += o.offer
    byKey.set(key, k)
  }
  return [...byKey.values()]
}

/** What `pass2Plan` and the connection order read of the fluids with supplied keys; undefined when the system has none. */
export function keySupplyPlanOf(system: Pick<ClassifiedSystem, 'flow' | 'classification'>): KeySupplyPlan | undefined {
  const flow = system.flow
  if (!flow || flow.supply.size === 0) return undefined
  const fluids: KeySupplyPlan['fluids'] = new Map()
  for (const fluid of new Set([...flow.supply.values()].map(s => s.fluid))) {
    const ks = flow.keySupply.get(fluid)!
    const keys = [...flow.supply].filter(([, s]) => s.fluid === fluid).map(([k]) => k)
    const rangeKeys = itemKeys(system, fluid).filter(k => {
      const info = flow.info.get(k)!
      return !info.supplied && !isTemperatureTag(info.tag) && !system.classification.goals.has(k)
    })
    const alloc = allocKeysOf(fluid, ks)
    fluids.set(fluid, {
      keys,
      rangeKeys,
      offers: ks.offers.reduce((a, o) => a + o.offer, 0),
      fit: residual => maxFit(alloc, [...residual].map(([k, rate]) => ({ range: flow.info.get(k)!.tag as FluidRange, rate }))),
    })
  }
  return { fluids }
}
