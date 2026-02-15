import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

type ApplicationRow = {
  id: number;
  event_id: number;
  status: string;
  vendor_name?: string | null;
};

const API_BASE = "http://127.0.0.1:8002";

export default function OrganizerApplicationsPage() {
  const params = useParams();
  const eventId = useMemo(() => Number(params.eventId), [params.eventId]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apps, setApps] = useState<ApplicationRow[]>([]);

  const fetchApps = useCallback(async () => {
    if (!eventId || Number.isNaN(eventId)) {
      setError("Invalid event id in route.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/organizer/events/${eventId}/applications`, {
        method: "GET",
        credentials: "include",
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text}`);
      }

      const data = (await res.json()) as { applications?: ApplicationRow[] };
      setApps(Array.isArray(data.applications) ? data.applications : []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load applications.");
      setApps([]);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchApps();
  }, [fetchApps]);

  const updateStatus = useCallback(
    async (applicationId: number, action: "approve" | "reject") => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`${API_BASE}/organizer/applications/${applicationId}/${action}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`API ${res.status}: ${text}`);
        }

        await fetchApps();
      } catch (e: any) {
        setError(e?.message ?? `Failed to ${action} application.`);
      } finally {
        setLoading(false);
      }
    },
    [fetchApps]
  );

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 44, lineHeight: 1.05, margin: 0 }}>Applications</h1>
          <p style={{ marginTop: 10, marginBottom: 0, fontSize: 16, opacity: 0.8 }}>
            Review vendor applications by event.
          </p>
        </div>

        <button
          onClick={fetchApps}
          disabled={loading}
          style={{
            borderRadius: 12,
            padding: "10px 14px",
            border: "1px solid rgba(0,0,0,0.1)",
            background: "white",
            cursor: loading ? "not-allowed" : "pointer",
            fontSize: 14,
          }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div style={{ marginTop: 24 }}>
        <div
          style={{
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 18,
            padding: 18,
            background: "white",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 24 }}>Application list</h2>
              <div style={{ marginTop: 6, fontSize: 14, opacity: 0.8 }}>Event: Event #{eventId || "—"}</div>
            </div>
          </div>

          {error && (
            <div
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 12,
                border: "1px solid rgba(220, 38, 38, 0.25)",
                background: "rgba(220, 38, 38, 0.06)",
                color: "rgb(153,27,27)",
                fontSize: 14,
                whiteSpace: "pre-wrap",
              }}
            >
              {error}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            {loading && apps.length === 0 ? (
              <div style={{ padding: 18, opacity: 0.75 }}>Loading applications…</div>
            ) : apps.length === 0 ? (
              <div
                style={{
                  padding: 18,
                  borderRadius: 14,
                  border: "1px dashed rgba(0,0,0,0.15)",
                  opacity: 0.85,
                }}
              >
                No applications yet for this event.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {apps.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 12,
                      alignItems: "center",
                      border: "1px solid rgba(0,0,0,0.08)",
                      borderRadius: 14,
                      padding: 12,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>
                        {a.vendor_name?.trim() ? a.vendor_name : `Vendor (app #${a.id})`}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 13, opacity: 0.75 }}>
                        Status: <span style={{ fontWeight: 600 }}>{a.status}</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button
                        onClick={() => updateStatus(a.id, "approve")}
                        disabled={loading}
                        style={{
                          borderRadius: 12,
                          padding: "8px 10px",
                          border: "1px solid rgba(0,0,0,0.1)",
                          background: "white",
                          cursor: loading ? "not-allowed" : "pointer",
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        Approve
                      </button>

                      <button
                        onClick={() => updateStatus(a.id, "reject")}
                        disabled={loading}
                        style={{
                          borderRadius: 12,
                          padding: "8px 10px",
                          border: "1px solid rgba(0,0,0,0.1)",
                          background: "white",
                          cursor: loading ? "not-allowed" : "pointer",
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
