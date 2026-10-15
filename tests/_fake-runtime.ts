import type { ReactiveRuntime, ReadAccessor, Setter } from "../ports/reactive.ts"

/** A pure, dependency-free reactive runtime: the same shape gnim supplies. */
export function fakeRuntime(): ReactiveRuntime {
  return {
    createState<T>(initial: T): [ReadAccessor<T>, Setter<T>] {
      let value = initial
      const get = Object.assign(() => value, { peek: () => value }) as ReadAccessor<T>
      const set: Setter<T> = (next) => {
        value = next
      }
      return [get, set]
    },
  }
}
