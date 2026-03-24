import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

const API_BASE = "http://127.0.0.1:8002";

type RequirementsResponse = {
  data: any;
};

export default function OrganizerEventReviewPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const eid = useMemo(() => Number(eventId), [eventId]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [eventMeta, setEventMeta] = useState<any | null>(null);
  const [requirements, setRequirements] = useState<any | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!eid || Number.isNaN(eid)) {
        setError("Invalid event id in route.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const reqRes = await fetch(`${API_BASE}/events/${eid}/requirements`, {
          method: "GET",
          credentials: "include",
        });

        if (!reqRes.ok) {
          const text = await reqRes.text();
          throw new Error(`Requirements API ${reqRes.status}: ${text}`);
        }

        const reqJson = (await reqRes.json()) as RequirementsResponse;
        const reqData = reqJson?.data ?? null;

        // Optional: event meta
        let meta: any = null;
        const tryUrls = [`${API_BASE}/organizer/events/${eid}`, `${API_BASE}/events/${eid}`];

        for (const url of tryUrls) {
          try {
            const r = await fetch(url, { method: "GET", credentials: "include" });
            if (r.ok) {
              meta = await r.json();
              break;
            }
          } catch {}
        }

        if (cancelled) return;

        setRequirements(reqData);
        setEventMeta(meta);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "Failed to load review.");
        setRequirements(null);
        setEventMeta(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [eid]);

  const goBack = () => {
    if (!eid) return;
    navigate(`/organizer/events/${eid}/requirements`);
  };

  const goToLayout = () => {
    if (!eid) return;
    navigate(`/organizer/events/${eid}/layout`);
  };

  const fields = requirements?.fields ?? [];

  return (
    <div style={{ padding: 32, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 34, fontWeight: 700, margin: 0 }}>Review (Vendor Preview)</h1>
          <p style={{ marginTop: 8, opacity: 0.7 }}>This is what vendors will see when they apply.</p>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={goBack} style={secondaryBtn} disabled={loading}>
            ← Back
          </button>
          <button onClick={goToLayout} style={primaryBtn} disabled={loading}>
            Continue to Layout →
          </button>
        </div>
      </div>

      {error && <div style={{ marginTop: 16, ...errorBox }}>{error}</div>}

      {loading ? (
        <div style={{ marginTop: 18, opacity: 0.75 }}>Loading preview…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24, marginTop: 22 }}>
          <div style={card}>
            <h2 style={cardTitle}>Vendor Application</h2>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Event details</div>
              <div style={{ fontSize: 14, opacity: 0.85, lineHeight: 1.5 }}>
                <div>
                  <b>Name:</b> {eventMeta?.name ?? eventMeta?.title ?? `Event #${eid}`}
                </div>
                <div>
                  <b>Location:</b> {eventMeta?.location ?? "—"}
                </div>
                <div>
                  <b>Expected attendance:</b>{" "}
                  {eventMeta?.expected_attendance ?? eventMeta?.expectedAttendance ?? "—"}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Application fields</div>

              {!Array.isArray(fields) || fields.length === 0 ? (
                <div style={emptyBox}>No fields configured yet. Go back and apply a template or add fields.</div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {fields.map((f: any, idx: number) => (
                    <div key={idx}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{f?.label ?? `Field ${idx + 1}`}</div>
                      <input style={input} disabled placeholder={f?.label ?? "Enter here"} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={card}>
              <h3 style={cardTitle}>Checklist</h3>
              <div style={{ marginTop: 10, fontSize: 14, opacity: 0.9 }}>
                Fields: <b>{Array.isArray(fields) ? fields.length : 0}</b>
              </div>
              <div style={{ marginTop: 12, ...hintBox }}>
                If anything is missing, go back to Requirements and Save before continuing.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  background: "white",
  borderRadius: 16,
  padding: 22,
  border: "1px solid rgba(0,0,0,0.06)",
  boxShadow: "0 4px 12px rgba(0,0,0,0.04)",
};

const cardTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
};

const primaryBtn: React.CSSProperties = {
  background: "#0f172a",
  color: "white",
  borderRadius: 12,
  padding: "10px 16px",
  border: "none",
  cursor: "pointer",
  fontWeight: 700,
};

const secondaryBtn: React.CSSProperties = {
  background: "white",
  borderRadius: 12,
  padding: "10px 16px",
  border: "1px solid rgba(0,0,0,0.15)",
  cursor: "pointer",
  fontWeight: 700,
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(0,0,0,0.12)",
  fontSize: 14,
  marginTop: 8,
  background: "rgba(0,0,0,0.02)",
};

const errorBox: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(220, 38, 38, 0.25)",
  background: "rgba(220, 38, 38, 0.06)",
  color: "rgb(153,27,27)",
  fontSize: 14,
  whiteSpace: "pre-wrap",
};

const emptyBox: React.CSSProperties = {
  padding: 14,
  borderRadius: 12,
  border: "1px dashed rgba(0,0,0,0.18)",
  opacity: 0.85,
};

const hintBox: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.08)",
  background: "rgba(0,0,0,0.03)",
  fontSize: 13,
  opacity: 0.9,
};
