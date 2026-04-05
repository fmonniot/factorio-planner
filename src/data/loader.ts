import { GameDataSchema, AppStateSchema } from './schema'
import type { GameData, AppState } from './schema'

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

export class AppStateLoadError extends Error {
  readonly issues: { path: string; message: string }[]

  constructor(issues: { path: string; message: string }[]) {
    const summary = issues
      .slice(0, 5)
      .map(i => `${i.path}: ${i.message}`)
      .join('\n')
    super(`Invalid app state data:\n${summary}${issues.length > 5 ? `\n…and ${issues.length - 5} more` : ''}`)
    this.name = 'AppStateLoadError'
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
 * Parse and validate a raw JSON value as AppState.
 * Throws AppStateLoadError if validation fails.
 */
export function parseAppState(raw: unknown): AppState {
  const result = AppStateSchema.safeParse(raw)
  if (!result.success) {
    throw new AppStateLoadError(formatZodError(result.error))
  }
  return result.data
}

/**
 * Parse a JSON string, then validate as AppState.
 * Throws SyntaxError if the string is not valid JSON.
 * Throws AppStateLoadError if validation fails.
 */
export function loadAppStateFromJson(json: string): AppState {
  const raw: unknown = JSON.parse(json)
  return parseAppState(raw)
}
