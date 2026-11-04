import { useId, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  errorText, statusLabels, type CrmObject, type ObjectFields, type Profile,
  type Status, type Task, type TaskFields,
} from './data'
import type { useLoad } from './useLoad'
import styles from './app.module.css'

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div role={error ? 'alert' : 'status'} className={error ? styles.errorNotice : styles.notice}>{children}</div>
}

export function LoadResult<T>({ state, refresh, children }: ReturnType<typeof useLoad<T>> & {
  children: (data: T) => ReactNode
}) {
  if (state.status === 'loading') return <Notice>Загрузка…</Notice>
  if (state.status === 'error') return <Notice error>
    <span>{errorText(state.error)}</span>
    <button type="button" onClick={refresh}>Повторить</button>
  </Notice>
  return children(state.data)
}

export function PageHeading({ eyebrow, title, detail, action }: {
  eyebrow: string; title: string; detail?: string; action?: ReactNode
}) {
  return <div className={styles.heading}>
    <div><div className={styles.eyebrow}>{eyebrow}</div><h1>{title}</h1>{detail && <p className={styles.muted}>{detail}</p>}</div>
    {action}
  </div>
}

export function Back({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className={styles.back}><span aria-hidden="true">←</span> {children}</Link>
}

export function StatusBadge({ status }: { status: Status }) {
  return <span className={styles.badge} data-status={status}>{statusLabels[status]}</span>
}

export function TaskList({ tasks, showObject = false }: { tasks: Task[]; showObject?: boolean }) {
  if (!tasks.length) return <Notice>Задач пока нет.</Notice>
  return <ul className={styles.list}>
    {tasks.map((task) => <li key={task.id}>
      <Link className={styles.rowLink} to={'/tasks/' + task.id}>
        <span><strong>{task.title}</strong><small>{showObject ? task.object?.name : task.assignee?.display_name}</small></span>
        <StatusBadge status={task.status} />
      </Link>
    </li>)}
  </ul>
}

function FormPanel({ title, onCancel, onSubmit, children }: {
  title: string
  onCancel: () => void
  onSubmit: (fields: FormData) => Promise<unknown>
  children: ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSubmit(new FormData(event.currentTarget))
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(false)
    }
  }
  return <section className={styles.panel}>
    <h2>{title}</h2>
    <form className={styles.form} onSubmit={submit}>
      <fieldset disabled={busy}>{children}</fieldset>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <button className={styles.primary} disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
        <button type="button" disabled={busy} onClick={onCancel}>Отмена</button>
      </div>
    </form>
  </section>
}

function field(fields: FormData, name: string) {
  return String(fields.get(name) ?? '').trim()
}

export function ObjectForm({ object, onSave, onCancel }: {
  object?: CrmObject; onSave: (fields: ObjectFields) => Promise<unknown>; onCancel: () => void
}) {
  return <FormPanel title={object ? 'Редактирование объекта' : 'Новый объект'} onCancel={onCancel}
    onSubmit={(fields) => onSave({ name: field(fields, 'name'), address: field(fields, 'address') })}>
    <label>Название объекта<input name="name" required maxLength={150} defaultValue={object?.name} /></label>
    <label>Адрес<input name="address" required maxLength={250} defaultValue={object?.address} /></label>
  </FormPanel>
}

export function TaskForm({ task, workers, objectId, objects, onSave, onCancel }: {
  task?: Task; workers: Profile[]; objectId: string; objects?: CrmObject[]
  onSave: (fields: TaskFields) => Promise<unknown>; onCancel: () => void
}) {
  const objectLabel = useId()
  const assigneeLabel = useId()
  if (!workers.length) return <Notice>
    <span>Администратор должен добавить хотя бы одного исполнителя.</span>
    <button type="button" onClick={onCancel}>Закрыть</button>
  </Notice>
  return <FormPanel title={task ? 'Редактирование задачи' : 'Новая задача'} onCancel={onCancel}
    onSubmit={(fields) => onSave({
      title: field(fields, 'title'),
      description: field(fields, 'description'),
      assignee_id: field(fields, 'assignee_id'),
      object_id: objects ? field(fields, 'object_id') : objectId,
    })}>
    <label>Название задачи<input name="title" required maxLength={180} defaultValue={task?.title} /></label>
    <label>Описание<textarea name="description" rows={4} defaultValue={task?.description} /></label>
    {objects && <label><span id={objectLabel}>Объект</span>
      <select name="object_id" aria-labelledby={objectLabel} required defaultValue={objectId}>
      {objects.map((object) => <option key={object.id} value={object.id}>{object.name}</option>)}
    </select></label>}
    <label><span id={assigneeLabel}>Исполнитель</span>
      <select name="assignee_id" aria-labelledby={assigneeLabel} required defaultValue={task?.assignee_id ?? ''}>
      <option value="" disabled>Выберите исполнителя</option>
      {workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.display_name}</option>)}
    </select></label>
  </FormPanel>
}

export function DeletePanel({ kind, onDelete, onCancel }: {
  kind: 'object' | 'task'; onDelete: () => Promise<unknown>; onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function confirm() {
    setBusy(true)
    setError('')
    try {
      await onDelete()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(false)
    }
  }
  return <section className={styles.panel}>
    <h2>{kind === 'object' ? 'Удалить объект?' : 'Удалить задачу?'}</h2>
    <p>{kind === 'object' ? 'Объект и все его задачи исчезнут из рабочих списков.' : 'Задача исчезнет из рабочих списков.'} История сохранится.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}>
      <button type="button" className={styles.dangerFill} disabled={busy} onClick={confirm}>Подтвердить удаление</button>
      <button type="button" disabled={busy} onClick={onCancel}>Отмена</button>
    </div>
  </section>
}
