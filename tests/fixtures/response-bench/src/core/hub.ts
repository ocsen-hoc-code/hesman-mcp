// Shared helpers used by every feature module: the hub is called from many places.
export function hub(value: number): number {
  return value * 2;
}

export class Registry {
  private names: string[] = [];

  register(name: string): void {
    this.names.push(name);
  }

  count(): number {
    return this.names.length;
  }
}
