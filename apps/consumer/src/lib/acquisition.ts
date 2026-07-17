import type { OrderAcquisitionSnapshot } from '@greenhub/shared';

export const ACQUISITION_STORAGE_KEY = 'greenhub_acquisition';

const MAX_TAG_LENGTH = 128;
const SAFE_TAG_PATTERN = /^[\p{L}\p{N}._~-]+$/u;
const SAFE_LANDING_QUERY_KEYS = ['round'] as const;
const CARROT_SOURCE_VALUES = new Set(['carrot', 'daangn', '당근']);

export interface AcquisitionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface CaptureAcquisitionOptions {
  storage?: AcquisitionStorage | null;
  now?: () => Date;
}

function getBrowserStorage(): AcquisitionStorage | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readTag(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_TAG_LENGTH ||
    !SAFE_TAG_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function sanitizeLandingUrl(value: string): string | null {
  try {
    const source = new URL(value);
    if (
      (source.protocol !== 'https:' && source.protocol !== 'http:') ||
      source.username ||
      source.password
    ) {
      return null;
    }

    const landing = new URL(`${source.origin}${source.pathname}`);
    for (const key of SAFE_LANDING_QUERY_KEYS) {
      const safeValue = readTag(source.searchParams.get(key));
      if (safeValue) landing.searchParams.set(key, safeValue);
    }
    return landing.toString();
  } catch {
    return null;
  }
}

function isCapturedAt(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.includes('T') &&
    /(Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function readNullableStoredTag(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const safeValue = readTag(value);
  return safeValue ?? undefined;
}

function parseStoredSnapshot(value: unknown): OrderAcquisitionSnapshot | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const stored = value as Record<string, unknown>;
  if (stored.source !== 'carrot' || !isCapturedAt(stored.capturedAt)) return null;

  const campaign = readNullableStoredTag(stored.campaign);
  const content = readNullableStoredTag(stored.content);
  if (campaign === undefined || content === undefined) return null;

  let landingUrl: string | null = null;
  if (stored.landingUrl !== null && stored.landingUrl !== undefined) {
    if (typeof stored.landingUrl !== 'string') return null;
    landingUrl = sanitizeLandingUrl(stored.landingUrl);
    if (!landingUrl) return null;
  }

  return {
    source: 'carrot',
    campaign,
    content,
    landingUrl,
    capturedAt: stored.capturedAt,
  };
}

export function captureAcquisition(
  input?: string | URL,
  options: CaptureAcquisitionOptions = {},
): OrderAcquisitionSnapshot | null {
  const href = input?.toString() ?? (typeof window === 'undefined' ? null : window.location.href);
  if (!href) return null;

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const source = url.searchParams.get('utm_source')?.trim().toLowerCase();
  if (!source || !CARROT_SOURCE_VALUES.has(source)) return null;

  const landingUrl = sanitizeLandingUrl(url.toString());
  if (!landingUrl) return null;

  const snapshot: OrderAcquisitionSnapshot = {
    source: 'carrot',
    campaign: readTag(url.searchParams.get('utm_campaign')),
    content: readTag(url.searchParams.get('utm_content')),
    landingUrl,
    capturedAt: (options.now ?? (() => new Date()))().toISOString(),
  };

  const storage = options.storage === undefined ? getBrowserStorage() : options.storage;
  try {
    storage?.setItem(ACQUISITION_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {}

  return snapshot;
}

export function getAcquisitionSnapshot(
  storage: AcquisitionStorage | null = getBrowserStorage(),
): OrderAcquisitionSnapshot | null {
  if (!storage) return null;

  try {
    const raw = storage.getItem(ACQUISITION_STORAGE_KEY);
    if (!raw) return null;

    const snapshot = parseStoredSnapshot(JSON.parse(raw) as unknown);
    if (!snapshot) storage.removeItem(ACQUISITION_STORAGE_KEY);
    return snapshot;
  } catch {
    try {
      storage.removeItem(ACQUISITION_STORAGE_KEY);
    } catch {}
    return null;
  }
}

export function clearAcquisition(storage: AcquisitionStorage | null = getBrowserStorage()): void {
  try {
    storage?.removeItem(ACQUISITION_STORAGE_KEY);
  } catch {}
}
