// src/pages/OrganizerCreateEventPage.tsx
import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiPost } from "../api";

type CreatePayload = {
  title: string;
  description?: string | null;
  date: string; // backend expects "date" today
  location?: string | null;
  city?: string | null;

  // contract-safe defaults
  kind?: string | null;
  business_only?: boolean;
  badge_required?: boolean;
  max_vendor_slots?: number;
};

type TemplateKey = "tech" | "art" | "food" | "music" | "custom";

const TEMPLATES: Array<{
  key: TemplateKey;
  title: string;
  subtitle: string;
  meta: string;
}> = [
  { key: "tech", title: "Tech Conference", subtitle: "Technology exhibitions and trade shows", meta: "3 booth types • 2 required docs" },
  { key: "art", title: "Art Fair", subtitle: "Art shows, craft fairs, and maker markets", meta: "2 booth types • 2 required docs" },
  { key: "food", title: "Food Festival", subtitle: "Food festivals with health & safety requirements", meta: "2 booth types • 2 required docs" },
  { key: "music", title: "Music Festival", subtitle: "Festivals with merchandise and food vendors", meta: "2 booth types • 2 required docs" },
];

function StepPill(props: { n: number; label: string; active: boolean; done: boolean }) {
  const { n, label, active, done } = props;
  return (
    <div className="flex items-center gap-3">
      <div
        className={[
          "h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold",
          done ? "bg-indigo-600 text-white" : active ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-700",
        ].join(" ")}
      >
        {n}
      </div>
      <div className={active ? "font-semibold text-slate-900" : "text-slate-600"}>{label}</div>
    </div>
  );
}

function InputLabel(props: { label: string; required?: boolean }) {
  return (
    <div className="text-sm font-semibold text-slate-800">
      {props.label} {props.required ? <span className="text-red-500">*</span> : null}
    </div>
  );
}

function extractCreatedId(created: any): number | null {
  const id1 = Number(created?.id);
  if (Number.isFinite(id1)) return id1;

  const id2 = Number(created?.item?.id);
  if (Number.isFinite(id2)) return id2;

  return null;
}

