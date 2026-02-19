import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type VendorProfile = {
  businessName?: string;
  businessDescription?: string;

  email?: string;
  phone?: string;
  website?: string;

  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;

  categories?: string[];

  logoDataUrl?: string;
  updatedAt?: string;

  verified?: boolean;
  [k: string]: any;
};

const LS_PROFILE_KEY = "vendor_profile_v1";
const LS_VERIFY_KEY = "vendor_verification_status_v1";

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function initials(name: string) {
  const parts = name
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const a = parts[0]?.[0] || "V";
  const b = parts[1]?.[0] || parts[0]?.[1] || "";
  return (a + b).toUpperCase();
}

function formatAddress(p: VendorProfile) {
  const line1 = [p.address1, p.address2].filter(Boolean).join(" ");
  const cityStateZip = [p.city, p.state, p.zip].filter(Boolean);
  const line2 = cityStateZip.join(", ").replace(", ,", ",");
  const parts = [line1, line2, p.country].filter(Boolean);
  return parts.join(" • ");
}

function normalizeVendorPayload(raw: any): VendorProfile {
  const v: any = raw || {};
  const profile: VendorProfile = {
    businessName: v.businessName ?? v.business_name ?? v.name ?? v.business ?? "",
    businessDescription: v.businessDescription ?? v.business_description ?? v.description ?? "",
    email: v.email ?? v.vendor_email ?? "",
    phone: v.phone ?? v.phone_number ?? "",
    website: v.website ?? v.web ?? "",
    address1: v.address1 ?? v.address_1 ?? v.street_address ?? "",
    address2: v.address2 ?? v.address_2 ?? "",
    city: v.city ?? "",
    state: v.state ?? "",
    zip: v.zip ?? v.zip_code ?? "",
    country: v.country ?? "USA",
    categories: Array.isArray(v.categories) ? v.categories : Array.isArray(v.category) ? v.category : [],
    logoDataUrl: v.logoDataUrl ?? v.logo_data_url ?? v.logo ?? "",
    updatedAt: v.updatedAt ?? v.updated_at ?? "",
    verified: !!(v.verified ?? v.is_verified ?? v.verification_status === "verified"),
  };
  return profile;
}

function looksLikeEmail(s: string) {
  const x = String(s || "").trim();
  return x.includes("@") || x.includes("%40"); // %40 in raw params sometimes
}

function looksNumericId(s: string) {
  const x = String(s || "").trim();
  return /^[0-9]+$/.test(x);
}

