import type { FluidTag } from '../data/types'
import { fitsRange, flowKey, rangeDepth, type FluidRange } from '../data/flowKey'
import { FLOW_TOLERANCE } from './blockResult'
import { runLP } from './solve'

// ---------------------------------------------------------------------------
// The served-list allocation of a split fluid (fluid temperatures, decision 6): the keys a source offers go to the
// ranges its listed consumers need, a key only to a range it fits. Groups are served in rank order; inside a group the
// grants are filled progressively (a common level t, member m taking up to weight_m · t), which is `waterFill`
// generalised to several keys. A last solve keeps every total and takes the least versatile keys.
// ---------------------------------------------------------------------------

/** A key the source offers: `offer` items/min at `tag`, `versatility` the number of ranges of the fluid it fits. */
export interface AllocKey { key: string; tag: FluidTag; offer: number; versatility: number }

/** A member of a group: what it needs per range, how much it can take in all, and its weight in the group. */
export interface AllocMember { id: string; needs: { range: FluidRange; rate: number }[]; cap?: number; weight: number }

export interface KeyAllocation {
  /** member → offered key → amount */
  grants: Map<string, Map<string, number>>
  /** member → the flow key of a range it needed (`flowKey(itemId, range)`) → amount of that need met */
  covered: Map<string, Map<string, number>>
  /** offered key → Σ grants */
  held: Map<string, number>
}

/**
 * The solver rounds each returned value to 1e-8 and a level is read back as a sum of its member's f columns: a lower bound read
 * back from it gets `LEVEL_ABS` of room per column (a Seablock steam fluid has up to 9 keys x 6 ranges), more on a retry.
 */
const LEVEL_REL = 1e-12
const LEVEL_ABS = 2e-8
/** Two levels closer than this are the same level. */
const LEVEL_TOL = 1e-6

interface Model {
  constraints: Record<string, { min?: number; max?: number; equal?: number }>
  variables: Record<string, Record<string, number>>
  /** the variables of a member: its `f` columns */
  cols: Map<string, string[]>
  /** every f column: member, key index, range index */
  all: { name: string; member: string; key: number; range: number }[]
}

/** The rows and columns shared by every LP of an allocation; each LP adds its own level rows and objective. */
function baseModel(keys: AllocKey[], members: AllocMember[]): Model {
  const constraints: Model['constraints'] = {}
  const variables: Model['variables'] = {}
  const cols = new Map<string, string[]>()
  const all: Model['all'] = []
  keys.forEach((k, i) => { constraints[`key${i}`] = { max: k.offer } })
  members.forEach((m, mi) => {
    const mine: string[] = []
    cols.set(m.id, mine)
    m.needs.forEach((n, ri) => { constraints[`need${mi}_${ri}`] = { max: n.rate } })
    if (m.cap !== undefined) constraints[`cap${mi}`] = { max: m.cap }
    m.needs.forEach((n, ri) => {
      keys.forEach((k, ki) => {
        if (!fitsRange(k.tag, n.range)) return
        const name = `f${mi}_${ki}_${ri}`
        variables[name] = { [`key${ki}`]: 1, [`need${mi}_${ri}`]: 1, ...(m.cap !== undefined ? { [`cap${mi}`]: 1 } : {}) }
        mine.push(name)
        all.push({ name, member: m.id, key: ki, range: ri })
      })
    })
  })
  return { constraints, variables, cols, all }
}

function valueOf(result: Record<string, unknown>, name: string): number {
  const v = result[name]
  return typeof v === 'number' ? Math.max(0, v) : 0
}

function totalOf(result: Record<string, unknown>, names: string[]): number {
  let t = 0
  for (const n of names) t += valueOf(result, n)
  return t
}

/**
 * Add the row `g_m ≥ rhs + coeff·t` (`t` the shared level variable) for a member: its f columns count 1.
 * A fresh clone of the variables and constraints is made by the caller per LP.
 */
function levelRow(model: Model, member: string, name: string, rhs: number, tCoeff = 0): void {
  model.constraints[name] = { min: rhs }
  for (const col of model.cols.get(member) ?? []) model.variables[col][name] = 1
  if (tCoeff !== 0) model.variables.t[name] = -tCoeff
}

