// src/pages/OrganizerVendorPublicProfilePage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { readSession } from "../auth/authStorage";

const API_BASE =
  import.meta.env.VITE_API_BASE || "https://event-app-api-production-ccce.up.railway.app";

type VendorModel = {
  id: number;
  name?: string;
  company_name?: string;
  email?: string;
  description?: string;
  phone?: string;
  website?: string;
  [k: string]: any;
};

function buildOrganizerHeaders(): Record<string, string> {
  const session: any =
    typeof readSession === "function" ? (readSession() as any) : null;

  const token: string = session?.accessToken || session?.token || "";
  const email: string = session?.email || session?.user?.email || "";

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (email) headers["x-user-email"] = email;
  return headers;
}

async function readJsonOrThrow(res: Response) {
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    let msg = text || `Request failed (${res.status})`;
    try {
      const j = text ? JSON.parse(text) : null;
      if (j?.detail) msg = String(j.detail);
    } catch {}
    throw new Error(msg);
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function apiGetVendor(vendorId: number): Promise<VendorModel> {
  const url = `${API_BASE}/vendors/${encodeURIComponent(String(vendorId))}`;
  const res = await fetch(url, { method: "GET", headers: { ...buildOrganizerHeaders() } });
  return (await readJsonOrThrow(res)) as VendorModel;
}

export default function OrganizerVendorPublicProfilePage() {
  const nav = useNavigate();
  const { id: vendorId } = useParams();

  const numericVendorId = useMemo(() => {
    const n = Number(vendorId);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [vendorId]);

  const [vendor, setVendor] = useState<VendorModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setErr("");
      setVendor(null);

      try {
        if (!numericVendorId) throw new Error("Invalid vendorId (expected a number).");
        const v = await apiGetVendor(numericVendorId);
        if (!mounted) return;
        setVendor(v);
      } catch (e: any) {
        if (!mounted) return;
        setErr(String(e?.message || e || "Failed to load vendor"));
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [numericVendorId]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-3xl font-black text-slate-900">Vendor Profile</div>
            <div className="mt-1 text-sm font-semibold text-slate-600">
              Read-only view for organizers
            </div>
          </div>

          <button
            className="rounded-full border border-slate-200 bg-white px-5 py-2 font-semibold text-slate-900 hover:bg-slate-50"
            onClick={() => nav(-1)}
          >
            Back
          </button>
        </div>

        {loading ? (
          <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            Loading…
          </div>
        ) : err ? (
          <div className="mt-6 rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-800 shadow-sm">
            {err}
          </div>
        ) : !vendor ? (
          <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            Vendor not found.
          </div>
        ) : (
          <div className="mt-6 grid gap-6">
            {/* Header card */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-xl font-black text-slate-700">
                    {(vendor.company_name || vendor.name || "V").slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-2xl font-black text-slate-900">
                      {vendor.company_name || vendor.name || `Vendor #${vendor.id}`}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-600">
                      Vendor ID: <span className="font-mono">{vendor.id}</span>
                      {vendor.email ? (
                        <>
                          {" "}
                          • Email: <span className="font-mono">{vendor.email}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-black text-slate-900 hover:bg-slate-50"
                    onClick={() => {
                      const email = vendor.email || "";
                      if (!email) return;
                      window.location.href = `mailto:${email}`;
                    }}
                    disabled={!vendor.email}
                    title={!vendor.email ? "No email on file" : "Email vendor"}
                  >
                    Contact Vendor
                  </button>
                </div>
              </div>
            </div>

            {/* Details */}
            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-sm font-black uppercase text-slate-500">About</div>
                <div className="mt-3 text-sm font-semibold text-slate-700">
                  {vendor.description ? vendor.description : "No description provided yet."}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-sm font-black uppercase text-slate-500">Quick Info</div>
                <div className="mt-3 space-y-2 text-sm font-semibold text-slate-700">
                  <div>
                    <span className="text-slate-500">Phone:</span>{" "}
                    {vendor.phone ? <span className="font-mono">{vendor.phone}</span> : "—"}
                  </div>
                  <div>
                    <span className="text-slate-500">Website:</span>{" "}
                    {vendor.website ? <span className="font-mono">{vendor.website}</span> : "—"}
                  </div>
                </div>
              </div>
            </div>

            {/* Raw dump (temporary plumbing helper) */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-sm font-black uppercase text-slate-500">Raw</div>
              <pre className="mt-3 overflow-auto rounded-2xl bg-slate-50 p-4 text-xs text-slate-800">
                {JSON.stringify(vendor, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}