export default function VendorPublicProfilePage() {
  const navigate = useNavigate();
  const { vendorId } = useParams();

  const isOrganizerView = !!vendorId;

  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");

  // localStorage mode (vendor self)
  const localProfile = useMemo(() => {
    return safeJsonParse<VendorProfile>(localStorage.getItem(LS_PROFILE_KEY)) || {};
  }, []);

  const localVerified = useMemo(() => {
    const raw = localStorage.getItem(LS_VERIFY_KEY);
    if (!raw) return false;
    return raw === "verified" || raw === "true" || raw === "1";
  }, []);

  // organizer read-only mode (fetch from backend)
  const [remoteProfile, setRemoteProfile] = useState<VendorProfile | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!isOrganizerView) return;

      const key = String(vendorId || "").trim();
      if (!key) return;

      setLoading(true);
      setErr("");

      try {
        // ✅ Decide correct endpoint:
        // - email -> /vendors/by-email/{email}
        // - numeric -> /vendors/{id}
        const url =
          looksNumericId(key) && !looksLikeEmail(key)
            ? `${API_BASE}/vendors/${encodeURIComponent(key)}`
            : `${API_BASE}/vendors/by-email/${encodeURIComponent(key)}`;

        const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Failed to load vendor (${res.status})`);
        }

        const data = await res.json().catch(() => null);
        const norm = normalizeVendorPayload(data);

        if (!mounted) return;
        setRemoteProfile(norm);
      } catch (e: any) {
        if (!mounted) return;
        setErr(String(e?.message || e || "Failed to load vendor"));
        setRemoteProfile(null);
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [isOrganizerView, vendorId]);

  const profile = isOrganizerView ? remoteProfile || {} : localProfile;
  const isVerified = isOrganizerView ? !!profile.verified : localVerified;

  const name = (profile.businessName || (isOrganizerView ? "Vendor Business" : "Your Business")).trim();
  const desc = (profile.businessDescription || "").trim();
  const addr = formatAddress(profile);

  const memberSinceYear = useMemo(() => {
    const iso = profile.updatedAt;
    if (!iso) return new Date().getFullYear();
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
  }, [profile.updatedAt]);

  async function onShare() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: name, text: "Vendor profile", url });
        return;
      }
    } catch {}

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  function onContact() {
    const email = (profile.email || "").trim();
    if (email) {
      window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
        "VendorConnect inquiry"
      )}`;
    }
  }

  const categories = Array.isArray(profile.categories) ? profile.categories : [];

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => (isOrganizerView ? navigate(-1) : navigate("/vendor/dashboard"))}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
        >
          ← Back
        </button>

        {!isOrganizerView ? (
          <button
            type="button"
            onClick={() => navigate("/vendor/profile/setup")}
            className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2 text-sm font-extrabold text-white hover:bg-indigo-700"
          >
            <span className="inline-block h-4 w-4 rounded bg-white/20" />
            Edit Profile
          </button>
        ) : (
          <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-600">
            Read-only (Organizer View)
          </div>
        )}
      </div>

      {isOrganizerView && loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">Loading vendor…</div>
      ) : null}

      {isOrganizerView && err ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 shadow-sm">{err}</div>
      ) : null}

      {/* Gradient header + content */}
      <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
        <div className="h-32 bg-gradient-to-r from-indigo-600 to-purple-600" />

        <div className="bg-slate-50 p-6">
          {/* Profile card */}
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-6">
                {/* Logo */}
                <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  {profile.logoDataUrl ? (
                    <img src={profile.logoDataUrl} alt="Logo" className="h-full w-full object-cover" />
                  ) : (
                    <div className="text-4xl font-extrabold text-indigo-600">{initials(name)}</div>
                  )}
                </div>

                {/* Title/meta */}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-3xl font-extrabold text-slate-900">{name}</div>
                    {isVerified ? (
                      <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-1 text-xs font-extrabold text-indigo-700 ring-1 ring-indigo-200">
                        ✓ Verified
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-2 text-sm font-semibold text-slate-600">{desc || "No description available"}</div>

                  {addr ? (
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-600">
                      <span className="inline-block h-5 w-5 rounded bg-slate-100" />
                      <span className="min-w-0 break-words">{addr}</span>
                    </div>
                  ) : null}

                  <div className="mt-2 flex flex-wrap items-center gap-4 text-sm font-semibold text-slate-600">
                    {profile.website ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-5 w-5 rounded bg-slate-100" />
                        <a className="font-extrabold text-slate-700 hover:underline" href={profile.website} target="_blank" rel="noreferrer">
                          {profile.website}
                        </a>
                      </div>
                    ) : null}

                    {profile.email ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-5 w-5 rounded bg-slate-100" />
                        <span>{profile.email}</span>
                      </div>
                    ) : null}

                    {profile.phone ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-5 w-5 rounded bg-slate-100" />
                        <span>{profile.phone}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={onContact}
                  disabled={!profile.email}
                  className={`rounded-full px-6 py-3 text-sm font-extrabold text-white ${
                    profile.email ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-300 cursor-not-allowed"
                  }`}
                >
                  Contact Vendor
                </button>

                <button
                  type="button"
                  onClick={onShare}
                  className="rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
                >
                  {copied ? "Copied!" : "Share Profile"}
                </button>
              </div>
            </div>
          </div>

          {/* Body grid */}
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            {/* Left */}
            <div className="space-y-6 lg:col-span-2">
              <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <div className="text-xl font-extrabold text-slate-900">About Us</div>
                <div className="mt-3 text-sm font-semibold text-slate-600">{desc || "No description provided yet."}</div>
              </div>

              <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <div className="text-xl font-extrabold text-slate-900">Reviews</div>

                <div className="mt-3 flex items-center gap-3">
                  <div className="flex items-center gap-1 text-slate-300">
                    <span>★</span>
                    <span>★</span>
                    <span>★</span>
                    <span>★</span>
                    <span>★</span>
                  </div>
                  <div className="text-2xl font-extrabold text-slate-900">0.0</div>
                  <div className="text-sm font-semibold text-slate-600">(0 reviews)</div>
                </div>

                <div className="mt-10 flex flex-col items-center justify-center gap-3 py-10 text-center">
                  <div className="h-12 w-12 rounded-xl bg-slate-100" />
                  <div className="text-sm font-semibold text-slate-600">No reviews yet.</div>
                </div>
              </div>
            </div>

            {/* Right */}
            <div className="space-y-6">
              <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <div className="text-lg font-extrabold text-slate-900">Quick Stats</div>

                <div className="mt-4 space-y-3 text-sm font-semibold text-slate-700">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Events Attended</span>
                    <span className="font-extrabold">0</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Member Since</span>
                    <span className="font-extrabold">{memberSinceYear}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Average Rating</span>
                    <span className="font-extrabold">★ 0</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Response Time</span>
                    <span className="font-extrabold">&lt; 24 hours</span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <div className="text-lg font-extrabold text-slate-900">Categories</div>

                {categories.length === 0 ? (
                  <div className="mt-3 text-sm font-semibold text-slate-600">No categories specified</div>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {categories.map((c) => (
                      <span
                        key={c}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-extrabold text-slate-700"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <div className="text-lg font-extrabold text-slate-900">Verified Vendor</div>
                <div className="mt-2 text-sm font-semibold text-slate-600">Verification status for this vendor.</div>

                <div className="mt-4 flex items-center gap-3">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full ${isVerified ? "bg-emerald-600" : "bg-slate-300"}`}>
                    <span className="text-white text-sm font-extrabold">✓</span>
                  </div>
                  <div className={`text-sm font-extrabold ${isVerified ? "text-emerald-700" : "text-slate-500"}`}>
                    {isVerified ? "Verified Business" : "Not Verified Yet"}
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
