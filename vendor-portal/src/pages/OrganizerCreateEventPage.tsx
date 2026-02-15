import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

type CreateEventPayload = {
  title: string;
  description?: string;

  start_date?: string;
  end_date?: string;

  venue_name?: string;
  street_address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  google_maps_url?: string;

  category?: string;
  expected_attendees?: number;
  setup_time?: string;
  additional_notes?: string;

  image_urls?: string[];
  video_urls?: string[];
  ticket_urls?: string[];
};

type NextStep = "requirements" | "review" | "layout";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

async function postJson<T>(
  path: string,
  body: any,
  opts?: { accessToken?: string }
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // If your backend expects JWT auth, include it when available.
  if (opts?.accessToken) {
    headers.Authorization = `Bearer ${opts.accessToken}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

  if (!res.ok) {
    const msg =
      (isJson && data && (data.detail || data.message || data.error)) ||
      (typeof data === "string" ? data : null) ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return data as T;
}

function cleanStr(v?: string) {
  const s = (v ?? "").trim();
  return s.length ? s : undefined;
}

function asIntOrUndefined(v: string) {
  const s = v.trim();
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.floor(n));
}

function buildNextUrl(eventId: string | number, next: NextStep) {
  if (next === "review") return `/organizer/events/${eventId}/review`;
  if (next === "layout") return `/organizer/events/${eventId}/layout`;
  return `/organizer/events/${eventId}/requirements`;
}

export default function OrganizerCreateEventPage() {
  const navigate = useNavigate();
  const { accessToken } = useAuth();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ✅ choose where "Continue" goes after create
  const [nextStep, setNextStep] = useState<NextStep>("requirements");

  const [form, setForm] = useState<CreateEventPayload>({
    title: "",
    description: "",

    start_date: "",
    end_date: "",

    venue_name: "",
    street_address: "",
    city: "",
    state: "",
    zip_code: "",
    google_maps_url: "",

    category: "",
    expected_attendees: undefined,
    setup_time: "",
    additional_notes: "",

    image_urls: [],
    video_urls: [],
    ticket_urls: [],
  });

  const validationError = useMemo(() => {
    const title = (form.title || "").trim();
    if (!title) return "Event title is required.";
    if (title.length < 3) return "Event title must be at least 3 characters.";

    const sd = (form.start_date || "").trim();
    const ed = (form.end_date || "").trim();
    if (sd && ed && ed < sd) return "End date cannot be before start date.";

    return null;
  }, [form.title, form.start_date, form.end_date]);

  const update = <K extends keyof CreateEventPayload>(key: K, value: CreateEventPayload[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const onCreate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);

    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setSaving(true);

      const payload: CreateEventPayload = {
        title: form.title.trim(),
        description: cleanStr(form.description),

        start_date: cleanStr(form.start_date),
        end_date: cleanStr(form.end_date),

        venue_name: cleanStr(form.venue_name),
        street_address: cleanStr(form.street_address),
        city: cleanStr(form.city),
        state: cleanStr(form.state),
        zip_code: cleanStr(form.zip_code),
        google_maps_url: cleanStr(form.google_maps_url),

        category: cleanStr(form.category),
        expected_attendees: form.expected_attendees,
        setup_time: cleanStr(form.setup_time),
        additional_notes: cleanStr(form.additional_notes),

        image_urls: Array.isArray(form.image_urls) ? form.image_urls.filter(Boolean) : [],
        video_urls: Array.isArray(form.video_urls) ? form.video_urls.filter(Boolean) : [],
        ticket_urls: Array.isArray(form.ticket_urls) ? form.ticket_urls.filter(Boolean) : [],
      };

      const created: any = await postJson("/events", payload, { accessToken });

      const eventId =
        created?.id ??
        created?.event_id ??
        created?.eventId ??
        created?.event?.id ??
        created?.event?.event_id;

      if (!eventId) throw new Error("Event created, but no event id was returned by the API.");

      // ✅ Navigate to whichever next step you selected
      navigate(buildNextUrl(eventId, nextStep));
    } catch (err: any) {
      setError(err?.message || "Unable to create event. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 32, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 36, fontWeight: 900, margin: 0 }}>Create Event</h1>
          <p style={{ marginTop: 8, opacity: 0.7 }}>
            Add general event details. Choose where you want to go next after creating the event.
          </p>

          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.7 }}>Next step:</div>
            <label style={pill(nextStep === "requirements")}>
              <input
                type="radio"
                name="nextStep"
                value="requirements"
                checked={nextStep === "requirements"}
                onChange={() => setNextStep("requirements")}
                style={{ display: "none" }}
              />
              Requirements
            </label>
            <label style={pill(nextStep === "review")}>
              <input
                type="radio"
                name="nextStep"
                value="review"
                checked={nextStep === "review"}
                onChange={() => setNextStep("review")}
                style={{ display: "none" }}
              />
              Review
            </label>
            <label style={pill(nextStep === "layout")}>
              <input
                type="radio"
                name="nextStep"
                value="layout"
                checked={nextStep === "layout"}
                onChange={() => setNextStep("layout")}
                style={{ display: "none" }}
              />
              Map / Layout
            </label>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={() => navigate("/organizer/events")} style={secondaryBtn} disabled={saving}>
            ← Back to Events
          </button>
          <button type="button" onClick={onCreate} style={primaryBtn} disabled={saving}>
            {saving ? "Creating…" : "Create & Continue →"}
          </button>
        </div>
      </div>

      {error && <div style={{ marginTop: 14, ...errorBox }}>{error}</div>}

      <form onSubmit={onCreate} style={{ marginTop: 22, display: "grid", gap: 18 }}>
        <div style={card}>
          <h2 style={cardTitle}>General</h2>

          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={label}>Event title *</div>
              <input
                style={input}
                value={form.title}
                onChange={(e) => update("title", e.target.value)}
                placeholder="e.g., Atlanta Summer Makers Expo"
              />
            </div>

            <div>
              <div style={label}>Category</div>
              <input
                style={input}
                value={form.category ?? ""}
                onChange={(e) => update("category", e.target.value)}
                placeholder="e.g., Tech, Art, Food, Music"
              />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={label}>Description</div>
            <textarea
              style={{ ...input, minHeight: 90 }}
              value={form.description ?? ""}
              onChange={(e) => update("description", e.target.value)}
              placeholder="What is this event about?"
            />
          </div>

          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <div style={label}>Start date</div>
              <input
                type="date"
                style={input}
                value={form.start_date ?? ""}
                onChange={(e) => update("start_date", e.target.value)}
              />
            </div>

            <div>
              <div style={label}>End date</div>
              <input
                type="date"
                style={input}
                value={form.end_date ?? ""}
                onChange={(e) => update("end_date", e.target.value)}
              />
            </div>

            <div>
              <div style={label}>Expected attendees</div>
              <input
                style={input}
                value={form.expected_attendees?.toString() ?? ""}
                onChange={(e) => update("expected_attendees", asIntOrUndefined(e.target.value))}
                placeholder="e.g., 2500"
              />
            </div>
          </div>
        </div>

        <div style={card}>
          <h2 style={cardTitle}>Location</h2>

          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={label}>Venue name</div>
              <input
                style={input}
                value={form.venue_name ?? ""}
                onChange={(e) => update("venue_name", e.target.value)}
                placeholder="e.g., Georgia World Congress Center"
              />
            </div>

            <div>
              <div style={label}>Google Maps URL</div>
              <input
                style={input}
                value={form.google_maps_url ?? ""}
                onChange={(e) => update("google_maps_url", e.target.value)}
                placeholder="https://maps.google.com/..."
              />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={label}>Street address</div>
            <input
              style={input}
              value={form.street_address ?? ""}
              onChange={(e) => update("street_address", e.target.value)}
              placeholder="123 Main St"
            />
          </div>

          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 160px 160px 160px", gap: 12 }}>
            <div>
              <div style={label}>City</div>
              <input style={input} value={form.city ?? ""} onChange={(e) => update("city", e.target.value)} />
            </div>
            <div>
              <div style={label}>State</div>
              <input style={input} value={form.state ?? ""} onChange={(e) => update("state", e.target.value)} />
            </div>
            <div>
              <div style={label}>ZIP</div>
              <input style={input} value={form.zip_code ?? ""} onChange={(e) => update("zip_code", e.target.value)} />
            </div>
            <div>
              <div style={label}>Setup time</div>
              <input
                style={input}
                value={form.setup_time ?? ""}
                onChange={(e) => update("setup_time", e.target.value)}
                placeholder="e.g., 8:00 AM"
              />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={label}>Additional notes</div>
            <textarea
              style={{ ...input, minHeight: 80 }}
              value={form.additional_notes ?? ""}
              onChange={(e) => update("additional_notes", e.target.value)}
              placeholder="Anything vendors should know (parking, load-in, rules, etc.)"
            />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={() => navigate("/organizer/events")} style={secondaryBtn} disabled={saving}>
            Cancel
          </button>
          <button type="submit" style={primaryBtn} disabled={saving}>
            {saving ? "Creating…" : "Create & Continue →"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- styles ---------------- */

const card: React.CSSProperties = {
  background: "white",
  borderRadius: 16,
  padding: 22,
  border: "1px solid rgba(0,0,0,0.06)",
  boxShadow: "0 4px 12px rgba(0,0,0,0.04)",
};

const cardTitle: React.CSSProperties = { margin: 0, fontSize: 18, fontWeight: 900 };

const label: React.CSSProperties = { fontSize: 12, fontWeight: 900, opacity: 0.7 };

const input: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(0,0,0,0.12)",
  fontSize: 14,
  marginTop: 8,
  background: "white",
};

const primaryBtn: React.CSSProperties = {
  background: "#0f172a",
  color: "white",
  borderRadius: 12,
  padding: "10px 18px",
  border: "none",
  cursor: "pointer",
  fontWeight: 900,
};

const secondaryBtn: React.CSSProperties = {
  background: "white",
  borderRadius: 12,
  padding: "10px 18px",
  border: "1px solid rgba(0,0,0,0.15)",
  cursor: "pointer",
  fontWeight: 900,
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

function pill(active: boolean): React.CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: 999,
    border: active ? "1px solid rgba(99,102,241,0.6)" : "1px solid rgba(0,0,0,0.12)",
    background: active ? "rgba(99,102,241,0.12)" : "white",
    fontWeight: 900,
    fontSize: 12,
    cursor: "pointer",
    userSelect: "none",
  };
}