function clone(model: Model): Model {
  return {
    constraints: structuredClone(model.constraints),
    variables: structuredClone(model.variables),
    cols: model.cols,
    all: model.all,
  }
}

/**
 * Allocate the offered `keys` of the fluid `itemId` to the members of `groups` (rank order; a group of one is a single member).
 * A member that needs nothing (or has a cap of 0) gets nothing. With one key and no range constraint it gives what
 * `waterFill` gives.
 */
export function allocateKeys(itemId: string, keys: AllocKey[], groups: AllocMember[][]): KeyAllocation {
  const grants = new Map<string, Map<string, number>>()
  const covered = new Map<string, Map<string, number>>()
  const held = new Map<string, number>()
  const members = groups.flat()
  for (const m of members) {
    grants.set(m.id, new Map())
    covered.set(m.id, new Map())
  }
  const demand = new Map<string, number>()
  for (const m of members) {
    let need = 0
    for (const n of m.needs) need += Math.max(0, n.rate)
    demand.set(m.id, Math.min(need, m.cap ?? Infinity))
  }
  const offerTotal = keys.reduce((a, k) => a + Math.max(0, k.offer), 0)
  if (offerTotal <= FLOW_TOLERANCE || [...demand.values()].every(d => d <= FLOW_TOLERANCE)) return { grants, covered, held }

  const base = baseModel(keys, members)
  const levels = new Map<string, number>() // frozen members → their level
  let slack = 1
  // The room a lower bound read back from `id`'s columns gets.
  const lowerBound = (v: number, id: string): number =>
    Math.max(0, v * (1 - LEVEL_REL * slack) - LEVEL_ABS * slack * Math.max(1, base.cols.get(id)?.length ?? 1))
  // An LP made with the room of `slack` 1, once more with 1e3 when it comes back infeasible (the levels were read back from a rounded solve).
  const solveWithRetry = (make: () => Model): { model: Model; result: ReturnType<typeof runLP> } => {
    slack = 1
    let model = make()
    let result = runLP('__obj__', model.constraints, model.variables)
    if (result.feasible !== true) {
      slack = 1e3
      model = make()
      result = runLP('__obj__', model.constraints, model.variables)
      slack = 1
    }
    return { model, result }
  }

  for (const group of groups) {
    const active = group.filter(m => (demand.get(m.id) ?? 0) > FLOW_TOLERANCE && (base.cols.get(m.id)?.length ?? 0) > 0)
    for (const m of group) if (!active.includes(m)) levels.set(m.id, 0)
    if (active.length === 1) {
      const m = active[0]
      const { result: r } = solveWithRetry(() => {
        const model = clone(base)
        for (const [id, l] of levels) levelRow(model, id, `hold_${id}`, lowerBound(l, id))
        for (const col of base.cols.get(m.id)!) model.variables[col].__obj__ = -1
        return model
      })
      levels.set(m.id, r.feasible === true ? totalOf(r, base.cols.get(m.id)!) : 0)
      continue
    }
    const left = [...active]
    while (left.length > 0) {
      const { result: r } = solveWithRetry(() => {
        const model = clone(base)
        model.variables.t = { __obj__: -1 }
        for (const [id, l] of levels) levelRow(model, id, `hold_${id}`, lowerBound(l, id))
        for (const m of left) levelRow(model, m.id, `lvl_${m.id}`, 0, m.weight)
        return model
      })
      const t = r.feasible === true ? valueOf(r, 't') : 0
      const frozen: AllocMember[] = []
      for (const m of left) {
        const level = m.weight * t
        if (level >= (demand.get(m.id) ?? 0) - LEVEL_TOL) {
          levels.set(m.id, Math.min(level, demand.get(m.id) ?? 0))
          frozen.push(m)
        }
      }
      if (frozen.length === 0) {
        // Members that cannot grow beyond the common level are frozen at it.
        for (const m of left) {
          const { result: pr } = solveWithRetry(() => {
            const probe = clone(base)
            for (const [id, l] of levels) levelRow(probe, id, `hold_${id}`, lowerBound(l, id))
            for (const o of left) if (o !== m) levelRow(probe, o.id, `lvl_${o.id}`, lowerBound(o.weight * t, o.id))
            for (const col of base.cols.get(m.id)!) probe.variables[col].__obj__ = -1
            return probe
          })
          const best = pr.feasible === true ? totalOf(pr, base.cols.get(m.id)!) : 0
          if (best <= m.weight * t + LEVEL_TOL) {
            levels.set(m.id, m.weight * t)
            frozen.push(m)
          }
        }
      }
      if (frozen.length === 0) {
        for (const m of left) levels.set(m.id, m.weight * t)
        break
      }
      for (const m of frozen) left.splice(left.indexOf(m), 1)
    }
  }

  // Final: every level held, the most flow, then the least versatile keys.
  const finalModel = (): Model => {
    const fin = clone(base)
    for (const m of members) if (levels.has(m.id)) levelRow(fin, m.id, `hold_${m.id}`, lowerBound(levels.get(m.id)!, m.id))
    return fin
  }
  // A unit of flow pays more than any versatility costs, so the totals are the largest the levels allow (a lower bound with its
  // rounding room is never used up to save a key), then, as the consumer's own solve does (`SUPPLY_DEPTH`), a short supply serves the
  // narrowest range first (a term in steps above any versatility), then the keys are the least versatile. With no shortage every
  // range is covered and the depth term is constant.
  const needRanges = new Map<string, FluidRange>()
  for (const m of members) for (const n of m.needs) needRanges.set(flowKey(itemId, n.range), n.range)
  const rangeList = [...needRanges.values()]
  const step = Math.max(...keys.map(k => k.versatility), 1) + 1
  const reward = step * (rangeList.length + 1) + 1
  const objective = (fin: Model): void => {
    for (const col of fin.all) {
      const range = needsOfMember.get(col.member)![col.range].range
      const depthCost = step * Math.max(0, rangeList.length - rangeDepth(range, rangeList))
      fin.variables[col.name].__obj__ = keys[col.key].versatility + depthCost - reward
    }
  }
  const needsOfMember = new Map(members.map(m => [m.id, m.needs]))
  let fin = finalModel()
  objective(fin)
  let result = runLP('__obj__', fin.constraints, fin.variables)
  if (result.feasible !== true) {
    // The levels were read back from a rounded solve: give them more room once.
    slack = 1e3
    fin = finalModel()
    objective(fin)
    result = runLP('__obj__', fin.constraints, fin.variables)
  }
  if (result.feasible !== true) return { grants, covered, held }
  // Clamped: LP rounding must not give a key more than it offers, in the grants and in the need met alike.
  const totals = keys.map(() => 0)
  for (const col of fin.all) totals[col.key] += valueOf(result, col.name)
  const scales = keys.map((k, i) => (totals[i] > k.offer && totals[i] > 0 ? k.offer / totals[i] : 1))
  for (const col of fin.all) {
    const amount = valueOf(result, col.name) * scales[col.key]
    if (amount <= 0) continue
    const mg = grants.get(col.member)!
    mg.set(keys[col.key].key, (mg.get(keys[col.key].key) ?? 0) + amount)
    const rk = flowKey(itemId, needsOfMember.get(col.member)![col.range].range)
    const mc = covered.get(col.member)!
    mc.set(rk, (mc.get(rk) ?? 0) + amount)
  }
  keys.forEach((k, i) => held.set(k.key, Math.min(k.offer, totals[i])))
  return { grants, covered, held }
}

/**
 * The most the offered `keys` can serve of `needs` together: each key only to a range it fits. Never above `Σ needs` or
 * `Σ offers`.
 */
export function maxFit(keys: AllocKey[], needs: { range: FluidRange; rate: number }[]): number {
  const member: AllocMember = { id: 'm', needs, weight: 1 }
  const model = baseModel(keys, [member])
  const cols = model.cols.get('m')!
  if (cols.length === 0) return 0
  for (const col of cols) model.variables[col].__obj__ = -1
  const r = runLP('__obj__', model.constraints, model.variables)
  return r.feasible === true ? totalOf(r, cols) : 0
}
