/**
 * A stand-in for an object that does not exist yet and may be replaced later.
 *
 * Tools are registered before the MCP handshake, but the stores they query can
 * only be opened once the project root is known (it may come from the client's
 * `roots/list`, and change with `roots/list_changed`). Tools receive `ref`,
 * which forwards every property read and method call to whatever target is
 * currently bound, so they never hold a store that has been closed.
 */
export class LateBound<T extends object> {
  private target?: T;
  private readonly name: string;

  /** Hand this out in place of the real object. */
  readonly ref: T;

  constructor(name: string) {
    this.name = name;
    this.ref = new Proxy({} as T, {
      get: (_placeholder, property) => {
        const target = this.requireTarget();
        const value = Reflect.get(target, property, target) as unknown;
        // Bind methods to the real object: its private state lives there, not on the proxy.
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  }

  get isBound(): boolean {
    return this.target !== undefined;
  }

  bind(target: T): void {
    this.target = target;
  }

  unbind(): void {
    this.target = undefined;
  }

  private requireTarget(): T {
    if (!this.target) throw new Error(`${this.name} is not available: no project is open`);
    return this.target;
  }
}
