import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { readSession } from "../auth/authStorage";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type VendorProfile = {
  businessName: string;
  businessDescription: string;
  businessType: string;
  yearsInBusiness: string;

  email: string;
  phone: string;
  website: string;

  country: string;
  zip: string;

  logoDataUrl?: string;

  imageUrls: string[];
  videoUrls: string[];
  categories: string[];

  updatedAt?: string;
};

const LS_KEY = "vendor_profile_v1";

const CATEGORY_OPTIONS = [
  "Food & Beverage",
  "Coffee",
  "Mobile Catering",
  "Organic",
  "Fair Trade",
  "Arts & Crafts",
  "Jewelry",
  "Clothing",
  "Home Goods",
  "Technology",
  "Services",
  "Entertainment",
  "Health & Wellness",
  "Beauty",
  "Education",
  "Other",
];

function safeJsonParse<T = any>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): any | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const json = atob(b64 + pad);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function buildVendorHeaders(extra?: Record<string, string>) {
  const session = (typeof readSession === "function" ? (readSession() as any) : null) as any;

  const token: string = session?.accessToken || session?.token || "";
  const email: string = session?.email || session?.user?.email || "";

  const payload = token ? decodeJwtPayload(token) : null;
  const sub = payload?.sub ?? null;
  const numericId = sub != null && !isNaN(Number(sub)) ? String(sub) : "";

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(email ? { "x-user-email": String(email) } : {}),
    ...(numericId ? { "x-user-id": numericId } : {}),
    ...(extra ?? {}),
  };

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

function normalizeFromServer(x: any): VendorProfile {
  // Accept server shapes:
  // - flat { businessName, ... }
  // - snake_case
  // - or nested vendor_profile
  const src = (x && typeof x === "object" ? x : {}) as any;
  const blob = (src.vendor_profile && typeof src.vendor_profile === "object" ? src.vendor_profile : null) as any;

  const pick = (k: string, alt?: string) => (blob?.[k] ?? src?.[k] ?? (alt ? blob?.[alt] ?? src?.[alt] : undefined));

  return {
    businessName: String(pick("businessName", "business_name") ?? ""),
    businessDescription: String(pick("businessDescription", "business_description") ?? ""),
    businessType: String(pick("businessType", "business_type") ?? ""),
    yearsInBusiness: String(pick("yearsInBusiness", "years_in_business") ?? "5"),

    email: String(pick("email") ?? ""),
    phone: String(pick("phone") ?? ""),
    website: String(pick("website") ?? ""),

    country: String(pick("country") ?? "United States"),
    zip: String(pick("zip", "zip_code") ?? ""),

    logoDataUrl: String(pick("logoDataUrl", "logo_data_url") ?? ""),

    imageUrls: Array.isArray(pick("imageUrls", "image_urls")) ? pick("imageUrls", "image_urls") : [],
    videoUrls: Array.isArray(pick("videoUrls", "video_urls")) ? pick("videoUrls", "video_urls") : [],
    categories: Array.isArray(pick("categories")) ? pick("categories") : [],

    updatedAt: String(pick("updatedAt", "updated_at") ?? ""),
  };
}

