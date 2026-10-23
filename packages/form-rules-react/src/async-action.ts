import { cloneFrozenGraph } from "./immutable.js";

export type AsyncHostActionState = "idle" | "pending" | "success" | "error";

export interface AsyncHostActionSnapshot<TResult> {
  readonly state: AsyncHostActionState;
  readonly generation: number;
  readonly result: TResult | null;
  readonly error: string | null;
}

export interface AsyncHostActionOutcome<TResult> {
  applied: boolean;
  generation: number;
  result?: TResult;
  error?: string;
}

export interface AsyncHostActionController<TInput, TResult> {
  subscribe(callback: () => void): () => void;
  getSnapshot(): AsyncHostActionSnapshot<TResult>;
  run(input: TInput): Promise<AsyncHostActionOutcome<TResult>>;
  reset(): void;
  dispose(): void;
}

/**
 * Track one host-owned asynchronous action such as Draft Save or Submit.
 *
 * The controller deliberately owns no transport, retry, timeout, authentication or persistence
 * policy. Each run receives a monotonically increasing generation and only the latest generation
 * may publish success/error. A later run, reset, or dispose makes older completions stale.
 */
export function createAsyncHostActionController<TInput, TResult>(
  runner: (input: TInput, generation: number) => Promise<TResult>
): AsyncHostActionController<TInput, TResult> {
  let generation = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  let snapshot: AsyncHostActionSnapshot<TResult> = Object.freeze({
    state: "idle",
    generation,
    result: null,
    error: null
  });

  const assertLive = () => {
    if (disposed) {
      throw new Error("Async host action controller has been disposed.");
    }
  };

  const publish = () => {
    for (const callback of listeners) {
      callback();
    }
  };

  const supersede = () => {
    generation += 1;
    return generation;
  };

  return {
    subscribe(callback) {
      assertLive();
      listeners.add(callback);
      return () => listeners.delete(callback);
    },

    getSnapshot() {
      return snapshot;
    },

    async run(input) {
      assertLive();
      const requestGeneration = supersede();
      snapshot = Object.freeze({
        state: "pending",
        generation: requestGeneration,
        result: null,
        error: null
      });
      publish();

      try {
        const result = await runner(input, requestGeneration);
        if (disposed || requestGeneration !== generation) {
          return {
            applied: false,
            generation: requestGeneration,
            result
          };
        }
        const acceptedResult = cloneFrozenGraph(result);
        snapshot = Object.freeze({
          state: "success",
          generation: requestGeneration,
          result: acceptedResult,
          error: null
        });
        publish();
        return {
          applied: true,
          generation: requestGeneration,
          result: acceptedResult
        };
      } catch (caught) {
        const error = caught instanceof Error ? caught.message : String(caught);
        if (disposed || requestGeneration !== generation) {
          return {
            applied: false,
            generation: requestGeneration,
            error
          };
        }
        snapshot = Object.freeze({
          state: "error",
          generation: requestGeneration,
          result: null,
          error
        });
        publish();
        return {
          applied: true,
          generation: requestGeneration,
          error
        };
      }
    },

    reset() {
      assertLive();
      supersede();
      snapshot = Object.freeze({
        state: "idle",
        generation,
        result: null,
        error: null
      });
      publish();
    },

    dispose() {
      generation += 1;
      disposed = true;
      listeners.clear();
    }
  };
}
