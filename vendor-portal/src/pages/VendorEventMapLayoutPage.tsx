import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

/**
 * Vendor Event Map Layout (Read-only preview + booth selection)
 * + Zoom controls (– / + / Fit / %)
 * - Loads diagram from API (auth) and caches to localStorage
 * - Falls back to localStorage key used by editor: `vendorconnect:diagram:${eventId}`
 * - Supports multi-level layouts
 * - No debug UI
 */

type BoothStatus = "available" | "pending" | "reserved" | "assigned" | "blocked" | "booked" | string;

type Booth = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  price?: number;
  category?: string;
  status?: BoothStatus;
  vendorId?: string | null;
};

type MapElementType = "venue" | "street" | "stage" | "entrance" | "restrooms" | "info" | "foodcourt";

type MapElement = {
  id: string;
  type: MapElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
};

type DiagramDoc = {
  booths?: Booth[]; // legacy
  canvas?: { width: number; height: number; gridSize: number };
  levels?: Array<{ id: string; name: string; booths: Booth[]; elements?: MapElement[] }>;
};

type DiagramResponse = {
  event_id: number | string;
  version: number;
  diagram: DiagramDoc;
  updated_at?: string;
};

const API_URL = (import.meta as any).env?.VITE_API_URL?.toString() || "http://localhost:8002";

