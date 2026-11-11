export interface SystemSample {
  awake: boolean; wakeGeneration: number; power: 'ac' | 'battery' | 'unknown'; batteryPercent: number | null;
  thermal: 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown'; availableMemoryBytes: number | null;
  architecture: 'intel' | 'apple_silicon';
}
export interface BackgroundSettings {
  paused: boolean; presenting: boolean; onlyWhenPluggedIn: boolean; batteryOverride: boolean;
  intelBatteryMinimum: number; siliconBatteryMinimum: number; modelBytes: number | null;
  memoryMultiplier: number; intelBatchIntervalMs: number; wakeGraceMs: number; signalTimeoutMs: number;
}
export type WorkPhase = 'sources' | 'extraction';
const DEFAULTS: BackgroundSettings = {
  paused: false, presenting: false, onlyWhenPluggedIn: false, batteryOverride: false,
  intelBatteryMinimum: 50, siliconBatteryMinimum: 30, modelBytes: null,
  memoryMultiplier: 1.5, intelBatchIntervalMs: 120_000, wakeGraceMs: 60_000, signalTimeoutMs: 15_000,
};
const BOOLEAN_SETTINGS = ['paused', 'presenting', 'onlyWhenPluggedIn', 'batteryOverride'];
export class BackgroundPolicy {
  private settings: BackgroundSettings = { ...DEFAULTS };
  private sample: SystemSample | undefined;
  private observedAt: number | undefined;
  private wakeUntil = 0;
  private nextBatchAt = 0;
  constructor(settings: Partial<BackgroundSettings> = {}, private readonly unavailableReason?: string) { this.configure(settings); }
  configure(input: Partial<BackgroundSettings>): void {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_BACKGROUND_SETTING');
    for (const [key, value] of Object.entries(input)) {
      if (!Object.hasOwn(DEFAULTS, key)) throw new Error('INVALID_BACKGROUND_SETTING');
      if (BOOLEAN_SETTINGS.includes(key)) { if (typeof value !== 'boolean') throw new Error('INVALID_BACKGROUND_SETTING'); continue; }
      if (key === 'modelBytes' && value === null) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('INVALID_BACKGROUND_SETTING');
      if ((key.endsWith('BatteryMinimum') && value > 100) || (key === 'memoryMultiplier' && value < 1) || (['modelBytes', 'signalTimeoutMs'].includes(key) && value === 0)) throw new Error('INVALID_BACKGROUND_SETTING');
    }
    this.settings = { ...this.settings, ...input };
  }
  observe(value: SystemSample, now: number): void {
    validateSystemSample(value);
    if (value.awake && (value.wakeGeneration !== this.sample?.wakeGeneration || !this.sample?.awake || this.observedAt === undefined || now - this.observedAt > this.settings.signalTimeoutMs)) this.wakeUntil = now + this.settings.wakeGraceMs;
    this.sample = { ...value }; this.observedAt = now;
  }
  started(now: number): void { this.nextBatchAt = now + (this.sample?.architecture === 'intel' ? this.settings.intelBatchIntervalMs : 0); }
  reason(now: number, phase: WorkPhase): string | null {
    if (this.unavailableReason) return this.unavailableReason;
    if (this.settings.paused) return 'Local ingestion paused by user';
    if (!this.sample || this.observedAt === undefined || now < this.observedAt || now - this.observedAt > this.settings.signalTimeoutMs) return 'Local ingestion paused — system signals unavailable';
    if (!this.sample.awake) return 'Local ingestion paused — this Mac is asleep';
    if (now < this.wakeUntil) return 'Local ingestion paused — waiting after wake';
    if (this.settings.presenting) return 'Local ingestion paused — presenting';
    if (['unknown', 'serious', 'critical'].includes(this.sample.thermal)) return 'Local ingestion paused — thermal state';
    if (this.sample.power === 'unknown') return 'Local ingestion paused — power state unavailable';
    if (this.settings.onlyWhenPluggedIn && this.sample.power !== 'ac') return 'Local ingestion paused — only when plugged in';
    const minimum = this.sample.architecture === 'intel' ? this.settings.intelBatteryMinimum : this.settings.siliconBatteryMinimum;
    if (this.sample.power === 'battery' && !this.settings.batteryOverride && (this.sample.batteryPercent === null || this.sample.batteryPercent < minimum)) return 'Local ingestion paused — on battery';
    if (phase === 'sources') return null;
    if (!this.settings.modelBytes) return 'Local AI paused — model resource profile unavailable';
    if (this.sample.availableMemoryBytes === null || this.sample.availableMemoryBytes < this.settings.modelBytes * this.settings.memoryMultiplier) return 'Local AI paused — insufficient available memory';
    if (now < this.nextBatchAt) return 'Local AI paused — batch throttle';
    return null;
  }
  status(now: number) {
    return { settings: { ...this.settings }, sample: this.sample ? { ...this.sample } : null, observedAt: this.observedAt ?? null,
      sourcePause: this.reason(now, 'sources'), extractionPause: this.reason(now, 'extraction'), nextBatchAt: this.nextBatchAt };
  }
}
export function validateSystemSample(value: unknown): asserts value is SystemSample {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_SYSTEM_SAMPLE');
  const sample = value as Record<string, unknown>;
  const keys = ['awake', 'wakeGeneration', 'power', 'batteryPercent', 'thermal', 'availableMemoryBytes', 'architecture'];
  if (Object.keys(sample).length !== keys.length || Object.keys(sample).some(key => !keys.includes(key)) || typeof sample.awake !== 'boolean'
    || (typeof sample.power !== 'string' || !['ac', 'battery', 'unknown'].includes(sample.power)) || (typeof sample.thermal !== 'string' || !['nominal', 'fair', 'serious', 'critical', 'unknown'].includes(sample.thermal))
    || (typeof sample.architecture !== 'string' || !['intel', 'apple_silicon'].includes(sample.architecture))) throw new Error('INVALID_SYSTEM_SAMPLE');
  if (!Number.isSafeInteger(sample.wakeGeneration) || Number(sample.wakeGeneration) < 0) throw new Error('INVALID_SYSTEM_SAMPLE');
  if (sample.batteryPercent !== null && (typeof sample.batteryPercent !== 'number' || !Number.isFinite(sample.batteryPercent) || sample.batteryPercent < 0 || sample.batteryPercent > 100)) throw new Error('INVALID_SYSTEM_SAMPLE');
  if (sample.availableMemoryBytes !== null && (typeof sample.availableMemoryBytes !== 'number' || !Number.isSafeInteger(sample.availableMemoryBytes) || sample.availableMemoryBytes < 0)) throw new Error('INVALID_SYSTEM_SAMPLE');
}
