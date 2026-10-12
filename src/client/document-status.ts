/** Read-only browser hints. Hash linkage is freshness evidence, not delivery acceptance. */
export type DeliveryState = 'current' | 'historical' | 'inspect' | 'missing'
export async function documentStatus(id: string, plan: string | undefined, ready: string | undefined): Promise<{ title?: string; delivery: DeliveryState }> {
  const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('')
  try {
    if (!plan || new TextEncoder().encode(plan).length > 128 * 1024) return { delivery: 'inspect' }
    const match = /^\[project-ops-v1\]: <data:application\/json;base64,([A-Za-z0-9+/=]+)>\n\n/u.exec(plan)
    if (!match) return { delivery: 'inspect' }
    const metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(match[1]!), c => c.charCodeAt(0))))
    const record = metadata.record
    if (record?.format !== 1 || record.taskId !== id || typeof record.plan?.title !== 'string' || record.plan.title.length > 16000 || metadata.bodyHash !== await hash(plan.slice(match[0].length))) return { delivery: 'inspect' }
    const title = record.plan.title
    if (ready === undefined) return { title, delivery: record.delivery ? 'inspect' : 'missing' }
    if (new TextEncoder().encode(ready).length > 128 * 1024) return { title, delivery: 'inspect' }
    const readyHash = await hash(ready)
    return { title, delivery: record.delivery?.readyHash === readyHash ? 'current' : !record.delivery && record.previousReadyHash === readyHash ? 'historical' : 'inspect' }
  } catch { return { delivery: 'inspect' } }
}