export default function VendorBusinessProfileSetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const fileRef = useRef<HTMLInputElement>(null);

  const inboundToast = (location.state as any)?.toast as string | undefined;
  const redirectAfterSave = (location.state as any)?.redirectAfterSave as string | undefined;

  const [profile, setProfile] = useState<VendorProfile>({
    businessName: "",
    businessDescription: "",
    businessType: "",
    yearsInBusiness: "5",
    email: "",
    phone: "",
    website: "",
    country: "United States",
    zip: "",
    logoDataUrl: "",
    imageUrls: [],
    videoUrls: [],
    categories: [],
  });

  const [imgUrlInput, setImgUrlInput] = useState("");
  const [videoUrlInput, setVideoUrlInput] = useState("");

  const [statusMsg, setStatusMsg] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  /* ---------------- API ---------------- */

  async function apiGetMe() {
    const res = await fetch(`${API_BASE}/vendors/me`, {
      method: "GET",
      headers: buildVendorHeaders(),
    });
    return await readJsonOrThrow(res);
  }

  async function apiPutMe(next: VendorProfile) {
    // IMPORTANT: organizer reads vendor_profile from applications, so we send vendor_profile blob
    const body = {
      email: next.email,
      vendor_profile: {
        ...next,
        updatedAt: new Date().toISOString(),
      },
    };

    const res = await fetch(`${API_BASE}/vendors/me`, {
      method: "PUT",
      headers: buildVendorHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    return await readJsonOrThrow(res);
  }

  async function apiUploadLogo(file: File) {
    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch(`${API_BASE}/vendors/me/logo`, {
      method: "PUT",
      headers: buildVendorHeaders(), // DO NOT set Content-Type for FormData
      body: fd,
    });
    return await readJsonOrThrow(res);
  }

  /* ---------------- LOAD ---------------- */

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setStatusMsg("");
      try {
        // 1) Server first
        const data = await apiGetMe();
        if (!mounted) return;

        const serverProfile = normalizeFromServer(data);
        const hasSomething =
          !!serverProfile.email ||
          !!serverProfile.businessName ||
          !!serverProfile.phone ||
          !!serverProfile.logoDataUrl;

        if (hasSomething) {
          setProfile(serverProfile);
          try {
            localStorage.setItem(LS_KEY, JSON.stringify(serverProfile));
          } catch {}
          return;
        }

        // 2) Fallback local
        const local = safeJsonParse<VendorProfile>(localStorage.getItem(LS_KEY));
        if (local && mounted) setProfile(local);
      } catch {
        // Fallback local
        const local = safeJsonParse<VendorProfile>(localStorage.getItem(LS_KEY));
        if (local && mounted) setProfile(local);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- HELPERS ---------------- */

  function setField<K extends keyof VendorProfile>(k: K, v: VendorProfile[K]) {
    setProfile((p) => ({ ...p, [k]: v }));
    setStatusMsg("");
  }

  function toggleCategory(cat: string) {
    setProfile((p) => {
      const exists = p.categories.includes(cat);
      return { ...p, categories: exists ? p.categories.filter((c) => c !== cat) : [...p.categories, cat] };
    });
  }

  function validate() {
    const next: Record<string, string> = {};
    if (!profile.businessName.trim()) next.businessName = "Required";
    if (!profile.email.trim()) next.email = "Required";
    if (!profile.phone.trim()) next.phone = "Required";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save() {
    setStatusMsg("");
    if (!validate()) {
      setStatusMsg("Please complete required fields.");
      return;
    }

    const payload: VendorProfile = { ...profile, updatedAt: new Date().toISOString() };

    // Always cache locally
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch {}

    try {
      await apiPutMe(payload);
      setStatusMsg("Profile saved to server.");
    } catch (e: any) {
      setStatusMsg(`Saved locally, but server save failed: ${String(e?.message || e)}`);
      return;
    }

    if (redirectAfterSave) {
      setTimeout(() => navigate(redirectAfterSave), 600);
    }
  }

  async function onPickLogo(file: File | null) {
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setStatusMsg("Logo must be under 5MB.");
      return;
    }

    // Optimistic preview
    const reader = new FileReader();
    reader.onload = () => setField("logoDataUrl", String(reader.result));
    reader.readAsDataURL(file);

    try {
      const resp = await apiUploadLogo(file);
      const nextLogo = resp?.logoDataUrl || resp?.profile?.logoDataUrl || "";
      if (nextLogo) setField("logoDataUrl", String(nextLogo));
      setStatusMsg("Logo saved to server (/vendors/me/logo).");
      // Also persist the rest so organizer sees name/phone/etc
      await save();
    } catch (e: any) {
      setStatusMsg(`Logo saved locally, but server upload failed: ${String(e?.message || e)}`);
    }
  }

  function addImage() {
    if (!imgUrlInput.trim()) return;
    setProfile((p) => ({ ...p, imageUrls: [...p.imageUrls, imgUrlInput.trim()] }));
    setImgUrlInput("");
  }

  function removeImage(url: string) {
    setProfile((p) => ({ ...p, imageUrls: p.imageUrls.filter((x) => x !== url) }));
  }

  function addVideo() {
    if (!videoUrlInput.trim()) return;
    setProfile((p) => ({ ...p, videoUrls: [...p.videoUrls, videoUrlInput.trim()] }));
    setVideoUrlInput("");
  }

  function removeVideo(url: string) {
    setProfile((p) => ({ ...p, videoUrls: p.videoUrls.filter((x) => x !== url) }));
  }

  const initials = useMemo(() => {
    const parts = String(profile.businessName || "Vendor").trim().split(/\s+/).filter(Boolean);
    const a = (parts[0]?.[0] || "V").toUpperCase();
    const b = (parts[1]?.[0] || parts[0]?.[1] || "B").toUpperCase();
    return `${a}${b}`;
  }, [profile.businessName]);

  /* ---------------- UI ---------------- */

  return (
    <div className="space-y-6">
      {/* Top Buttons */}
      <div className="flex justify-between">
        <button
          onClick={() => navigate("/vendor/dashboard")}
          className="rounded-full border px-4 py-2 text-sm font-bold hover:bg-slate-50"
        >
          ← Back to Dashboard
        </button>

        <div className="flex gap-3">
          <button
            onClick={() => navigate("/vendor/profile/public")}
            className="rounded-full border px-4 py-2 text-sm font-bold hover:bg-slate-50"
          >
            Preview Public Profile
          </button>

          <button
            onClick={save}
            className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
            disabled={loading}
          >
            Save Profile
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="text-3xl font-extrabold">Business Profile Setup</div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm font-bold">
          Loading profile…
        </div>
      ) : null}

      {/* Toast */}
      {inboundToast ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
          {inboundToast}
        </div>
      ) : null}

      {statusMsg ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm font-bold">
          {statusMsg}
        </div>
      ) : null}

      {/* Basic Info */}
      <div className="rounded-2xl bg-white p-6 shadow ring-1 ring-slate-200">
        <div className="text-xl font-extrabold">Basic Information</div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {/* Logo */}
          <div>
            <div className="font-bold text-sm">Business Logo</div>

            <div className="mt-3 flex gap-4">
              <div className="h-28 w-28 overflow-hidden rounded-2xl border border-dashed bg-slate-50 flex items-center justify-center">
                {profile.logoDataUrl ? (
                  <img src={profile.logoDataUrl} className="h-full w-full object-cover" />
                ) : (
                  <div className="text-2xl font-extrabold text-indigo-600">{initials}</div>
                )}
              </div>

              <div>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="rounded-xl border px-4 py-2 font-bold hover:bg-slate-50"
                >
                  Upload Logo
                </button>

                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept="image/*"
                  onChange={(e) => onPickLogo(e.target.files?.[0] || null)}
                />

                <div className="mt-2 text-xs text-slate-500">Saves to server (/vendors/me/logo)</div>
              </div>
            </div>
          </div>

          {/* Name */}
          <div>
            <div className="text-sm font-bold">Business Name *</div>
            <input
              value={profile.businessName}
              onChange={(e) => setField("businessName", e.target.value)}
              className="mt-2 w-full rounded-xl border px-4 py-3"
            />
            {errors.businessName ? <div className="text-xs text-rose-600">{errors.businessName}</div> : null}
          </div>

          {/* Description */}
          <div className="md:col-span-2">
            <div className="text-sm font-bold">Business Description</div>
            <textarea
              value={profile.businessDescription}
              onChange={(e) => setField("businessDescription", e.target.value)}
              className="mt-2 w-full rounded-xl border px-4 py-3"
              rows={4}
            />
          </div>

          {/* Email */}
          <div>
            <div className="text-sm font-bold">Email *</div>
            <input
              value={profile.email}
              onChange={(e) => setField("email", e.target.value)}
              className="mt-2 w-full rounded-xl border px-4 py-3"
            />
            {errors.email ? <div className="text-xs text-rose-600">{errors.email}</div> : null}
          </div>

          {/* Phone */}
          <div>
            <div className="text-sm font-bold">Phone *</div>
            <input
              value={profile.phone}
              onChange={(e) => setField("phone", e.target.value)}
              className="mt-2 w-full rounded-xl border px-4 py-3"
            />
            {errors.phone ? <div className="text-xs text-rose-600">{errors.phone}</div> : null}
          </div>

          {/* Website */}
          <div>
            <div className="text-sm font-bold">Website</div>
            <input
              value={profile.website}
              onChange={(e) => setField("website", e.target.value)}
              className="mt-2 w-full rounded-xl border px-4 py-3"
              placeholder="https://…"
            />
          </div>

          {/* Country + Zip */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-sm font-bold">Country</div>
              <input
                value={profile.country}
                onChange={(e) => setField("country", e.target.value)}
                className="mt-2 w-full rounded-xl border px-4 py-3"
              />
            </div>
            <div>
              <div className="text-sm font-bold">ZIP</div>
              <input
                value={profile.zip}
                onChange={(e) => setField("zip", e.target.value)}
                className="mt-2 w-full rounded-xl border px-4 py-3"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Categories */}
      <div className="rounded-2xl bg-white p-6 shadow ring-1 ring-slate-200">
        <div className="text-xl font-extrabold">Business Categories</div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          {CATEGORY_OPTIONS.map((cat) => {
            const selected = profile.categories.includes(cat);
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`rounded-xl border px-4 py-2 font-bold ${
                  selected ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Images */}
      <div className="rounded-2xl bg-white p-6 shadow ring-1 ring-slate-200">
        <div className="text-xl font-extrabold">Business Images</div>

        <div className="mt-4 flex gap-3">
          <input
            value={imgUrlInput}
            onChange={(e) => setImgUrlInput(e.target.value)}
            className="w-full rounded-xl border px-4 py-3"
            placeholder="Image URL"
          />
          <button onClick={addImage} className="rounded-xl bg-indigo-600 px-4 py-2 text-white font-bold">
            Add
          </button>
        </div>

        {profile.imageUrls.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {profile.imageUrls.map((u) => (
              <div key={u} className="rounded-xl border border-slate-200 p-3">
                <div className="aspect-[4/3] overflow-hidden rounded-lg bg-slate-50">
                  <img src={u} className="h-full w-full object-cover" />
                </div>
                <button
                  className="mt-2 text-xs font-bold text-slate-600 hover:text-slate-900"
                  onClick={() => removeImage(u)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Videos */}
      <div className="rounded-2xl bg-white p-6 shadow ring-1 ring-slate-200">
        <div className="text-xl font-extrabold">Business Videos</div>

        <div className="mt-4 flex gap-3">
          <input
            value={videoUrlInput}
            onChange={(e) => setVideoUrlInput(e.target.value)}
            className="w-full rounded-xl border px-4 py-3"
            placeholder="Video URL"
          />
          <button onClick={addVideo} className="rounded-xl bg-indigo-600 px-4 py-2 text-white font-bold">
            Add
          </button>
        </div>

        {profile.videoUrls.length ? (
          <div className="mt-4 space-y-2">
            {profile.videoUrls.map((u) => (
              <div key={u} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                <div className="text-sm font-semibold text-slate-700 truncate">{u}</div>
                <button className="text-xs font-bold text-slate-600 hover:text-slate-900" onClick={() => removeVideo(u)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Bottom Save */}
      <div className="flex justify-end pb-8">
        <button onClick={save} className="rounded-full bg-indigo-600 px-6 py-3 text-white font-bold hover:bg-indigo-700">
          Save Profile
        </button>
      </div>
    </div>
  );
}
