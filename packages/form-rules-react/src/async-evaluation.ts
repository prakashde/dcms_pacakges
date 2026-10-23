import type { AsyncEvaluationState } from "./contracts.js";
import { cloneFrozenGraph } from "./immutable.js";

export interface AsyncEvaluationSnapshot<TResult> {
  readonly state: AsyncEvaluationState;
  readonly generation: number;
  readonly result: TResult | null;
  readonly error: string | null;
}

export interface AsyncEvaluationOutcome<TResult> {
  applied: boolean;
  generation: number;
  result?: TResult;
  error?: string;
}

export interface AsyncEvaluationController<TInput, TResult> {
  subscribe(callback: () => void): () => void;
  getSnapshot(): AsyncEvaluationSnapshot<TResult>;
  evaluate(input: TInput): Promise<AsyncEvaluationOutcome<TResult>>;
  invalidate(): void;
  dispose(): void;
}

/**
 * Keep only the latest asynchronous evaluation authoritative. The runner may be a Web Worker,
 * server request, or other host implementation; this package deliberately owns no transport.
 */
export function createAsyncEvaluationController<TInput, TResult>(
  runner: (input: TInput, generation: number) => Promise<TResult>
): AsyncEvaluationController<TInput, TResult> {
  let generation = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  let snapshot: AsyncEvaluationSnapshot<TResult> = Object.freeze({
    state: "idle",
    generation,
    result: null,
    error: null
  });

  const assertLive = () => {
    if (disposed)
      throw new Error("Async evaluation controller has been disposed.");
  };

  const publish = () => {
    for (const callback of listeners) callback();
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

    async evaluate(input) {
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
          state: "ready",
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
          ...snapshot,
          state: "error",
          generation: requestGeneration,
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

    invalidate() {
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
