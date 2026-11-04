import { useCallback, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  archive, changeStatus, errorText, getObjectPage, getObjects, getTaskPage,
  getTasks, saveObject, saveTask, statusLabels, type Profile, type Status, type Task,
} from './data'
import {
  Back, DeletePanel, LoadResult, Notice, ObjectForm, PageHeading, StatusBadge, StatusFilter, TaskForm, TaskList,
} from './components'
import { useLoad } from './useLoad'
import styles from './app.module.css'

const dates = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })

export function ObjectsPage({ profile }: { profile: Profile }) {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const load = useLoad(getObjects)
  return <>
    <PageHeading title="Объекты" detail="Строительные площадки и задачи по ним"
      action={profile.role === 'manager' && <button type="button" className={styles.primary}
        onClick={() => setCreating(true)}>Создать объект</button>} />
    {creating && <ObjectForm onCancel={() => setCreating(false)} onSave={async (fields) => {
      const object = await saveObject(fields)
      if (object) navigate('/objects/' + object.id)
    }} />}
    <LoadResult {...load}>{(objects) => {
      if (!objects?.length) return <Notice>{profile.role === 'manager' ? 'Объектов пока нет.' : 'Пока нет объектов с вашими задачами.'}</Notice>
      const normalizedQuery = query.trim().toLocaleLowerCase('ru')
      const visible = objects.filter(({ name, address }) => [name, address].some(
        (value) => value.toLocaleLowerCase('ru').includes(normalizedQuery),
      ))
      return <>
        <div className={styles.objectToolbar}>
          <label className={styles.search}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <circle cx="10.8" cy="10.8" r="5.8" /><path d="m15 15 4 4" strokeLinecap="round" />
            </svg>
            <input type="search" aria-label="Поиск объектов" placeholder="Название или адрес" value={query}
              onChange={(event) => setQuery(event.target.value)} />
          </label>
          <span className={styles.resultCount} role="status">
            {normalizedQuery ? `Найдено: ${visible.length} из ${objects.length}` : `Всего объектов: ${objects.length}`}
          </span>
        </div>
        {visible.length ? <ul className={styles.grid}>{visible.map((object) => <li key={object.id}>
          <Link className={styles.objectCard} to={'/objects/' + object.id}>
            <span className={styles.objectMark} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20h16M6 20V6l9-3v17m0-11h3v11M9 8h2m-2 4h2m-2 4h2" />
              </svg>
            </span>
            <div className={styles.objectInfo}>
              <strong>{object.name}</strong>
              <p>{object.address}</p>
            </div>
            <span className={styles.cardFooter}>Открыть объект <span aria-hidden="true">→</span></span>
          </Link>
        </li>)}</ul> : <Notice>
          <span>Объекты не найдены.</span>
          <button type="button" onClick={() => setQuery('')}>Сбросить поиск</button>
        </Notice>}
      </>
    }}
    </LoadResult>
  </>
}

export function ObjectPage({ id, profile }: { id: string; profile: Profile }) {
  const navigate = useNavigate()
  const [form, setForm] = useState<'object' | 'task' | 'delete' | null>(null)
  const [status, setStatus] = useState('')
  const manager = profile.role === 'manager'
  const request = useCallback(() => getObjectPage(id, manager), [id, manager])
  const load = useLoad(request)
  return <>
    <Back to="/objects">К объектам</Back>
    <LoadResult {...load}>{(data) => {
      if (!data) return <Notice>Объект недоступен или уже удалён.</Notice>
      const { object, tasks, workers } = data
      const visible = tasks?.filter((task) => !status || task.status === status) ?? []
      return <>
        <PageHeading eyebrow="Объект" title={object.name} detail={object.address} action={manager &&
          <div className={styles.actions}>
            <button type="button" onClick={() => setForm('object')}>Редактировать объект</button>
            <button type="button" className={styles.danger} onClick={() => setForm('delete')}>Удалить объект</button>
          </div>} />
        {form === 'object' && <ObjectForm object={object} onCancel={() => setForm(null)} onSave={async (fields) => {
          await saveObject(fields, id)
          setForm(null)
          load.refresh()
        }} />}
        {form === 'delete' && <DeletePanel kind="object" onCancel={() => setForm(null)} onDelete={async () => {
          await archive('object', id)
          navigate('/objects', { replace: true })
        }} />}
        <div className={styles.sectionHeading}>
          <h2>Задачи объекта <span className={styles.count}>{tasks?.length ?? 0}</span></h2>
          {manager && <button type="button" className={styles.primary} onClick={() => setForm('task')}>Создать задачу</button>}
        </div>
        {form === 'task' && <TaskForm objectId={id} workers={workers ?? []} onCancel={() => setForm(null)}
          onSave={async (fields) => {
            const task = await saveTask(fields)
            if (task) navigate('/tasks/' + task.id)
          }} />}
        {!!tasks?.length && <div className={styles.filters}>
          <StatusFilter value={status} onChange={setStatus} />
        </div>}
        <TaskList tasks={visible} emptyText={status ? 'Задач с таким статусом нет.' : undefined} />
      </>
    }}</LoadResult>
  </>
}

