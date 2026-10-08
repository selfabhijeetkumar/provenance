/**
 * Simple semaphore to cap concurrent Gemini LLM calls at 3.
 * Prevents rate-limit hammering on the local gateway.
 */
export class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.running < this.max) {
      this.running++;
      return this.release.bind(this);
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve(this.release.bind(this));
      });
    });
  }

  private release() {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }

  /** Run fn with concurrency cap applied. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** Global semaphore — Gemini concurrency cap = 3. */
export const geminiSemaphore = new Semaphore(3);
