import { z } from 'zod'

// ---------------------------------------------------------------------------
// Whether the planner runs inside the desktop app (src-tauri/), which hosts the in-game viewer's bridge itself.
// The app's Rust side writes a plain global before the page loads; there is no IPC and no Tauri API here.
// ---------------------------------------------------------------------------

export const DESKTOP_HOST_KEY = '__FACTORIO_PLANNER_DESKTOP__'

export const DesktopHostSchema = z.object({
  /** `running`, or why the app's bridge could not start. */
  bridge: z.union([z.literal('running'), z.object({ error: z.string() })]),
})

export type DesktopHost = z.output<typeof DesktopHostSchema>

/** What the app wrote into `scope`, or undefined in a browser (or when the value is not what the app writes). */
export function readDesktopHost(scope: object = globalThis): DesktopHost | undefined {
  const parsed = DesktopHostSchema.safeParse((scope as Record<string, unknown>)[DESKTOP_HOST_KEY])
  return parsed.success ? parsed.data : undefined
}

/** Read once at load: the app's script runs before the page's. */
export const desktopHost = readDesktopHost()
