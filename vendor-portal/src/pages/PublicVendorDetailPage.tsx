// src/pages/PublicVendorDetailPage.tsx
//
// Public detail page for a single vendor profile.
// Route: /public/vendors/:vendorId
// Data source: GET /public/vendors/{vendorId}

import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiGet } from "../api";

type PublicVendor = {
  profile_id: number;
  user_id: number;
  business_name: string | null;
  public_email: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  vendor_story: string | null;
  checklist_tags: string[];
  vendor_categories: string[];
};

const PublicVendorDetailPage: React.FC = () => {
  const { vendorId } = useParams<{ vendorId: string }>();
  const navigate = useNavigate();

  const [vendor, setVendor] = useState<PublicVendor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadVendor() {
      if (!vendorId) {
        setError("Missing vendor id in URL.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const data = await apiGet<PublicVendor>(`/public/vendors/${vendorId}`);
        setVendor(data);
      } catch (err: any) {
        console.error("Failed to load public vendor detail", err);
        let message = "Failed to load vendor.";
        if (err?.message) message = `Failed to load vendor: ${err.message}`;
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    loadVendor();
  }, [vendorId]);

  const handleBack = () => {
    navigate("/public/vendors");
  };

  const initials = React.useMemo(() => {
    const name = vendor?.business_name || "";
    if (!name.trim()) return "V";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }, [vendor]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Top nav */}
        <div className="mb-6 flex items-center justify-between">
          <button
            type="button"
            onClick={handleBack}
            className="rounded-full border border-slate-700 px-4 py-1 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            ← Back to vendors
          </button>
          <div className="text-xs uppercase tracking-wide text-slate-400">
            Public vendor profile
          </div>
        </div>

        {/* Error + loading states */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        {loading && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-6 py-10 text-center text-slate-400">
            Loading vendor…
          </div>
        )}

        {!loading && !vendor && !error && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-6 py-10 text-center text-slate-300">
            Vendor not found.
          </div>
        )}

        {!loading && vendor && (
          <div className="space-y-6">
            {/* Header card */}
            <div className="flex flex-col gap-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                {/* Avatar / logo placeholder */}
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/20 text-lg font-semibold text-indigo-200">
                  {initials}
                </div>
                <div>
                  <h1 className="text-2xl font-semibold text-slate-50">
                    {vendor.business_name || "Unnamed vendor"}
                  </h1>
                  <div className="mt-1 text-sm text-slate-400">
                    {vendor.city ? vendor.city : "City TBD"}
                  </div>
                  {vendor.phone && (
                    <div className="mt-1 text-sm text-slate-400">
                      Phone:{" "}
                      <span className="text-slate-100">{vendor.phone}</span>
                    </div>
                  )}
                  {vendor.public_email && (
                    <div className="mt-1 text-sm text-slate-400">
                      Email:{" "}
                      <a
                        href={`mailto:${vendor.public_email}`}
                        className="text-indigo-300 hover:text-indigo-200"
                      >
                        {vendor.public_email}
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Website + categories */}
              <div className="space-y-3 text-right">
                {vendor.website && (
                  <div className="text-sm">
                    <a
                      href={vendor.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-300 hover:text-indigo-200"
                    >
                      Visit website →
                    </a>
                  </div>
                )}

                {vendor.vendor_categories?.length ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    {vendor.vendor_categories.map((cat) => (
                      <span
                        key={cat}
                        className="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200"
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Story */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
              <h2 className="text-lg font-semibold text-slate-50">
                About this vendor
              </h2>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-200">
                {vendor.vendor_story ||
                  "This vendor hasn’t shared their story yet."}
              </p>
            </div>

            {/* Checklist tags */}
            {vendor.checklist_tags?.length ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
                <h2 className="text-lg font-semibold text-slate-50">
                  Highlights & badges
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  Quick at-a-glance tags organizers might care about.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {vendor.checklist_tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-medium text-slate-100"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicVendorDetailPage;
