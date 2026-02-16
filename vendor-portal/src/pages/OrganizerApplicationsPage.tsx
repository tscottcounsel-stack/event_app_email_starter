// src/pages/OrganizerApplicationsPage.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

type ApplicationRow = {
  id: number;
  event_id: number;
  status: string;
  vendor_email?: string | null;
  vendor_id?: string | null;
  booth_id?: string | null;
  app_ref?: string | null;
  submitted_at?: string | null;
  updated_at?: string | null;
};

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  // Confirmed storage keys in your app:
  const token = localStorage.getItem("accessToken") || "";
  const email = localStorage.getItem("userEmail") || "";
  const userId = localStorage.getItem("userId") || "";

  if (token) h.Authorization = `Bearer ${token}`;
  if (email) h["x-user-email"] = email;
  if (userId) h["x-user-id"] = String(userId);

  return h;
}

function fmt(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

export default function OrganizerApplicationsPage() {
  const params = useParams();
  const eventId = useMemo(() => Number(params.eventId), [params.eventId]);

  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apps, setApps] = useState<ApplicationRow[]>([]);

  const fetchApps = useCallback(async () => {
    if (!eventId || Number.isNaN(eventId)) {
      setError("Invalid event id in route.");
      setApps([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/organizer/events/${eventId}/applications`, {
        method: "GET",
        headers: authHeaders(),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`API ${res.status}: ${text || "Failed to load applications"}`);
      }

      const data = await res.json().catch(() => null) as any;
      const list = Array.isArray(data?.applications) ? (data.applications as ApplicationRow[]) : [];
      setApps(list);
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
    async (applicationId: number, status: "approved" | "rejected") => {
      setError(null);
      setUpdatingId(applicationId);

      try {
        const res = await fetch(`${API_BASE}/organizer/applications/${applicationId}/status`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ status }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`API ${res.status}: ${text || "Failed to update application"}`);
        }

        // Optimistic update (avoid blanking list)
        setApps((prev) =>
          prev.map((a) => (a.id === applicationId ? { ...a, status } : a))
        );

        // Then refresh from server for source-of-truth
        await fetchApps();
      } catch (e: any) {
        setError(e?.message ?? "Failed to update application.");
      } finally {
        setUpdatingId(null);
      }
    },
    [fetchApps]
  );

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h1 style={{ fontSize: 44, margin: 0 }}>Applications</h1>

        <button onClick={fetchApps} disabled={loading || updatingId !== null}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div style={{ marginTop: 6, color: "#475569", fontWeight: 600 }}>
        Event #{Number.isNaN(eventId) ? "—" : eventId}
      </div>

      {error && (
        <div style={{ marginTop: 14, color: "red", fontWeight: 700 }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        {loading && apps.length === 0 ? (
          <div>Loading applications…</div>
        ) : apps.length === 0 ? (
          <div>No applications yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {apps.map((a) => {
              const busy = loading || updatingId === a.id;

              return (
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
                    background: "white",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800 }}>
                      {a.vendor_email || `Application #${a.id}`}
                      {a.booth_id ? (
                        <span style={{ marginLeft: 10, color: "#64748b", fontWeight: 800 }}>
                          • Booth {a.booth_id}
                        </span>
                      ) : null}
                    </div>

                    <div style={{ marginTop: 4 }}>
                      Status: <strong>{a.status}</strong>
                    </div>

                    <div style={{ marginTop: 6, fontSize: 12, color: "#64748b", fontWeight: 700 }}>
                      {a.submitted_at ? `Submitted: ${fmt(a.submitted_at)}` : null}
                      {a.updated_at ? ` • Updated: ${fmt(a.updated_at)}` : null}
                      {a.app_ref ? ` • Ref: ${a.app_ref}` : null}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => updateStatus(a.id, "approved")}
                      disabled={busy}
                    >
                      {updatingId === a.id ? "Working…" : "Approve"}
                    </button>

                    <button
                      onClick={() => updateStatus(a.id, "rejected")}
                      disabled={busy}
                    >
                      {updatingId === a.id ? "Working…" : "Reject"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
