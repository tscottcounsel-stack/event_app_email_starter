// src/pages/OrganizerVendorPreviewPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { readSession } from "../auth/authStorage";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type ApplicationRow = {
  id: number;
  event_id?: number | string | null;
  vendor_id?: string | number | null;
  vendor_email?: string | null;
  booth_id?: string | null;
  app_ref?: string | null;
  status?: string | null;
  checked?: Record<string, boolean> | null;
  notes?: string | null;
  documents?: any;
  docs?: any;
  submitted_at?: string | null;
  updated_at?: string | null;
  [k: string]: any;
};

async function readJson(res: Response) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await res.json().catch(() => ({}));
  const text = await res.text().catch(() => "");
  return { detail: text };
}

function asInt(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildHeaders() {
  const s = readSession();
  return {
    Accept: "application/json",
    Authorization: `Bearer ${s?.accessToken || ""}`,
    "x-user-email": s?.email || "organizer@example.com",
  };
}

export default function OrganizerVendorPreviewPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const { applicationId } = useParams();

  const appId = useMemo(() => asInt(applicationId), [applicationId]);

  const eventId = useMemo(() => {
    const sp = new URLSearchParams(loc.search || "");
    return asInt(sp.get("eventId"));
  }, [loc.search]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");
  const [app, setApp] = useState<ApplicationRow | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!appId) {
        setErr("Invalid application id.");
        setApp(null);
        return;
      }
      if (!eventId) {
        setErr("Missing event id. Please open this page using the View App button from an event’s Applications list.");
        setApp(null);
        return;
      }

      setLoading(true);
      setErr("");
      setApp(null);

      try {
        const res = await fetch(`${API_BASE}/organizer/events/${eventId}/applications`, {
          method: "GET",
          headers: buildHeaders(),
        });

        const data = await readJson(res);
        if (!res.ok) throw new Error(String((data as any)?.detail || "Failed to load applications"));

        const rows: ApplicationRow[] = Array.isArray((data as any)?.applications)
          ? ((data as any).applications as ApplicationRow[])
          : Array.isArray(data)
            ? (data as any)
            : [];

        const found = rows.find((x) => Number(x?.id) === Number(appId)) || null;

        if (!mounted) return;
        if (!found) {
          setErr(`Application #${appId} was not found in Event #${eventId}.`);
          setApp(null);
          return;
        }

        setApp(found);
      } catch (e: any) {
        if (!mounted) return;
        setErr(String(e?.message || e || "Failed to load application"));
        setApp(null);
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [appId, eventId]);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-extrabold">Application Preview</div>
          <div className="mt-1 text-sm font-semibold text-slate-600">
            App <span className="font-mono">#{appId || "?"}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold hover:bg-slate-50"
            onClick={() => nav(-1)}
          >
            Back
          </button>

          {eventId ? (
            <Link
              to={`/organizer/events/${eventId}/applications`}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:opacity-95"
            >
              Back to Event Applications
            </Link>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">Loading…</div>
      ) : null}

      {err ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm font-extrabold text-red-700">
          {err}
        </div>
      ) : null}

      {app ? (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-sm font-semibold text-slate-700">
              <div>
                <span className="text-slate-500">Event ID:</span> {String(app.event_id ?? eventId)}
              </div>
              <div>
                <span className="text-slate-500">Status:</span> {String(app.status ?? "—")}
              </div>
              <div>
                <span className="text-slate-500">Vendor Email:</span> {String(app.vendor_email ?? "—")}
              </div>
              <div>
                <span className="text-slate-500">Vendor ID:</span> {String(app.vendor_id ?? "—")}
              </div>
              <div>
                <span className="text-slate-500">Booth:</span> {String(app.booth_id ?? "—")}
              </div>
              <div>
                <span className="text-slate-500">Ref:</span> {String(app.app_ref ?? "—")}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-lg font-extrabold">Raw Application</div>
            <pre className="mt-3 overflow-auto rounded-xl bg-slate-50 p-4 text-xs text-slate-800">
              {JSON.stringify(app, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
