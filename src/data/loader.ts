import { GameDataSchema, PlanSchema } from './schema'
import type { GameData, Plan } from './schema'

export class GameDataLoadError extends Error {
  readonly issues: { path: string; message: string }[]

  constructor(issues: { path: string; message: string }[]) {
    const summary = issues
      .slice(0, 5)
      .map(i => `${i.path}: ${i.message}`)
      .join('\n')
    super(`Invalid game data:\n${summary}${issues.length > 5 ? `\n…and ${issues.length - 5} more` : ''}`)
    this.name = 'GameDataLoadError'
    this.issues = issues
  }
}

export class PlanLoadError extends Error {
  readonly issues: { path: string; message: string }[]

  constructor(issues: { path: string; message: string }[]) {
    const summary = issues
      .slice(0, 5)
      .map(i => `${i.path}: ${i.message}`)
      .join('\n')
    super(`Invalid plan data:\n${summary}${issues.length > 5 ? `\n…and ${issues.length - 5} more` : ''}`)
    this.name = 'PlanLoadError'
    this.issues = issues
  }
}

function formatZodError(
  error: import('zod').ZodError,
): { path: string; message: string }[] {
  return error.issues.map(issue => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }))
}

/**
 * Parse and validate a raw JSON value as GameData.
 * Throws GameDataLoadError if validation fails.
 */
export function parseGameData(raw: unknown): GameData {
  const result = GameDataSchema.safeParse(raw)
  if (!result.success) {
    throw new GameDataLoadError(formatZodError(result.error))
  }
  return result.data
}

/**
 * Parse a JSON string, then validate as GameData.
 * Throws SyntaxError if the string is not valid JSON.
 * Throws GameDataLoadError if validation fails.
 */
export function loadGameDataFromJson(json: string): GameData {
  const raw: unknown = JSON.parse(json)
  return parseGameData(raw)
}

/**
 * Parse and validate a raw JSON value as Plan.
 * Throws PlanLoadError if validation fails.
 */
export function parsePlan(raw: unknown): Plan {
  const result = PlanSchema.safeParse(raw)
  if (!result.success) {
    throw new PlanLoadError(formatZodError(result.error))
  }
  return result.data
}

/**
 * Parse a JSON string, then validate as Plan.
 * Throws SyntaxError if the string is not valid JSON.
 * Throws PlanLoadError if validation fails.
 */
export function loadPlanFromJson(json: string): Plan {
  const raw: unknown = JSON.parse(json)
  return parsePlan(raw)
}
