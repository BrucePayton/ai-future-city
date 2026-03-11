/**
 * In-memory state for assistant list filtering: hidden (deleted) and delisted ids.
 */

export class HiddenAssistantIds {
  private readonly ids = new Set<string>();

  add(id: string): void {
    this.ids.add(id);
  }

  remove(id: string): void {
    this.ids.delete(id);
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  getAll(): string[] {
    return [...this.ids];
  }

  clear(): void {
    this.ids.clear();
  }

  loadFromSnapshot(ids: string[]): void {
    this.ids.clear();
    for (const id of ids) {
      this.ids.add(id);
    }
  }
}

export class DelistedAssistantIds {
  private readonly ids = new Set<string>();

  add(id: string): void {
    this.ids.add(id);
  }

  remove(id: string): void {
    this.ids.delete(id);
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  getAll(): string[] {
    return [...this.ids];
  }

  clear(): void {
    this.ids.clear();
  }

  loadFromSnapshot(ids: string[]): void {
    this.ids.clear();
    for (const id of ids) {
      this.ids.add(id);
    }
  }
}
