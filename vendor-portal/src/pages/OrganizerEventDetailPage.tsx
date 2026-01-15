// src/pages/OrganizerEventDetailPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { API_BASE, apiGet } from "../api";

type OrganizerEvent = {
  id: number;
  title?: string;
  date?: string;
  city?: string;
  location?: string;
};

function formatDate(d?: string) {
  if (!d) return "—";
  return String(d).slice(0, 10);
}

export default function OrganizerEventDetailPage() {
  const nav = useNavigate();
  const { eventId: eventIdParam } = useParams();
  const eventId = Number(eventIdParam || "");

  const [event, setEvent] = useState<OrganizerEvent | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);

  // non-fatal hint (published diagram JSON exists?)
  const [layoutStatus, setLayoutStatus] = useState<"unknown" | "available" | "missing">("unknown");

  const publicDiagramUrl = useMemo(() => {
    if (!Number.isFinite(eventId) || eventId <= 0) return "";
    // confirmed working public endpoint (JSON)
    return `${API_BASE}/public/events/${eventId}/diagram`;
  }, [eventId]);

  async function load() {
    if (!Number.isFinite(eventId) || eventId <= 0) {
      setErr("Invalid event id.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setErr(null);

    try {
      // If you later add GET /organizer/events/{id}, switch to that.
      // For now, we fetch the list and find the event by id.
      const res: any = await apiGet<any>("/organizer/events");

      const list: OrganizerEvent[] = Array.isArray(res)
        ? res
        : Array.isArray(res?.items)
        ? res.items
        : Array.isArray(res?.events)
        ? res.events
        : [];

      const found = list.find((x) => Number(x.id) === eventId) ?? null;
      setEvent(found);

      // Non-fatal: probe published diagram availability (doesn't block UI)
      setLayoutStatus("unknown");
      if (publicDiagramUrl) {
        try {
          const r = await fetch(publicDiagramUrl, { method: "GET" });
          setLayoutStatus(r.ok ? "available" : "missing");
        } catch {
          setLayoutStatus("unknown");
        }
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to load event.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const title = event?.title || `Event #${eventId}`;
  const subtitle = `${formatDate(event?.date)} • ${event?.location || "Location TBD"}${
    event?.city ? ` • ${event.city}` : ""
  }`;

  const Chip = ({
    tone = "slate",
    children,
  }: {
    tone?: "slate" | "green" | "amber" | "indigo";
    children: React.ReactNode;
  }) => {
    const toneMap: Record<string, string> = {
      slate: "bg-slate-100 text-slate-700 border-slate-200",
      green: "bg-green-50 text-green-700 border-green-200",
      amber: "bg-amber-50 text-amber-700 border-amber-200",
      indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
    };

    return (
      <span
        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${toneMap[tone]}`}
      >
        {children}
      </span>
    );
  };

  const invalidId = !Number.isFinite(eventId) || eventId <= 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <button className="text-sm text-slate-600 hover:text-slate-900" onClick={() => nav("/organizer/events")}>
            ← Back to events
          </button>

          <div className="mt-3 text-xs text-slate-500">Dashboard → Events → {title}</div>

          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
          <div className="mt-1 text-sm text-slate-600">{subtitle}</div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip tone="indigo">Organizer View</Chip>
            <Chip tone="slate">Applications: Open</Chip>

            {layoutStatus === "available" ? (
              <Chip tone="green">Layout: Available</Chip>
            ) : layoutStatus === "missing" ? (
              <Chip tone="amber">Layout: Not published</Chip>
            ) : (
              <Chip tone="slate">Layout: Unknown</Chip>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50"
            onClick={load}
            disabled={loading}
          >
            Refresh
          </button>

          <button
            className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            onClick={() => nav(`/organizer/events/${eventId}/edit`)}
            disabled={invalidId}
          >
            Edit Event
          </button>
        </div>
      </div>

      {err && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Applicants */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-base font-semibold">Applicants</div>
            <div className="mt-1 text-sm text-slate-600">Review and approve vendor applications for this event.</div>

            <button
              className="mt-4 rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              onClick={() => nav(`/organizer/applications?eventId=${eventId}`)}
              disabled={invalidId}
            >
              Open Applicants
            </button>
          </div>

          {/* Map Editor */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-base font-semibold">Booth Layout</div>
            <div className="mt-1 text-sm text-slate-600">Create and edit the booth layout for vendors.</div>

            <button
              className="mt-4 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-60"
              onClick={() => nav(`/organizer/events/${eventId}/map`)}
              disabled={invalidId}
            >
              Open Map Editor
            </button>
          </div>

          {/* Vendor Interests / Assignments + Public JSON */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-base font-semibold">Vendor Interests</div>
            <div className="mt-1 text-sm text-slate-600">
              Review booth interest and manage assignments (current diagram view).
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                onClick={() => nav(`/organizer/events/${eventId}/diagram`)}
                disabled={invalidId}
              >
                Open Assignments
              </button>

              <a
                className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50"
                href={publicDiagramUrl || undefined}
                target="_blank"
                rel="noreferrer"
                aria-disabled={invalidId}
                onClick={(e) => {
                  if (invalidId || !publicDiagramUrl) e.preventDefault();
                }}
              >
                Public Diagram (JSON)
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
