// src/utils/applicationId.ts

export function resolveApplicationId(value: any): string {
  const candidates = [
    value?.id,
    value?.application?.id,
    value?.applicationId,
    value?.appId,
    value,
  ];

  for (const candidate of candidates) {
    const s = String(candidate ?? "").trim();
    if (!s) continue;
    if (s === "[object Object]" || s === "undefined" || s === "null") continue;
    if (/^\d+$/.test(s)) return s;
  }

  return "";
}

export function getAppIdFromSearch(
  search:
    | URLSearchParams
    | { get(name: string): string | null }
): string {
  const raw =
    search.get("appId") ||
    search.get("applicationId") ||
    search.get("appld") || // legacy typo
    "";

  return resolveApplicationId(raw);
}

export function buildAppUrl(
  pathname: string,
  appId?: any,
  extraParams?: Record<string, string | number | boolean | null | undefined>
): string {
  const params = new URLSearchParams();

  const resolvedAppId = resolveApplicationId(appId);
  if (resolvedAppId) params.set("appId", resolvedAppId);

  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      if (value === undefined || value === null || value === "") continue;
      params.set(key, String(value));
    }
  }

  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}



