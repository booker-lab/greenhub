export function normalizeHubIds(hubIds?: unknown, hubId?: unknown): string[] | undefined {
  if (Array.isArray(hubIds)) {
    const values = hubIds.filter((value): value is string => typeof value === 'string' && !!value);
    return values.length ? Array.from(new Set(values)) : undefined;
  }
  return typeof hubId === 'string' && hubId ? [hubId] : undefined;
}
