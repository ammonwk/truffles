export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  exiting?: boolean;
}

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
const listeners = new Set<Listener>();
let nextId = 1;

function notify() {
  for (const fn of listeners) {
    fn([...toasts]);
  }
}

export function addToast(message: string, variant: ToastVariant = 'info') {
  const id = String(nextId++);
  toasts = [...toasts, { id, message, variant }];
  notify();

  // Auto-dismiss after 5s
  setTimeout(() => dismissToast(id), 5000);
}

export function dismissToast(id: string) {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx === -1) return;

  // Mark as exiting for animation
  toasts = toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t));
  notify();

  // Remove after exit animation
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, 250);
}

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
