import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Link, Navigate, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { db, getProfile, type Profile } from './data'
import { MyTasksPage, ObjectPage, ObjectsPage, TaskPage } from './Pages'
import { Notice, LoadResult } from './components'
import { useLoad } from './useLoad'
import styles from './app.module.css'

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    if (!db) return
    const { data: { subscription } } = db.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => subscription.unsubscribe()
  }, [])

  if (!db) return <Login configurationError />
  if (session === undefined) return <main className={styles.shell}><Notice>Проверяем вход…</Notice></main>
  if (!session) {
    return <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<SignInRedirect />} />
    </Routes>
  }
  return <Workspace key={session.user.id} userId={session.user.id} />
}

function SignInRedirect() {
  const { pathname } = useLocation()
  return <Navigate to="/login" replace state={{ from: pathname }} />
}

function Login({ configurationError = false }: { configurationError?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!db) return
    const fields = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const { error: authError } = await db.auth.signInWithPassword({
        email: String(fields.get('email')).trim(), password: String(fields.get('password')),
      })
      if (authError) {
        setError(authError.code === 'invalid_credentials'
          ? 'Проверьте email и пароль.'
          : 'Вход не удался. Попробуйте ещё раз.')
      }
    } catch {
      setError('Не удалось связаться с сервисом входа.')
    } finally {
      setBusy(false)
    }
  }

  return <main className={styles.login}>
    <div className={styles.loginCard}>
      <Brand />
      <h1>Вход в CRM</h1>
      <p className={styles.muted}>Войдите с рабочим email и паролем.</p>
      {configurationError && <Notice error>Добавьте настройки подключения к Supabase в .env.local.</Notice>}
      <form className={styles.form} onSubmit={submit}>
        <label>Email<input type="email" name="email" required autoComplete="username" /></label>
        <label>Пароль<input type="password" name="password" required autoComplete="current-password" /></label>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <button className={styles.primary} disabled={busy || configurationError}>{busy ? 'Входим…' : 'Войти'}</button>
      </form>
    </div>
  </main>
}

function Brand() {
  return <div className={styles.brand}><span aria-hidden="true" className={styles.mark}>ОЗ</span><span>Объекты и задачи</span></div>
}

function Workspace({ userId }: { userId: string }) {
  const location = useLocation()
  const load = useCallback(() => getProfile(userId), [userId])
  const { state, refresh } = useLoad(load)
  const [logoutError, setLogoutError] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const from = location.state?.from
  const returnTo = typeof from === 'string' && /^\/(objects|tasks|my-tasks)(\/|$)/.test(from) ? from : '/objects'

  async function signOut() {
    setLeaving(true)
    setLogoutError(false)
    try {
      const result = await db?.auth.signOut({ scope: 'local' })
      setLogoutError(Boolean(result?.error))
    } catch {
      setLogoutError(true)
    } finally {
      setLeaving(false)
    }
  }

  const profile = state.status === 'ready' ? state.data : null
  return <>
    <header className={styles.top}>
      <div className={styles.topInner}>
        <Link className={styles.brandLink} to="/objects"><Brand /></Link>
        {profile && <nav aria-label="Основная навигация" className={styles.nav}>
          <NavLink to="/objects">Объекты</NavLink>
          {profile.role === 'worker' && <NavLink to="/my-tasks">Мои задачи</NavLink>}
        </nav>}
        <div className={styles.account}>
          {profile && <div><strong>{profile.display_name}</strong><small>{profile.role === 'manager' ? 'Постановщик' : 'Исполнитель'}</small></div>}
          <button type="button" disabled={leaving} onClick={signOut}>Выйти</button>
        </div>
      </div>
    </header>
    <main className={styles.shell}>
      {logoutError && <Notice error>Не удалось выйти. Попробуйте ещё раз.</Notice>}
      <LoadResult state={state} refresh={refresh}>
        {(current) => current ? <Routes>
          <Route path="/login" element={<Navigate to={returnTo} replace />} />
          <Route path="/objects" element={<ObjectsPage profile={current} />} />
          <Route path="/objects/:id" element={<DetailsRoute profile={current} kind="object" />} />
          <Route path="/tasks/:id" element={<DetailsRoute profile={current} kind="task" />} />
          <Route path="/my-tasks" element={current.role === 'worker' ? <MyTasksPage profile={current} /> : <Navigate to="/objects" replace />} />
          <Route path="*" element={<Navigate to="/objects" replace />} />
        </Routes> : <Notice>У аккаунта пока нет роли. Обратитесь к администратору.</Notice>}
      </LoadResult>
    </main>
  </>
}

function DetailsRoute({ profile, kind }: { profile: Profile; kind: 'object' | 'task' }) {
  const { id = '' } = useParams()
  return kind === 'object'
    ? <ObjectPage key={id} id={id} profile={profile} />
    : <TaskPage key={id} id={id} profile={profile} />
}
