import { lazyComponent } from '../utils/lazyComponent'

// The two big modals are only there once something opens them, so each is a chunk of its own, fetched on first use
// (see lazyComponent). Importing them here, in a file that exports no components, keeps the callers' bundle small.

/** The tech tree: layout, search and the pan-and-zoom canvas. Opened by the top-bar button and by the horizon flag. */
export const TechTreeModal = lazyComponent(() => import('./TechTreeModal').then(m => m.TechTreeModal))

/** The Factory overview: the graph, matrix, power and areas views. Opened by the top-bar button. */
export const BlockGraphModal = lazyComponent(() => import('./factory/BlockGraphModal').then(m => m.BlockGraphModal))
