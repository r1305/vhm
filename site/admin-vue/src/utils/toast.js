const listeners = new Set()

export function onToast(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function toast(message, type = 'info', duration = 8000) {
  listeners.forEach(fn => fn({ message, type, duration }))
}