export function MyTasksPage({ profile }: { profile: Profile }) {
  const [status, setStatus] = useState('')
  const [objectId, setObjectId] = useState('')
  const request = useCallback(() => getTasks({ assigneeId: profile.id }), [profile.id])
  const load = useLoad(request)
  return <>
    <PageHeading title="Мои задачи" detail="Задачи, назначенные вам" />
    <LoadResult {...load}>{(tasks) => {
      if (!tasks?.length) return <Notice>Задач пока нет.</Notice>
      const objects = new Map(tasks.map((task) => [task.object_id, task.object?.name ?? 'Объект']))
      const visible = tasks.filter((task) => (!status || task.status === status) && (!objectId || task.object_id === objectId))
      return <>
        <div className={styles.filters}>
          <StatusFilter value={status} onChange={setStatus} />
          <label>Объект
            <select value={objectId} onChange={(event) => setObjectId(event.target.value)}>
              <option value="">Все объекты</option>
              {[...objects].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          {(status || objectId) && <button type="button" onClick={() => { setStatus(''); setObjectId('') }}>Сбросить</button>}
        </div>
        <TaskList tasks={visible} showObject emptyText="По выбранным фильтрам задач нет." />
      </>
    }}</LoadResult>
  </>
}

export function TaskPage({ id, profile }: { id: string; profile: Profile }) {
  const navigate = useNavigate()
  const [form, setForm] = useState<'task' | 'delete' | null>(null)
  const manager = profile.role === 'manager'
  const request = useCallback(() => getTaskPage(id, manager), [id, manager])
  const load = useLoad(request)
  return <LoadResult {...load}>{(data) => {
    if (!data) return <><Back to="/objects">К объектам</Back><Notice>Задача недоступна или уже удалена.</Notice></>
    const { task, history, workers, objects } = data
    const objectPath = '/objects/' + task.object_id
    return <>
      <Back to={objectPath}>{task.object?.name ?? 'К объекту'}</Back>
      <PageHeading eyebrow="Задача" title={task.title} action={manager && <div className={styles.actions}>
        <button type="button" onClick={() => setForm('task')}>Редактировать задачу</button>
        <button type="button" className={styles.danger} onClick={() => setForm('delete')}>Удалить задачу</button>
      </div>} />
      {form === 'task' && <TaskForm task={task} objectId={task.object_id} workers={workers ?? []}
        objects={objects ?? []} onCancel={() => setForm(null)} onSave={async (fields) => {
          await saveTask(fields, id)
          setForm(null)
          load.refresh()
        }} />}
      {form === 'delete' && <DeletePanel kind="task" onCancel={() => setForm(null)} onDelete={async () => {
        await archive('task', id)
        navigate(objectPath, { replace: true })
      }} />}
      <div className={styles.taskLayout}>
        <section className={styles.panel} aria-label="Сведения о задаче">
          <StatusBadge status={task.status} />
          <h2>Описание</h2>
          <p className={styles.description}>{task.description || 'Описание не добавлено.'}</p>
          <dl className={styles.details}>
            <div><dt>Объект</dt><dd><Link to={objectPath}>{task.object?.name ?? 'К объекту'}</Link></dd></div>
            <div><dt>Исполнитель</dt><dd>{task.assignee?.display_name ?? '—'}</dd></div>
            <div><dt>Автор</dt><dd>{task.author?.display_name ?? '—'}</dd></div>
            <div><dt>Создана</dt><dd>{dates.format(new Date(task.created_at))}</dd></div>
          </dl>
          <StatusActions task={task} profile={profile} onChanged={load.refresh} />
        </section>
        <section className={styles.panel}>
          <h2>История статусов</h2>
          {!history?.length ? <Notice>Изменений пока нет.</Notice> : <ol className={styles.timeline}>
            {history.map((event) => <li key={event.id}>
              <div className={styles.eventTitle}>
                {event.from_status ? <span>{statusLabels[event.from_status]} <span aria-hidden="true">→</span> </span> : <span>Создание <span aria-hidden="true">→</span> </span>}
                <strong>{statusLabels[event.to_status]}</strong>
              </div>
              <small>{event.actor?.display_name ?? 'Участник задачи'} · <time dateTime={event.created_at}>{dates.format(new Date(event.created_at))}</time></small>
              {event.comment && <p className={styles.comment}>{event.comment}</p>}
            </li>)}
          </ol>}
        </section>
      </div>
    </>
  }}</LoadResult>
}

function StatusActions({ task, profile, onChanged }: { task: Task; profile: Profile; onChanged: () => void }) {
  const [returning, setReturning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const worker = profile.role === 'worker' && task.assignee_id === profile.id
  const review = profile.role === 'manager' && task.status === 'in_review'
  const canStart = worker && (task.status === 'new' || task.status === 'needs_changes')
  const canSubmit = worker && task.status === 'in_progress'
  if (!review && !canStart && !canSubmit) return null

  async function move(status: Status, comment?: string) {
    setBusy(true)
    setError('')
    try {
      await changeStatus(task.id, status, comment)
      onChanged()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(false)
    }
  }

  function sendBack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const comment = String(new FormData(event.currentTarget).get('comment') ?? '').trim()
    if (!comment) {
      setError('Укажите комментарий для доработки.')
      return
    }
    void move('needs_changes', comment)
  }

  return <div className={styles.statusActions}>
    {!returning && <div className={styles.actions}>
      {canStart && <button type="button" className={styles.primary} disabled={busy} onClick={() => void move('in_progress')}>
        {task.status === 'new' ? 'Взять в работу' : 'Начать доработку'}
      </button>}
      {canSubmit && <button type="button" className={styles.primary} disabled={busy} onClick={() => void move('in_review')}>Отправить на проверку</button>}
      {review && <>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => void move('accepted')}>Принять задачу</button>
        <button type="button" disabled={busy} onClick={() => { setReturning(true); setError('') }}>Вернуть на доработку</button>
      </>}
    </div>}
    {returning && <form className={styles.form} onSubmit={sendBack}>
      <label>Комментарий для доработки<textarea name="comment" required rows={3} disabled={busy} /></label>
      <div className={styles.actions}>
        <button className={styles.primary} disabled={busy}>Подтвердить возврат</button>
        <button type="button" disabled={busy} onClick={() => { setReturning(false); setError('') }}>Отмена</button>
      </div>
    </form>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>
}
