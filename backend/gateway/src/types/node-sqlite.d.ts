/**
 * Minimal typings until @types/node ships `node:sqlite`.
 * @see https://nodejs.org/api/sqlite.html
 */
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string | URL | Buffer);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: unknown[]): void;
      all(...params: unknown[]): Record<string, unknown>[];
    };
    close(): void;
  }
}
