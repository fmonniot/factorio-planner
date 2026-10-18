/**
 * Set placeResult on every bundle item whose prototype place_result is in
 * entityIds; remove it from every other item; copy fluids unchanged. The
 * prototype is looked up across itemSubtypes, last table wins (as exportItems).
 * @param {Record<string, object>} items exported items, keyed by id
 * @param {Record<string, any>} raw prototype dump
 * @param {string[]} itemSubtypes item prototype tables, in export order
 * @param {ReadonlySet<string>} entityIds ids of the exported machines and beacons
 * @returns {{ items: Record<string, object>, count: number }}
 */
export function attachPlaceResults(items, raw, itemSubtypes, entityIds) {
  const out = {}
  let count = 0
  for (const [id, item] of Object.entries(items)) {
    if (item.type === 'fluid') {
      out[id] = item
      continue
    }
    const { placeResult: _stale, ...rest } = item
    let proto
    for (const subtype of itemSubtypes) {
      if (raw[subtype]?.[id]) proto = raw[subtype][id]
    }
    const placed = proto?.place_result
    if (placed && entityIds.has(placed)) {
      out[id] = { ...rest, placeResult: placed }
      count++
    } else {
      out[id] = rest
    }
  }
  return { items: out, count }
}
