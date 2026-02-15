import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8002";

async function apiJson(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });

  if (!res.ok) throw new Error(`Request failed ${res.status}`);
  try { return await res.json(); } catch { return null; }
}

export default function OrganizerVendorPublicProfilePage() {
  const navigate = useNavigate();
  const { vendorId } = useParams();
  const [search] = useSearchParams();

  const eventId = search.get("eventId");
  const applicationId = search.get("applicationId");

  const [vendor, setVendor] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await apiJson(`/vendors/${vendorId}`);
        setVendor(data?.data || data);
      } catch {
        setVendor(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [vendorId]);

  async function handleApprove() {
    try {
      await apiJson(`/organizer/applications/${applicationId}/approve`, { method: "POST" });

      navigate(
        `/map-editor/${eventId}?applicationId=${applicationId}&vendorId=${vendorId}`
      );
    } catch (e) {
      alert("Approve failed");
    }
  }

  async function handleReject() {
    try {
      await apiJson(`/organizer/applications/${applicationId}/reject`, { method: "POST" });
      navigate(`/organizer/events/${eventId}/applications`);
    } catch {
      alert("Reject failed");
    }
  }

  if (loading) return <div className="p-6">Loading vendor…</div>;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <button
        onClick={() => navigate(-1)}
        className="mb-6 rounded-xl border px-4 py-2"
      >
        ← Back
      </button>

      <div className="rounded-2xl border bg-white p-6 shadow">
        <h1 className="text-2xl font-bold">
          {vendor?.company_name || vendor?.business_name || "Vendor"}
        </h1>

        <div className="mt-4 space-y-2 text-sm text-slate-600">
          <div>Email: {vendor?.email || "—"}</div>
          <div>Phone: {vendor?.phone || "—"}</div>
          <div>Description: {vendor?.description || "—"}</div>
        </div>

        <div className="mt-8 flex gap-4">
          <button
            onClick={handleApprove}
            className="rounded-xl bg-emerald-600 px-6 py-3 text-white font-semibold"
          >
            Approve & Assign Booth →
          </button>

          <button
            onClick={handleReject}
            className="rounded-xl border px-6 py-3 font-semibold"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}
