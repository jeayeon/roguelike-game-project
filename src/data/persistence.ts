import type { PermanentUpgradeId } from '../types/game';

export type GameSettings = {
  musicVolume: number;
  effectsVolume: number;
};

export type RogueliteProgress = {
  version: 1;
  ashes: number;
  permanentUpgrades: Partial<Record<PermanentUpgradeId, number>>;
  settings: GameSettings;
};

const STORAGE_KEY = 'abyssal-forge-progress-v1';
const LEGACY_STORAGE_KEYS = ['ash-return-roguelite-progress-v1'];

export const DEFAULT_SETTINGS: GameSettings = {
  musicVolume: 0.65,
  effectsVolume: 0.75,
};

const clampVolume = (value: unknown, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback
);

export const loadRogueliteProgress = (): RogueliteProgress => {
  const fallback: RogueliteProgress = {
    version: 1,
    ashes: 0,
    permanentUpgrades: {},
    settings: { ...DEFAULT_SETTINGS },
  };
  try {
    let raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacyProgress = LEGACY_STORAGE_KEYS
        .map((key) => window.localStorage.getItem(key))
        .find((value): value is string => Boolean(value));
      if (legacyProgress) {
        raw = legacyProgress;
        window.localStorage.setItem(STORAGE_KEY, legacyProgress);
      }
    }
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<RogueliteProgress>;
    return {
      version: 1,
      ashes: typeof parsed.ashes === 'number' && Number.isFinite(parsed.ashes)
        ? Math.max(0, Math.floor(parsed.ashes))
        : 0,
      permanentUpgrades: parsed.permanentUpgrades && typeof parsed.permanentUpgrades === 'object'
        ? parsed.permanentUpgrades
        : {},
      settings: {
        musicVolume: clampVolume(parsed.settings?.musicVolume, DEFAULT_SETTINGS.musicVolume),
        effectsVolume: clampVolume(parsed.settings?.effectsVolume, DEFAULT_SETTINGS.effectsVolume),
      },
    };
  } catch {
    return fallback;
  }
};

export const saveRogueliteProgress = (progress: RogueliteProgress): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // 저장 공간이 차거나 브라우저 저장이 차단된 경우에도 게임은 계속 진행한다.
  }
};

export const clearRogueliteProgress = (): void => {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    LEGACY_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // 브라우저 저장이 차단된 경우 메모리 상태 초기화만 수행한다.
  }
};
