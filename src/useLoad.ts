import { useEffect, useState } from 'react'

type LoadState<T> = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: T }

export function useLoad<T>(load: () => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' })
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active = true
    load().then(
      (data) => { if (active) setState({ status: 'ready', data }) },
      (error: unknown) => { if (active) setState({ status: 'error', error }) },
    )
    return () => { active = false }
  }, [load, revision])

  function refresh() {
    setState({ status: 'loading' })
    setRevision((value) => value + 1)
  }

  return { state, refresh }
}
