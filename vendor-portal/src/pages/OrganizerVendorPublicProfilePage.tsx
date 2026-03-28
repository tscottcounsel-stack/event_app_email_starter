import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { readSession } from "../auth/authStorage";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "https://event-app-api-production-ccce.up.railway.app";

type OrganizerApplication = {
  id?: number;
  vendor_id?: number | string;
  vendor_email?: string;
};

function decodeJwtPayload(token: string): any | null {
  try {
    const parts = token.split(".");
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

function buildHeaders(extra?: Record<string, string>) {
  const session: any = readSession?.() || {};
  const token = session?.accessToken || "";
  const payload = token ? decodeJwtPayload(token) : null;
  const sub = payload?.sub ?? "";

  return {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(session?.email ? { "x-user-email": session.email } : {}),
    ...(sub ? { "x-user-id": String(sub) } : {}),
    ...(extra ?? {}),
  };
}

async function readJsonOrThrow(res: Response) {
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    let message = text || `Request failed (${res.status})`;
    try {
      const parsed = text ? JSON.parse(text) : null;
      if (parsed?.detail) message = String(parsed.detail);
    } catch {}
    throw new Error(message);
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export default function OrganizerVendorPublicProfilePage() {
  const nav = useNavigate();
  const params = useParams();

  const eventId = useMemo(
    () => String(params.eventId ?? params.event_id ?? "").trim(),
    [params]
  );

  const routeVendorId = useMemo(
    () => String(params.vendorId ?? params.id ?? "").trim(),
    [params]
  );

  const [resolvedVendorKey, setResolvedVendorKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let mounted = true;

    async function resolveVendorKey() {
      setLoading(true);
      setErr("");
      setResolvedVendorKey("");

      try {
        if (!routeVendorId) throw new Error("Missing vendor id in route.");
        if (!eventId) throw new Error("Missing event id in route.");

        if (routeVendorId.includes("@")) {
          if (!mounted) return;
          setResolvedVendorKey(routeVendorId.toLowerCase());
          return;
        }

        const res = await fetch(
          `${API_BASE}/organizer/events/${encodeURIComponent(eventId)}/applications`,
          { headers: buildHeaders() }
        );

        const data = (await readJsonOrThrow(res)) as {
          applications?: OrganizerApplication[];
        };

        const apps = Array.isArray(data?.applications) ? data.applications : [];
        const match = apps.find((app) => {
          const vendorId = String(app?.vendor_id ?? "").trim();
          const appId = String(app?.id ?? "").trim();
          const email = String(app?.vendor_email ?? "").trim().toLowerCase();
          return (
            vendorId === routeVendorId ||
            appId === routeVendorId ||
            email === routeVendorId.toLowerCase()
          );
        });

        const resolved = String(match?.vendor_email ?? "").trim().toLowerCase();
        if (!resolved) {
          throw new Error("Could not resolve vendor profile for this organizer route.");
        }

        if (!mounted) return;
        setResolvedVendorKey(resolved);
      } catch (e: any) {
        if (!mounted) return;
        setErr(String(e?.message || e || "Failed to resolve vendor profile."));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void resolveVendorKey();
    return () => {
      mounted = false;
    };
  }, [eventId, routeVendorId]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black text-slate-900">Vendor Profile</h1>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              Organizer read-only view
            </p>
          </div>

          <div className="flex items-center gap-3">
            {resolvedVendorKey ? (
              <Link
                to={`/vendors/${encodeURIComponent(resolvedVendorKey)}`}
                className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-black text-slate-900 hover:bg-slate-50"
              >
                Open Public View
              </Link>
            ) : null}

            <button
              className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-black text-slate-900 hover:bg-slate-50"
              onClick={() => nav(-1)}
            >
              Back
            </button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            Loading vendor profile...
          </div>
        ) : err ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-700 shadow-sm">
            {err}
          </div>
        ) : resolvedVendorKey ? (
          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <iframe
              title="Organizer Vendor Public Profile"
              src={`/vendors/${encodeURIComponent(resolvedVendorKey)}`}
              className="h-[calc(100vh-180px)] min-h-[900px] w-full border-0"
            />
          </div>
        ) : (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            Vendor not found.
          </div>
        )}
      </div>
    </div>
  );
}
