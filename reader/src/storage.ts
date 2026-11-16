// Everything the reader keeps lives in localStorage on the iPad, like the Kindle's own files.
// Every profile mount shares one origin, so each key is namespaced by the mount the reader was
// opened from: "root" for <server>/read/, "p:<id>" for <server>/p/<id>/read/. Storage can be full,
// blocked or missing (private browsing); the reader then keeps going in memory.

export interface KV {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
  keys(): string[]
}

export const PREFIX = 'eek.'

export function memoryKV(): KV {
  const m = new Map<string, string>()
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
    keys: () => [...m.keys()],
  }
}

/** localStorage, with every call guarded; falls back to memory when it cannot be used at all. */
export function browserKV(): KV {
  let ls: Storage | null
  try {
    ls = window.localStorage
    const probe = `${PREFIX}probe`
    ls.setItem(probe, '1')
    ls.removeItem(probe)
  } catch {
    ls = null
  }
  if (!ls) return memoryKV()
  const store = ls
  const shadow = memoryKV()
  return {
    get: (k) => {
      try {
        return store.getItem(k) ?? shadow.get(k)
      } catch {
        return shadow.get(k)
      }
    },
    set: (k, v) => {
      try {
        store.setItem(k, v)
        shadow.remove(k)
      } catch {
        // Full: keep it for this session at least.
        shadow.set(k, v)
      }
    },
    remove: (k) => {
      try {
        store.removeItem(k)
      } catch {
        // ignore
      }
      shadow.remove(k)
    },
    keys: () => {
      const out = new Set(shadow.keys())
      try {
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i)
          if (k) out.add(k)
        }
      } catch {
        // ignore
      }
      return [...out]
    },
  }
}

/** The namespace for a reader page's path: "p:<id>" under /p/<id>/, else "root". */
export function namespaceFor(pathname: string): string {
  const m = /^\/p\/([a-z0-9-]+)\//.exec(pathname)
  return m ? `p:${m[1]}` : 'root'
}

/** One profile's keys. */
export class Store {
  readonly kv: KV
  readonly ns: string
  constructor(kv: KV, ns: string) {
    this.kv = kv
    this.ns = ns
  }

  private key(k: string): string {
    return `${PREFIX}${this.ns}.${k}`
  }

  get<T>(k: string, fallback: T): T {
    const raw = this.kv.get(this.key(k))
    if (raw === null) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }

  set(k: string, value: unknown): void {
    if (value === undefined || value === null) this.kv.remove(this.key(k))
    else this.kv.set(this.key(k), JSON.stringify(value))
  }

  remove(k: string): void {
    this.kv.remove(this.key(k))
  }

  /** Forget everything of this profile (the server now serves a different child's paper here). */
  clear(): void {
    const prefix = this.key('')
    for (const k of this.kv.keys()) if (k.startsWith(prefix)) this.kv.remove(k)
  }
}

/** One random id for this iPad, shared by every profile (it is the device, not the child). */
export function deviceId(kv: KV, make: () => string): string {
  const k = `${PREFIX}device_id`
  const have = kv.get(k)
  if (have && /^[\w-]{8,128}$/.test(have)) return have
  const id = make()
  kv.set(k, id)
  return id
}

/** A random UUID, with a fallback for browsers without crypto.randomUUID (plain HTTP on older iPadOS). */
export function uuid(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch {
      // not a secure context
    }
  }
  const b = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
