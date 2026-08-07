declare module "bun:test" {
  export function afterEach(callback: () => void): void;
  export function describe(name: string, callback: () => void): void;
  export function test(name: string, callback: () => void | Promise<void>): void;
  export function expect(value: unknown): {
    toBe(expected: unknown): void;
    toBeCloseTo(expected: number, precision?: number): void;
    toEqual(expected: unknown): void;
    toHaveLength(expected: number): void;
    toThrow(expected?: string | RegExp): void;
  };
}