export default function OrganizerCreateEventPage() {
  const nav = useNavigate();

  const [step] = useState<1 | 2 | 3>(1);

  // Step 1 fields (matches your backend contract today)
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState(""); // UI-only for now
  const [category, setCategory] = useState(""); // UI-only for now

  const [venueName, setVenueName] = useState(""); // UI-only
  const [street, setStreet] = useState(""); // UI-only
  const [city, setCity] = useState("");
  const [stateProv, setStateProv] = useState(""); // UI-only
  const [zip, setZip] = useState(""); // UI-only

  const [expectedAttendees, setExpectedAttendees] = useState(""); // UI-only
  const [setupTime, setSetupTime] = useState(""); // UI-only
  const [notes, setNotes] = useState(""); // UI-only

  const [template, setTemplate] = useState<TemplateKey>("tech");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const venueDisplay = useMemo(() => {
    const pieces = [venueName.trim(), street.trim()].filter(Boolean);
    return pieces.length ? pieces.join(", ") : "";
  }, [venueName, street]);

  async function createEventAndGoToMapEditor() {
    setErr(null);

    const t = title.trim();
    if (!t) return setErr("Event name is required.");
    if (!dateStart) return setErr("Start date is required.");

    const payload: CreatePayload = {
      title: t,
      description: description.trim() || null,
      date: dateStart,
      location: (venueDisplay || "").trim() || null,
      city: city.trim() || null,

      // contract-safe defaults
      kind: "general",
      business_only: false,
      badge_required: false,
      max_vendor_slots: 0,
    };

    setSaving(true);
    try {
      const created = await apiPost<any>("/organizer/events", payload);
      const id = extractCreatedId(created);

      if (!id) {
        setErr("Event created, but response did not include an id.");
        return;
      }

      // ✅ straight to booth editor
      nav(`/organizer/events/${id}/map`);
    } catch (e: any) {
      setErr(e?.message || "Failed to create event.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top row */}
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/organizer/dashboard"
          className="inline-flex items-center gap-2 rounded-full border bg-white px-4 py-2 text-sm hover:bg-slate-50"
        >
          ← Back to Dashboard
        </Link>

        <div className="text-xl font-semibold tracking-tight inline-flex items-center gap-2">
          <span className="text-indigo-600">📅</span> Create New Event
        </div>

        <div className="w-[160px]" />
      </div>

      {/* Stepper */}
      <div className="rounded-2xl border bg-white p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
            <StepPill n={1} label="Event Details" active={true} done={false} />
            <div className="hidden sm:block h-px w-10 bg-slate-200 self-center" />
            <StepPill n={2} label="Booth Layout" active={false} done={false} />
            <div className="hidden sm:block h-px w-10 bg-slate-200 self-center" />
            <StepPill n={3} label="Review & Publish" active={false} done={false} />
          </div>

          <div className="flex items-center gap-2">
            <button
              className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              onClick={createEventAndGoToMapEditor}
              disabled={saving}
            >
              {saving ? "Creating…" : "Continue"}
            </button>
          </div>
        </div>

        {err && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {err}
          </div>
        )}
      </div>

      {/* Event Information */}
      <div className="space-y-6">
        <div className="rounded-2xl border bg-white p-6">
          <div className="text-2xl font-semibold">Event Information</div>
          <div className="mt-1 text-sm text-slate-600">Fill in the details about your event. You’ll set up the booth layout next.</div>

          <div className="mt-6 rounded-2xl border p-5">
            <div className="text-lg font-semibold">Basic Information</div>

            <div className="mt-4 space-y-4">
              <div>
                <InputLabel label="Event Name" required />
                <input
                  className="mt-2 w-full rounded-xl border px-4 py-3"
                  placeholder="e.g., Tech Summit 2025"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={saving}
                />
              </div>

              <div>
                <InputLabel label="Event Description" />
                <textarea
                  className="mt-2 w-full rounded-xl border px-4 py-3 min-h-[120px]"
                  placeholder="Describe your event, target audience, and what vendors can expect…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={saving}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <InputLabel label="Start Date" required />
                  <input
                    type="date"
                    className="mt-2 w-full rounded-xl border px-4 py-3"
                    value={dateStart}
                    onChange={(e) => setDateStart(e.target.value)}
                    disabled={saving}
                  />
                </div>
                <div>
                  <InputLabel label="End Date" />
                  <input
                    type="date"
                    className="mt-2 w-full rounded-xl border px-4 py-3"
                    value={dateEnd}
                    onChange={(e) => setDateEnd(e.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>

              <div>
                <InputLabel label="Event Category" />
                <select
                  className="mt-2 w-full rounded-xl border px-4 py-3 bg-white"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={saving}
                >
                  <option value="">Select a category</option>
                  <option value="festival">Festival</option>
                  <option value="market">Market</option>
                  <option value="conference">Conference</option>
                  <option value="community">Community</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Event Location */}
        <div className="rounded-2xl border bg-white p-6">
          <div className="text-xl font-semibold">Event Location</div>

          <div className="mt-4 space-y-4">
            <div>
              <InputLabel label="Venue Name" />
              <input
                className="mt-2 w-full rounded-xl border px-4 py-3"
                placeholder="Convention Center, Park, Stadium…"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
                disabled={saving}
              />
            </div>

            <div>
              <InputLabel label="Street Address" />
              <input
                className="mt-2 w-full rounded-xl border px-4 py-3"
                placeholder="123 Main Street"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <InputLabel label="City" required />
                <input
                  className="mt-2 w-full rounded-xl border px-4 py-3"
                  placeholder="Atlanta"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div>
                <InputLabel label="State" />
                <input
                  className="mt-2 w-full rounded-xl border px-4 py-3"
                  placeholder="GA"
                  value={stateProv}
                  onChange={(e) => setStateProv(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div>
                <InputLabel label="ZIP Code" />
                <input
                  className="mt-2 w-full rounded-xl border px-4 py-3"
                  placeholder="30303"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Event Details */}
        <div className="rounded-2xl border bg-white p-6">
          <div className="text-xl font-semibold">Event Details</div>

          <div className="mt-4 space-y-4">
            <div>
              <InputLabel label="Expected Attendees" />
              <input
                className="mt-2 w-full rounded-xl border px-4 py-3"
                placeholder="5000"
                value={expectedAttendees}
                onChange={(e) => setExpectedAttendees(e.target.value)}
                disabled={saving}
              />
            </div>

            <div>
              <InputLabel label="Setup Time" />
              <input
                className="mt-2 w-full rounded-xl border px-4 py-3"
                placeholder="e.g., Day before, 6am on event day"
                value={setupTime}
                onChange={(e) => setSetupTime(e.target.value)}
                disabled={saving}
              />
            </div>

            <div>
              <InputLabel label="Additional Notes" />
              <textarea
                className="mt-2 w-full rounded-xl border px-4 py-3 min-h-[110px]"
                placeholder="Any additional information for vendors (parking, load-in instructions, special requirements...)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={saving}
              />
            </div>
          </div>
        </div>

        {/* Vendor Application Requirements (UI-only for now) */}
        <div className="rounded-2xl border bg-indigo-50 p-6">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center">⚙️</div>
            <div>
              <div className="text-lg font-semibold">Vendor Application Requirements</div>
              <div className="text-sm text-slate-600">Configure booth categories, restrictions, and compliance requirements (UI-only for now).</div>
            </div>
          </div>

          <div className="mt-5 text-sm font-semibold">Quick Start: Choose a Template</div>

          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            {TEMPLATES.map((t) => {
              const active = template === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTemplate(t.key)}
                  className={[
                    "text-left rounded-2xl border bg-white p-5 hover:bg-slate-50 transition",
                    active ? "border-indigo-500 ring-2 ring-indigo-200" : "border-slate-200",
                  ].join(" ")}
                >
                  <div className="text-base font-semibold">{t.title}</div>
                  <div className="mt-1 text-sm text-slate-600">{t.subtitle}</div>
                  <div className="mt-3 text-xs text-slate-500">{t.meta}</div>
                  <div className="mt-3 text-sm font-semibold text-indigo-700">✓ Select Template</div>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="mt-5 w-full rounded-2xl border-2 border-dashed border-indigo-200 bg-white px-4 py-4 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
            onClick={() => setTemplate("custom")}
          >
            ✳️ Create Custom Configuration
          </button>
        </div>
      </div>
    </div>
  );
}
