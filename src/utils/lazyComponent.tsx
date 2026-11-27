import { createElement, useEffect, useState } from 'react'
import type { ComponentType } from 'react'

/**
 * A component whose code is fetched the first time it renders (it renders nothing until then), for the pieces of UI
 * that are only there on demand, so they leave the main bundle. Unlike `React.lazy`, the code can be fetched ahead of
 * a render with `preload()`; once it has arrived the component renders synchronously, which the tests rely on.
 */
export function lazyComponent<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null
  let loading: Promise<void> | null = null

  function preload(): Promise<void> {
    loading ??= load().then(component => { loaded = component })
    return loading
  }

  function Lazy(props: P) {
    const [, rerender] = useState(0)
    useEffect(() => {
      if (!loaded) void preload().then(() => rerender(n => n + 1))
    }, [])
    return loaded ? createElement(loaded, props) : null
  }

  return Object.assign(Lazy, { preload })
}
