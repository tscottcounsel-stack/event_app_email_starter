import React, { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "https://event-app-api-production-ccce.up.railway.app";

type EventRecord = {
  id?: number | string;
  title?: string;
  name?: string;
  event_name?: string;
  city?: string;
  state?: string;
  location?: string;
  venue_name?: string;
  start_date?: string | null;
  end_date?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  published?: boolean | null;
  is_published?: boolean | null;
  active?: boolean | null;
  is_active?: boolean | null;
  status?: string | null;
  applications_count?: number | null;
  application_count?: number | null;
  vendors_count?: number | null;
  booth_count?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: any;
};

function toList(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function cardStyle(background = "#ffffff"): React.CSSProperties {
  return {
    background,
    border: "1px solid #d9e2f1",
    borderRadius: 20,
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
  };
}

function buttonStyle(kind: "primary" | "secondary" | "ghost"): React.CSSProperties {
  if (kind === "primary") {
    return {
      border: "none",
      borderRadius: 12,
      padding: "10px 14px",
      fontWeight: 800,
      fontSize: 14,
      cursor: "pointer",
      background: "linear-gradient(135deg, #312e81 0%, #6d28d9 100%)",
      color: "#ffffff",
    };
  }

  if (kind === "secondary") {
    return {
      border: "1px solid #cbd5e1",
      borderRadius: 12,
      padding: "10px 14px",
      fontWeight: 800,
      fontSize: 14,
      cursor: "pointer",
      background: "#ffffff",
      color: "#0f172a",
    };
  }

  return {
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "8px 12px",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    background: "#f8fafc",
    color: "#334155",
  };
}

function statusPill(text: string, tone: "warning" | "success" | "neutral" | "danger"): React.CSSProperties {
  const map = {
    warning: {
      background: "#fff7ed",
      color: "#9a3412",
      border: "1px solid #fdba74",
    },
    success: {
      background: "#ecfdf5",
      color: "#166534",
      border: "1px solid #86efac",
    },
    neutral: {
      background: "#f8fafc",
      color: "#334155",
      border: "1px solid #cbd5e1",
    },
    danger: {
      background: "#fef2f2",
      color: "#991b1b",
      border: "1px solid #fca5a5",
    },
  } as const;

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 88,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.2,
    textTransform: "uppercase",
    ...map[tone],
  };
}

function getEventTitle(event: EventRecord): string {
  return (
    event.title ||
    event.name ||
    event.event_name ||
    `Event #${event.id ?? "—"}`
  );
}

function getEventPlace(event: EventRecord): string {
  const cityState =
    [event.city, event.state].filter(Boolean).join(", ") ||
    event.location ||
    event.venue_name ||
    "Location not set";

  return cityState;
}

function pickDate(event: EventRecord): { start?: string | null; end?: string | null } {
  return {
    start: event.start_date || event.starts_at || null,
    end: event.end_date || event.ends_at || null,
  };
}

function formatDateRange(event: EventRecord): string {
  const { start, end } = pickDate(event);
  if (!start && !end) return "Dates not set";

  const startDt = start ? new Date(start) : null;
  const endDt = end ? new Date(end) : null;

  const validStart = startDt && !Number.isNaN(startDt.getTime()) ? startDt : null;
  const validEnd = endDt && !Number.isNaN(endDt.getTime()) ? endDt : null;

  if (validStart && validEnd) {
    return `${validStart.toLocaleDateString()} – ${validEnd.toLocaleDateString()}`;
  }
  if (validStart) return validStart.toLocaleDateString();
  if (validEnd) return validEnd.toLocaleDateString();

  return [start, end].filter(Boolean).join(" – ");
}

function deriveStatus(event: EventRecord): { label: string; tone: "warning" | "success" | "neutral" | "danger" } {
  const raw = String(event.status || "").trim().toLowerCase();
  const published = event.published ?? event.is_published;
  const active = event.active ?? event.is_active;

  if (raw === "disabled" || active === false) {
    return { label: "disabled", tone: "danger" };
  }
  if (raw === "draft") {
    return { label: "draft", tone: "neutral" };
  }
  if (raw === "live" || raw === "published") {
    return { label: raw, tone: "success" };
  }
  if (published === true && active !== false) {
    return { label: "live", tone: "success" };
  }
  if (published === false) {
    return { label: "draft", tone: "neutral" };
  }
  return { label: raw || "unknown", tone: "warning" };
}

function getApplicationsCount(event: EventRecord): number {
  const direct =
    event.applications_count ??
    event.application_count ??
    event.vendors_count ??
    0;

  const num = Number(direct || 0);
  return Number.isFinite(num) ? num : 0;
}

export default function AdminEventsPage() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "live" | "draft" | "disabled">("all");
  const [copiedId, setCopiedId] = useState("");

  const loadEvents = useCallback(async (soft = false) => {
    try {
      if (soft) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError("");

      const res = await fetch(`${API_BASE}/events`);
      const data = await res.json().catch(() => []);

      if (!res.ok) {
        throw new Error(
          (data && (data.detail || data.message)) ||
            "Failed to load events."
        );
      }

      const next = toList(data).filter((item) => item && typeof item === "object");
      setEvents(next as EventRecord[]);
    } catch (err: any) {
      setError(err?.message || "Failed to load events.");
      setEvents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadEvents(false);
  }, [loadEvents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return events.filter((event) => {
      const status = deriveStatus(event).label;
      const matchesFilter = filter === "all" ? true : status === filter;

      const haystack = [
        getEventTitle(event),
        getEventPlace(event),
        String(event.id ?? ""),
        String(event.status ?? ""),
      ]
        .join(" ")
        .toLowerCase();

      const matchesQuery = q ? haystack.includes(q) : true;

      return matchesFilter && matchesQuery;
    });
  }, [events, filter, query]);

  const summary = useMemo(() => {
    const live = events.filter((e) => deriveStatus(e).label === "live").length;
    const draft = events.filter((e) => deriveStatus(e).label === "draft").length;
    const disabled = events.filter((e) => deriveStatus(e).label === "disabled").length;
    const apps = events.reduce((sum, event) => sum + getApplicationsCount(event), 0);

    return {
      total: events.length,
      live,
      draft,
      disabled,
      applications: apps,
    };
  }, [events]);

  const copyEventId = useCallback(async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(""), 1500);
    } catch {
      setCopiedId("");
    }
  }, []);

  return (
    <div
      style={{
        padding: 28,
        display: "grid",
        gap: 20,
        background: "#f8fafc",
        minHeight: "100%",
      }}
    >
      <section
        style={{
          ...cardStyle("linear-gradient(135deg, #020617 0%, #312e81 45%, #6d28d9 100%)"),
          padding: 28,
          color: "#ffffff",
          display: "grid",
          gap: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ maxWidth: 820 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: 1,
                textTransform: "uppercase",
                opacity: 0.85,
                marginBottom: 8,
              }}
            >
              Admin · Events
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: "clamp(32px, 5vw, 52px)",
                lineHeight: 0.95,
                fontWeight: 900,
              }}
            >
              Manage marketplace events in one place
            </h1>
            <p
              style={{
                margin: "14px 0 0",
                fontSize: 18,
                lineHeight: 1.5,
                maxWidth: 920,
                opacity: 0.95,
              }}
            >
              Review every event, scan live versus draft status, track application volume,
              and quickly grab event IDs for follow-up work in the organizer tools.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              style={buttonStyle("secondary")}
              onClick={() => loadEvents(true)}
              disabled={loading || refreshing}
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 14,
          }}
        >
          <div
            style={{
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 18,
              padding: 18,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.85 }}>TOTAL EVENTS</div>
            <div style={{ fontSize: 42, fontWeight: 900, marginTop: 8 }}>{summary.total}</div>
          </div>

          <div
            style={{
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 18,
              padding: 18,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.85 }}>LIVE</div>
            <div style={{ fontSize: 42, fontWeight: 900, marginTop: 8 }}>{summary.live}</div>
          </div>

          <div
            style={{
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 18,
              padding: 18,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.85 }}>DRAFT</div>
            <div style={{ fontSize: 42, fontWeight: 900, marginTop: 8 }}>{summary.draft}</div>
          </div>

          <div
            style={{
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 18,
              padding: 18,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.85 }}>APPLICATIONS</div>
            <div style={{ fontSize: 42, fontWeight: 900, marginTop: 8 }}>{summary.applications}</div>
          </div>
        </div>
      </section>

      {error ? (
        <section
          style={{
            ...cardStyle("#fff7ed"),
            padding: 16,
            border: "1px solid #fdba74",
            color: "#9a3412",
            fontWeight: 700,
          }}
        >
          {error}
        </section>
      ) : null}

      <section
        style={{
          ...cardStyle(),
          padding: 18,
          display: "grid",
          gap: 14,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 1fr) auto",
            gap: 12,
            alignItems: "center",
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by event name, location, status, or ID"
            style={{
              width: "100%",
              borderRadius: 14,
              border: "1px solid #cbd5e1",
              padding: "12px 14px",
              fontSize: 14,
              outline: "none",
            }}
          />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["all", "live", "draft", "disabled"] as const).map((value) => {
              const active = filter === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  style={{
                    ...buttonStyle(active ? "primary" : "ghost"),
                    textTransform: "capitalize",
                  }}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ color: "#64748b", fontSize: 14 }}>
          Showing <strong>{filtered.length}</strong> of <strong>{events.length}</strong> events
        </div>
      </section>

      <section
        style={{
          ...cardStyle(),
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "20px 22px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 24,
                lineHeight: 1.1,
                fontWeight: 900,
                color: "#0f172a",
              }}
            >
              Event inventory
            </h2>
            <div style={{ marginTop: 6, color: "#64748b", fontSize: 14 }}>
              This page reads from <strong>/events</strong> and normalizes object or array responses.
            </div>
          </div>

          <div style={statusPill(`${summary.total} events`, summary.total ? "success" : "neutral")}>
            {summary.total} events
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 22, display: "grid", gap: 14 }}>
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 18,
                  padding: 18,
                  background: "#f8fafc",
                }}
              >
                <div style={{ height: 18, width: "28%", background: "#e2e8f0", borderRadius: 8 }} />
                <div
                  style={{
                    marginTop: 12,
                    height: 14,
                    width: "46%",
                    background: "#e2e8f0",
                    borderRadius: 8,
                  }}
                />
                <div
                  style={{
                    marginTop: 10,
                    height: 14,
                    width: "34%",
                    background: "#e2e8f0",
                    borderRadius: 8,
                  }}
                />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 28 }}>
            <div
              style={{
                ...cardStyle("#f8fafc"),
                padding: 24,
                textAlign: "center",
                border: "1px dashed #cbd5e1",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>
                No events match this view
              </div>
              <p
                style={{
                  margin: "10px auto 0",
                  maxWidth: 560,
                  color: "#64748b",
                  lineHeight: 1.6,
                }}
              >
                Try clearing the search box or switching the event status filter.
              </p>
            </div>
          </div>
        ) : (
          <div style={{ padding: 20, display: "grid", gap: 14 }}>
            {filtered.map((event, index) => {
              const title = getEventTitle(event);
              const place = getEventPlace(event);
              const status = deriveStatus(event);
              const eventId = String(event.id ?? "");
              const applications = getApplicationsCount(event);

              return (
                <article
                  key={eventId || `${title}-${index}`}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 20,
                    padding: 18,
                    background: "#ffffff",
                    display: "grid",
                    gap: 16,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "grid", gap: 10, minWidth: 260 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <div style={statusPill(status.label, status.tone)}>{status.label}</div>
                        <div style={statusPill(`${applications} apps`, "neutral")}>{applications} apps</div>
                      </div>

                      <div>
                        <h3
                          style={{
                            margin: 0,
                            fontSize: 24,
                            lineHeight: 1.08,
                            fontWeight: 900,
                            color: "#0f172a",
                          }}
                        >
                          {title}
                        </h3>
                        <div style={{ marginTop: 8, color: "#64748b", fontSize: 15 }}>
                          {place}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        style={buttonStyle("secondary")}
                        onClick={() => copyEventId(eventId)}
                        disabled={!eventId}
                      >
                        {copiedId && copiedId === eventId ? "Copied" : "Copy event ID"}
                      </button>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: 16,
                        padding: 14,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>EVENT ID</div>
                      <div style={{ marginTop: 8, fontWeight: 800, color: "#0f172a" }}>
                        {event.id ?? "—"}
                      </div>
                    </div>

                    <div
                      style={{
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: 16,
                        padding: 14,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>DATES</div>
                      <div style={{ marginTop: 8, fontWeight: 800, color: "#0f172a" }}>
                        {formatDateRange(event)}
                      </div>
                    </div>

                    <div
                      style={{
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: 16,
                        padding: 14,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>APPLICATIONS</div>
                      <div style={{ marginTop: 8, fontWeight: 800, color: "#0f172a" }}>
                        {applications}
                      </div>
                    </div>

                    <div
                      style={{
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: 16,
                        padding: 14,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>UPDATED</div>
                      <div style={{ marginTop: 8, fontWeight: 800, color: "#0f172a" }}>
                        {event.updated_at
                          ? new Date(event.updated_at).toLocaleDateString()
                          : event.created_at
                          ? new Date(event.created_at).toLocaleDateString()
                          : "—"}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}