function safeJsonParse<T = any>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function getToken(): string | null {
  return (
    localStorage.getItem("access_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("jwt") ||
    null
  );
}

function lsDiagramKey(eventId: string | number) {
  return `vendorconnect:diagram:${eventId}`;
}

function boothIsSelectable(b: Booth) {
  const s = String(b.status ?? "available").toLowerCase();
  if (!b.status) return true;
  return s === "available";
}

function statusDot(status?: string) {
  const s = String(status ?? "available").toLowerCase();
  if (s === "pending") return "#f59e0b";
  if (s === "assigned" || s === "booked") return "#ef4444";
  if (s === "reserved") return "#fb923c";
  if (s === "blocked") return "#111827";
  return "#10b981";
}

function elementStyle(type: MapElementType) {
  switch (type) {
    case "venue":
      return { bg: "rgba(99, 102, 241, 0.10)", border: "2px dashed rgba(99,102,241,0.55)" };
    case "street":
      return { bg: "rgba(107,114,128,0.18)", border: "2px solid rgba(107,114,128,0.35)" };
    case "stage":
      return { bg: "rgba(168,85,247,0.14)", border: "2px solid rgba(168,85,247,0.40)" };
    case "entrance":
      return { bg: "rgba(16,185,129,0.12)", border: "2px solid rgba(16,185,129,0.35)" };
    case "restrooms":
      return { bg: "rgba(59,130,246,0.12)", border: "2px solid rgba(59,130,246,0.35)" };
    case "info":
      return { bg: "rgba(234,179,8,0.14)", border: "2px solid rgba(234,179,8,0.38)" };
    case "foodcourt":
      return { bg: "rgba(244,63,94,0.12)", border: "2px solid rgba(244,63,94,0.34)" };
    default:
      return { bg: "rgba(107,114,128,0.10)", border: "2px solid rgba(107,114,128,0.25)" };
  }
}

async function apiFetch(path: string, init?: RequestInit) {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as any),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

async function loadDiagramFromApi(eventId: string): Promise<DiagramResponse | null> {
  const candidates = [
    `/vendor/events/${encodeURIComponent(eventId)}/diagram`,
    `/events/${encodeURIComponent(eventId)}/diagram`,
    `/organizer/events/${encodeURIComponent(eventId)}/diagram`,
  ];

  for (const path of candidates) {
    try {
      const res = await apiFetch(path, { method: "GET" });
      if (res.status === 404) continue;
      if (!res.ok) continue;
      const data = (await res.json()) as DiagramResponse;
      if (data?.diagram) return data;
    } catch {
      // try next
    }
  }
  return null;
}

function loadDiagramFromLocal(eventId: string): DiagramResponse | null {
  const raw = localStorage.getItem(lsDiagramKey(eventId));
  const parsed = safeJsonParse<DiagramResponse>(raw);
  if (parsed?.diagram) return parsed;

  // legacy fallback
  const eventKey = `event_${eventId}`;
  const eventObj = safeJsonParse<any>(localStorage.getItem(eventKey));
  if (eventObj?.boothLayout) {
    const gridWidth = Number(eventObj.boothLayout.gridWidth || 1200);
    const gridHeight = Number(eventObj.boothLayout.gridHeight || 800);
    const booths = Array.isArray(eventObj.boothLayout.booths) ? eventObj.boothLayout.booths : [];
    return {
      event_id: eventId,
      version: 1,
      diagram: {
        canvas: { width: gridWidth, height: gridHeight, gridSize: Number(eventObj.boothLayout.gridSize || 20) },
        levels: [{ id: "level-1", name: "Level 1", booths }],
      },
      updated_at: new Date().toISOString(),
    };
  }

  return null;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function VendorEventMapLayoutPage() {
  const navigate = useNavigate();
  const { eventId } = useParams<{ eventId: string }>();
  const location = useLocation();

  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const appId = query.get("appId") || "";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [source, setSource] = useState<"api" | "localStorage" | "none">("none");
  const [diagram, setDiagram] = useState<DiagramDoc | null>(null);

  const [levelId, setLevelId] = useState<string>("level-1");
  const [selectedBoothId, setSelectedBoothId] = useState<string | null>(null);

  // ✅ Zoom
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const levels = useMemo(() => {
    const lvls = diagram?.levels?.length
      ? diagram.levels
      : [{ id: "level-1", name: "Level 1", booths: diagram?.booths ?? [], elements: [] }];
    return lvls.map((l) => ({
      id: String(l.id),
      name: l.name || String(l.id),
      booths: Array.isArray(l.booths) ? l.booths : [],
      elements: Array.isArray((l as any).elements) ? (l as any).elements : [],
    }));
  }, [diagram]);

  useEffect(() => {
    if (!levels.length) return;
    const exists = levels.some((l) => l.id === levelId);
    if (!exists) setLevelId(levels[0].id);
  }, [levels, levelId]);

  const activeLevel = useMemo(() => levels.find((l) => l.id === levelId) || levels[0], [levels, levelId]);

  const canvas = diagram?.canvas || { width: 1200, height: 800, gridSize: 20 };
  const canvasW = Number(canvas.width || 1200);
  const canvasH = Number(canvas.height || 800);
  const gridSize = Number(canvas.gridSize || 20);

  const selectedBooth = useMemo(() => {
    if (!selectedBoothId) return null;
    return activeLevel?.booths?.find((b) => String(b.id) === selectedBoothId) || null;
  }, [activeLevel, selectedBoothId]);

  async function load() {
    if (!eventId) return;

    setLoading(true);
    setLoadError(null);
    setSelectedBoothId(null);

    const apiResp = await loadDiagramFromApi(eventId);
    if (apiResp?.diagram) {
      setDiagram(apiResp.diagram);
      setSource("api");
      localStorage.setItem(lsDiagramKey(eventId), JSON.stringify(apiResp));
      setLoading(false);
      return;
    }

    const local = loadDiagramFromLocal(eventId);
    if (local?.diagram) {
      setDiagram(local.diagram);
      setSource("localStorage");
      setLoading(false);
      return;
    }

    setDiagram(null);
    setSource("none");
    setLoadError("Couldn't load a published layout for this event (API + localStorage fallback failed).");
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // ✅ Fit-to-view
  function fitToView() {
    const el = scrollRef.current;
    if (!el) return;
    const pad = 24;
    const availW = Math.max(200, el.clientWidth - pad);
    const availH = Math.max(200, el.clientHeight - pad);
    const z = Math.min(availW / canvasW, availH / canvasH);
    setZoom(Number(clamp(z, 0.35, 2).toFixed(2)));
  }

  // Re-fit on first successful load
  useEffect(() => {
    if (!loading && !loadError && diagram) {
      setTimeout(() => fitToView(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loadError, diagram, canvasW, canvasH]);

  if (!eventId) {
    return (
      <div className="p-6">
        <div className="text-xl font-bold">Missing eventId</div>
        <button className="mt-4 rounded-xl bg-black px-4 py-2 text-white" onClick={() => navigate("/vendor/dashboard")}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  const canContinue = !!selectedBooth && boothIsSelectable(selectedBooth);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-gray-600">Vendor Portal</div>
            <h1 className="text-[38px] font-extrabold leading-tight text-gray-900">Event {eventId} Map Layout</h1>
            <div className="mt-2 text-[15px] font-semibold text-gray-600">
              Read-only layout preview. Select a booth (if available) before continuing.
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              className="rounded-2xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-100"
              onClick={() => navigate(`/vendor/events/${eventId}/requirements${appId ? `?appId=${encodeURIComponent(appId)}` : ""}`)}
            >
              Back to Requirements
            </button>

            <button
              className="rounded-2xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black"
              onClick={() => navigate(`/vendor/events/${eventId}${appId ? `?appId=${encodeURIComponent(appId)}` : ""}`)}
            >
              Back to Event
            </button>

            <button
              className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!canContinue}
              onClick={() =>
                navigate(
                  `/vendor/events/${eventId}/apply?` +
                    new URLSearchParams({
                      ...(appId ? { appId } : {}),
                      ...(selectedBoothId ? { boothId: selectedBoothId } : {}),
                    }).toString()
                )
              }
              title={!selectedBoothId ? "Select a booth to continue" : !canContinue ? "This booth is not available" : undefined}
            >
              Continue to Application
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Layout */}
          <div className="lg:col-span-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-base font-extrabold text-gray-900">Layout</div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* ✅ Zoom controls */}
                  <button
                    className="rounded-2xl border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-100"
                    onClick={() => setZoom((z) => clamp(Number((z - 0.1).toFixed(2)), 0.35, 2))}
                    title="Zoom out"
                  >
                    −
                  </button>

                  <div className="min-w-[64px] text-center text-sm font-extrabold text-gray-900">
                    {Math.round(zoom * 100)}%
                  </div>

                  <button
                    className="rounded-2xl border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-100"
                    onClick={() => setZoom((z) => clamp(Number((z + 0.1).toFixed(2)), 0.35, 2))}
                    title="Zoom in"
                  >
                    +
                  </button>

                  <button
                    className="rounded-2xl border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-100"
                    onClick={fitToView}
                    title="Fit to view"
                  >
                    Fit
                  </button>

                  {levels.length > 1 && (
                    <select
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700"
                      value={levelId}
                      onChange={(e) => {
                        setLevelId(e.target.value);
                        setSelectedBoothId(null);
                      }}
                    >
                      {levels.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  )}

                  <span className="hidden sm:inline text-xs font-semibold text-gray-500">Source: {source}</span>
                </div>
              </div>

              {loading ? (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-sm font-semibold text-gray-700">
                  Loading layout…
                </div>
              ) : loadError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-6">
                  <div className="text-base font-extrabold text-rose-800">Couldn't load map</div>
                  <div className="mt-1 text-sm font-semibold text-rose-700">{loadError}</div>
                  <button
                    className="mt-4 rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                    onClick={load}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-gray-200 bg-white">
                  <div ref={scrollRef} className="h-[520px] w-full overflow-auto">
                    <div
                      className="relative"
                      style={{
                        width: canvasW * zoom,
                        height: canvasH * zoom,
                        backgroundImage: `linear-gradient(to right, rgba(229,231,235,0.9) 1px, transparent 1px),
                                          linear-gradient(to bottom, rgba(229,231,235,0.9) 1px, transparent 1px)`,
                        backgroundSize: `${gridSize * zoom}px ${gridSize * zoom}px`,
                        backgroundPosition: "0 0",
                      }}
                    >
                      {(activeLevel?.elements || []).map((el: MapElement) => {
                        const st = elementStyle(el.type);
                        return (
                          <div
                            key={el.id}
                            className="absolute rounded-2xl"
                            style={{
                              left: el.x * zoom,
                              top: el.y * zoom,
                              width: el.width * zoom,
                              height: el.height * zoom,
                              background: st.bg,
                              border: st.border,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              pointerEvents: "none",
                              padding: 10,
                              boxSizing: "border-box",
                            }}
                          >
                            <div className="text-center text-sm font-extrabold leading-tight text-gray-900">
                              {el.label || el.type}
                            </div>
                          </div>
                        );
                      })}

                      {(activeLevel?.booths || []).map((b: Booth) => {
                        const selectable = boothIsSelectable(b);
                        const selected = selectedBoothId === String(b.id);

                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => selectable && setSelectedBoothId(String(b.id))}
                            disabled={!selectable}
                            className="absolute rounded-2xl text-left"
                            style={{
                              left: b.x * zoom,
                              top: b.y * zoom,
                              width: b.width * zoom,
                              height: b.height * zoom,
                              background: selectable ? "rgba(16,185,129,0.10)" : "rgba(107,114,128,0.10)",
                              border: selected ? "3px solid #111827" : `2px solid ${selectable ? "rgba(16,185,129,0.45)" : "rgba(107,114,128,0.30)"}`,
                              boxShadow: selected ? "0 10px 26px rgba(0,0,0,0.18)" : "none",
                              cursor: selectable ? "pointer" : "not-allowed",
                              padding: 10,
                              boxSizing: "border-box",
                              overflow: "hidden",
                            }}
                            title={!selectable ? "Not available" : "Select booth"}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="text-sm font-extrabold text-gray-900">{b.label || "Booth"}</div>
                              <div
                                style={{
                                  width: 10,
                                  height: 10,
                                  borderRadius: 999,
                                  background: statusDot(String(b.status ?? "available")),
                                  flexShrink: 0,
                                  marginTop: 2,
                                }}
                              />
                            </div>

                            <div className="mt-1 text-xs font-bold text-gray-700">
                              {b.category || "Standard"}
                              {typeof b.price === "number" ? ` • $${b.price}` : ""}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Selected Booth */}
          <div>
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="text-base font-extrabold text-gray-900">Selected Booth</div>
              <div className="mt-1 text-sm font-semibold text-gray-600">
                Click an available booth on the map to select it.
              </div>

              {!selectedBooth ? (
                <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-700">
                  No booth selected yet.
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <div className="text-xl font-extrabold text-gray-900">{selectedBooth.label || "Booth"}</div>

                    <div className="mt-2 text-sm font-semibold text-gray-700">
                      Category: <span className="font-extrabold">{selectedBooth.category || "Standard"}</span>
                    </div>

                    {typeof selectedBooth.price === "number" ? (
                      <div className="mt-1 text-sm font-semibold text-gray-700">
                        Price: <span className="font-extrabold">${selectedBooth.price}</span>
                      </div>
                    ) : null}

                    <div className="mt-1 text-sm font-semibold text-gray-700">
                      Status: <span className="font-extrabold">{String(selectedBooth.status ?? "available")}</span>
                    </div>

                    <div className="mt-1 text-sm font-semibold text-gray-700">
                      Size:{" "}
                      <span className="font-extrabold">
                        {Math.round(selectedBooth.width)}×{Math.round(selectedBooth.height)}
                      </span>
                    </div>
                  </div>

                  {!boothIsSelectable(selectedBooth) ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                      This booth isn’t available. Select an “Available” booth to continue.
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
