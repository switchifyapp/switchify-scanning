export class Interval {
  private elapsedMs = 0;

  elapsed(deltaMs: number, periodMs: number): boolean {
    const period = Math.max(1, periodMs);
    this.elapsedMs += deltaMs;
    if (this.elapsedMs < period) return false;
    this.elapsedMs %= period;
    return true;
  }

  reset(): void {
    this.elapsedMs = 0;
  }
}
