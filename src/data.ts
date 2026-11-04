import { createClient } from '@supabase/supabase-js'
import type { Database, Tables } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const db = url && key ? createClient<Database>(url, key) : null

function client() {
  if (!db) throw new Error('Подключение к Supabase не настроено.')
  return db
}

export type Profile = Tables<'profiles'>
export type CrmObject = Tables<'objects'>
export type Status = Tables<'tasks'>['status']
export type ObjectFields = Pick<CrmObject, 'name' | 'address'>
export type TaskFields = Pick<Tables<'tasks'>, 'title' | 'description' | 'assignee_id' | 'object_id'>

export const statusLabels: Record<Status, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  in_review: 'На проверке',
  accepted: 'Принята',
  needs_changes: 'На доработке',
}

function isUuid(id: string) {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)
}

export function errorText(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    if (['PT400', 'PT404', 'PT409'].includes(String(error.code)) && 'message' in error) {
      return String(error.message)
    }
    if (error.code === '42501') return 'У вас нет прав на это действие.'
    if (error.code === '23514') return 'Проверьте обязательные поля.'
    if (error.code === 'PGRST116') return 'Запись недоступна или уже удалена.'
  }
  if (error instanceof Error && !db) return error.message
  return 'Не удалось выполнить запрос. Проверьте соединение и попробуйте снова.'
}

async function read<T>(request: PromiseLike<{ data: T; error: unknown }>) {
  const { data, error } = await request
  if (error) throw error
  return data
}

export function getProfile(id: string) {
  return read(client().from('profiles').select('*').eq('id', id).maybeSingle())
}

export function getObjects() {
  return read(client().from('objects').select('*').order('name').order('id'))
}

export function saveObject(fields: ObjectFields, id?: string) {
  const table = client().from('objects')
  const request = id ? table.update(fields).eq('id', id) : table.insert(fields)
  return read(request.select().single())
}

export function getWorkers() {
  return read(client().from('profiles').select('*').eq('role', 'worker').order('display_name'))
}

const taskSelection = '*, object:objects(name), assignee:profiles!assignee_id(display_name), author:profiles!created_by(display_name)' as const

export function getTasks(filter: { objectId: string } | { assigneeId: string }) {
  const query = client().from('tasks').select(taskSelection)
  const filtered = 'objectId' in filter
    ? query.eq('object_id', filter.objectId)
    : query.eq('assignee_id', filter.assigneeId)
  return read(filtered.order('created_at', { ascending: false }).order('id'))
}

export type Task = NonNullable<Awaited<ReturnType<typeof getTasks>>>[number]

export async function getObjectPage(id: string, manager: boolean) {
  if (!isUuid(id)) return null
  const object = await read(client().from('objects').select('*').eq('id', id).maybeSingle())
  if (!object) return null
  const [tasks, workers] = await Promise.all([
    getTasks({ objectId: id }),
    manager ? getWorkers() : [],
  ])
  return { object, tasks, workers }
}

export async function getTaskPage(id: string, manager: boolean) {
  if (!isUuid(id)) return null
  const task = await read(client().from('tasks').select(taskSelection).eq('id', id).maybeSingle())
  if (!task) return null
  const [history, workers, objects] = await Promise.all([
    read(client().from('task_history')
      .select('*, actor:profiles!actor_id(display_name)')
      .eq('task_id', id).order('id', { ascending: false })),
    manager ? getWorkers() : [],
    manager ? getObjects() : [],
  ])
  return { task, history, workers, objects }
}

export function saveTask(fields: TaskFields, id?: string) {
  const table = client().from('tasks')
  const request = id ? table.update(fields).eq('id', id) : table.insert(fields)
  return read(request.select().single())
}

export function archive(kind: 'task' | 'object', id: string) {
  return read(client().rpc('archive_item', { p_kind: kind, p_id: id }))
}

export function changeStatus(id: string, status: Status, comment?: string) {
  return read(client().rpc('change_task_status', {
    p_task_id: id,
    p_new_status: status,
    ...(comment ? { p_comment: comment } : {}),
  }))
}
