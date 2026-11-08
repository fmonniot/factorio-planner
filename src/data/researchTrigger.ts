import type { GameData, ResearchTrigger } from './types'

/** The game data needed to name and illustrate a trigger's subject. */
export type TriggerLookup = Pick<GameData, 'items' | 'machines' | 'beacons'>

export interface TriggerDescription {
  /** One-line condition, e.g. "Craft 10 × Steel plate". */
  short: string
  /** Sentence form, e.g. "Researched by crafting 10 × Steel plate". */
  full: string
  /** Icon of the subject, when the bundle has one. */
  iconPath?: string
}

function humanize(id: string): string {
  const s = id.replace(/-/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Describe a research trigger. Returns null for an undefined trigger, an unknown type or a known type missing its
 * required field; the caller then shows a plain "Trigger".
 */
export function describeTrigger(trigger: ResearchTrigger | undefined, lookup: TriggerLookup): TriggerDescription | null {
  if (!trigger) return null

  // Item or fluid ids live in `items`; entity ids fall back to machines and beacons.
  const nameAndIcon = (id: string, entity: boolean): { name: string; iconPath?: string } => {
    const found = lookup.items[id] ?? (entity ? lookup.machines[id] ?? lookup.beacons[id] : undefined)
    return { name: found?.name ?? humanize(id), iconPath: found?.iconPath || undefined }
  }
  const qty = (name: string) => (trigger.count !== undefined && trigger.count > 1 ? `${trigger.count} × ${name}` : name)
  const make = (short: string, full: string, iconPath?: string): TriggerDescription => ({ short, full, iconPath })

  switch (trigger.type) {
    case 'craft-item':
    case 'craft-fluid': {
      const id = trigger.type === 'craft-item' ? trigger.item : trigger.fluid
      if (!id) return null
      const { name, iconPath } = nameAndIcon(id, false)
      return make(`Craft ${qty(name)}`, `Researched by crafting ${qty(name)}`, iconPath)
    }
    case 'mine-entity': {
      if (!trigger.entity) return null
      const { name, iconPath } = nameAndIcon(trigger.entity, true)
      return make(`Mine ${name}`, `Researched by mining ${name}`, iconPath)
    }
    case 'build-entity': {
      if (!trigger.entity) return null
      const { name, iconPath } = nameAndIcon(trigger.entity, true)
      return make(`Build ${qty(name)}`, `Researched by building ${qty(name)}`, iconPath)
    }
    case 'capture-spawner': {
      if (!trigger.entity) return make('Capture a spawner', 'Researched by capturing a spawner')
      const { name, iconPath } = nameAndIcon(trigger.entity, true)
      return make(`Capture ${name}`, `Researched by capturing ${name}`, iconPath)
    }
    case 'send-item-to-orbit': {
      if (!trigger.item) return null
      const { name, iconPath } = nameAndIcon(trigger.item, false)
      return make(`Send ${name} to orbit`, `Researched by sending ${name} to orbit`, iconPath)
    }
    case 'create-space-platform':
      return make('Create a space platform', 'Researched by creating a space platform')
    default:
      return null
  }
}
