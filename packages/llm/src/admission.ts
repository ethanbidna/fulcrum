const MAX_WAITERS = 16;
interface Waiter { resolve(release: () => void): void; reject(error: unknown): void; signal: AbortSignal; abort(): void }
class Admission {
  private busy = false;
  private waiting: Waiter[] = [];
  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (!this.busy) { this.busy = true; return Promise.resolve(() => this.release()); }
    if (this.waiting.length >= MAX_WAITERS) return Promise.reject(new Error('LOCAL_MODEL_BUSY'));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal, abort: () => {
        this.waiting = this.waiting.filter(value => value !== waiter); reject(signal.reason);
      } };
      this.waiting.push(waiter); signal.addEventListener('abort', waiter.abort, { once: true });
    });
  }
  private release(): void {
    const next = this.waiting.shift();
    if (!next) { this.busy = false; return; }
    next.signal.removeEventListener('abort', next.abort);
    next.resolve(() => this.release());
  }
}
const endpoints = new Map<string, Admission>();
export function modelAdmission(endpoint: string): Admission {
  let admission = endpoints.get(endpoint);
  if (!admission) { admission = new Admission(); endpoints.set(endpoint, admission); }
  return admission;
}
