import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { readSession } from "../auth/authStorage";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "https://event-app-api-production-ccce.up.railway.app";

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

const EMPTY_PROFILE: VendorProfile = {
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
  updatedAt: "",
};

const LS_KEY = "vendor_profile_v1";

const CATEGORY_OPTIONS = [
  "Food & Beverage",
  "Coffee & Beverages",
  "Bakery & Desserts",
  "Mobile Catering",
  "Arts & Crafts",
  "Jewelry",
  "Clothing & Apparel",
  "Beauty & Skincare",
  "Health & Wellness",
  "Home Goods",
  "Technology & Electronics",
  "Entertainment",
  "Professional Services",
  "Education",
  "Non-Profit",
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

function asString(value: any, fallback = "") {
  if (value == null) return fallback;
  return String(value);
}

function asStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(Boolean).map((item) => String(item));
}

function normalizeFromApplication(source: any): VendorProfile {
  const src = source && typeof source === "object" ? source : {};
  const vendorProfile = src?.vendor_profile && typeof src.vendor_profile === "object" ? src.vendor_profile : {};

  const pick = (...keys: string[]) => {
    for (const key of keys) {
      if (vendorProfile?.[key] != null) return vendorProfile[key];
      if (src?.[key] != null) return src[key];
    }
    return undefined;
  };

  const businessName = asString(
    pick("businessName", "business_name", "vendor_business_name", "company_name", "name"),
    ""
  );
  const businessDescription = asString(
    pick("businessDescription", "business_description", "description", "vendor_description"),
    ""
  );

  return {
    businessName,
    businessDescription,
    businessType: asString(pick("businessType", "business_type", "vendor_type"), ""),
    yearsInBusiness: asString(pick("yearsInBusiness", "years_in_business"), "5"),

    email: asString(pick("email", "vendor_email", "contact_email"), ""),
    phone: asString(pick("phone", "vendor_phone", "contact_phone"), ""),
    website: asString(pick("website", "website_url"), ""),

    country: asString(pick("country"), "United States"),
    zip: asString(pick("zip", "zip_code", "postal_code"), ""),

    logoDataUrl: asString(pick("logoDataUrl", "logo_data_url", "logo_url", "logoUrl"), ""),

    imageUrls: asStringArray(pick("imageUrls", "image_urls", "images")),
    videoUrls: asStringArray(pick("videoUrls", "video_urls", "videos")),
    categories: asStringArray(pick("categories", "vendor_categories")),

    updatedAt: asString(pick("updatedAt", "updated_at"), ""),
  };
}

function mergeProfiles(base: VendorProfile, override?: Partial<VendorProfile> | null): VendorProfile {
  const next = override ?? {};
  return {
    ...base,
    ...next,
    businessName: asString(next.businessName ?? base.businessName, ""),
    businessDescription: asString(next.businessDescription ?? base.businessDescription, ""),
    businessType: asString(next.businessType ?? base.businessType, ""),
    yearsInBusiness: asString(next.yearsInBusiness ?? base.yearsInBusiness, "5"),
    email: asString(next.email ?? base.email, ""),
    phone: asString(next.phone ?? base.phone, ""),
    website: asString(next.website ?? base.website, ""),
    country: asString(next.country ?? base.country, "United States"),
    zip: asString(next.zip ?? base.zip, ""),
    logoDataUrl: asString(next.logoDataUrl ?? base.logoDataUrl, ""),
    imageUrls: asStringArray(next.imageUrls ?? base.imageUrls),
    videoUrls: asStringArray(next.videoUrls ?? base.videoUrls),
    categories: asStringArray(next.categories ?? base.categories),
    updatedAt: asString(next.updatedAt ?? base.updatedAt, ""),
  };
}

export default function VendorBusinessProfileSetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const fileRef = useRef<HTMLInputElement>(null);

  const inboundToast = (location.state as any)?.toast as string | undefined;
  const redirectAfterSave = (location.state as any)?.redirectAfterSave as string | undefined;

  const [profile, setProfile] = useState<VendorProfile>(EMPTY_PROFILE);
  const [imgUrlInput, setImgUrlInput] = useState("");
  const [videoUrlInput, setVideoUrlInput] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  async function apiGetApplications() {
    const res = await fetch(`${API_BASE}/vendor/applications`, {
      method: "GET",
      headers: buildVendorHeaders(),
    });
    return await readJsonOrThrow(res);
  }

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setStatusMsg("");

      const local = safeJsonParse<VendorProfile>(localStorage.getItem(LS_KEY));
      const localProfile = mergeProfiles(EMPTY_PROFILE, local);

      try {
        const data = await apiGetApplications();
        if (!mounted) return;

        const applications = Array.isArray(data)
          ? data
          : Array.isArray(data?.applications)
          ? data.applications
          : [];

        const firstApp = applications[0] ?? null;
        const applicationProfile = mergeProfiles(EMPTY_PROFILE, normalizeFromApplication(firstApp));

        const hasApplicationData =
          !!applicationProfile.businessName ||
          !!applicationProfile.email ||
          !!applicationProfile.phone ||
          applicationProfile.categories.length > 0 ||
          !!applicationProfile.logoDataUrl;

        const merged = mergeProfiles(applicationProfile, localProfile);
        setProfile(hasApplicationData ? merged : localProfile);

        if (hasApplicationData) {
          try {
            localStorage.setItem(LS_KEY, JSON.stringify(merged));
          } catch {}
        }
      } catch (e: any) {
        if (!mounted) return;
        setProfile(localProfile);
        setStatusMsg(
          `Loaded local profile only. Vendor profile backend is not available yet${
            e?.message ? `: ${String(e.message)}` : "."
          }`
        );
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  function setField<K extends keyof VendorProfile>(k: K, v: VendorProfile[K]) {
    setProfile((p) => mergeProfiles(p, { [k]: v } as Partial<VendorProfile>));
    setStatusMsg("");
  }

  function toggleCategory(cat: string) {
    setProfile((p) => {
      const current = Array.isArray(p?.categories) ? p.categories : [];
      const exists = current.includes(cat);
      return {
        ...p,
        categories: exists ? current.filter((c) => c !== cat) : [...current, cat],
      };
    });
  }

  function validate() {
    const next: Record<string, string> = {};
    if (!String(profile?.businessName ?? "").trim()) next.businessName = "Required";
    if (!String(profile?.email ?? "").trim()) next.email = "Required";
    if (!String(profile?.phone ?? "").trim()) next.phone = "Required";
    if (!Array.isArray(profile?.categories) || profile.categories.length === 0) {
      next.categories = "Select at least one category";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

 async function save() {
  setStatusMsg("");

  if (!validate()) {
    setStatusMsg("Please complete required fields.");
    return;
  }

  const payload: VendorProfile = mergeProfiles(profile, {
    updatedAt: new Date().toISOString(),
  });

  try {
    const res = await fetch(`${API_BASE}/vendors/me`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildVendorHeaders(),
      },
      body: JSON.stringify({
        businessName: payload.businessName,
        description: payload.businessDescription,
        categories: payload.categories,
        email: payload.email,
        phone: payload.phone,
        website: payload.website,
        instagram: "",
        facebook: "",
        logoUrl: payload.logoDataUrl || "",
        bannerUrl: "",
        contactName: payload.businessName,
      }),
    });

    await readJsonOrThrow(res);

    try {
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch {}

    setProfile(payload);
    setStatusMsg("Profile saved successfully.");
  } catch (e: any) {
    console.error(e);
    setStatusMsg(`Failed to save profile to server: ${String(e?.message || e)}`);
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

    const reader = new FileReader();
    reader.onload = () => {
      setField("logoDataUrl", String(reader.result || ""));
      setStatusMsg("Logo saved locally.");
    };
    reader.readAsDataURL(file);
  }

  function addImage() {
    const value = String(imgUrlInput || "").trim();
    if (!value) return;
    setProfile((p) => ({ ...p, imageUrls: [...(p?.imageUrls ?? []), value] }));
    setImgUrlInput("");
  }

  function removeImage(url: string) {
    setProfile((p) => ({ ...p, imageUrls: (p?.imageUrls ?? []).filter((x) => x !== url) }));
  }

  function addVideo() {
    const value = String(videoUrlInput || "").trim();
    if (!value) return;
    setProfile((p) => ({ ...p, videoUrls: [...(p?.videoUrls ?? []), value] }));
    setVideoUrlInput("");
  }

  function removeVideo(url: string) {
    setProfile((p) => ({ ...p, videoUrls: (p?.videoUrls ?? []).filter((x) => x !== url) }));
  }

  const initials = useMemo(() => {
    const parts = String(profile?.businessName || "Vendor")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const a = (parts[0]?.[0] || "V").toUpperCase();
    const b = (parts[1]?.[0] || parts[0]?.[1] || "B").toUpperCase();
    return `${a}${b}`;
  }, [profile?.businessName]);

  return (
    <div className="space-y-6">
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

      <div className="text-3xl font-extrabold">Business Profile Setup</div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm font-bold">
          Loading profile…
        </div>
      ) : null}

      {inboundToast ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
          {inboundToast}
        </div>
      ) : null}

      {statusMsg ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm font-bold">{statusMsg}</div>
      ) : null}

      <div className="rounded-2xl bg-white p-6 shadow ring-1 ring-slate-200">
        <div className="text-xl font-extrabold">Basic Information</div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <div className="font-bold text-sm">Business Logo</div>

            <div className="mt-3 flex gap-4">
              <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl border border-dashed bg-slate-50">
                {profile?.logoDataUrl ? (
                  <img src={profile.logoDataUrl} className="h-full w-full object-cover" alt="Business logo" />
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

                <div className="mt-2 text-xs text-slate-500">Temporary mode: logo is stored locally for preview.</div>
              </div>
            </div>
          </div>

          <div>
            <div className="text-sm font-bold">Business Name *</div>
            <input
              value={profile?.businessName ?? ""}
              onChange={(e) => setField("businessName", e.target.value)}
              className="mt-2 w-full rounded-xl border px-4 py-3"
            />
            {errors.businessName ? <div className="text-xs text-rose-600">{errors.businessName}</div> : null}
          </div>

          <div className="md:col-span-2">
            <div className="text-sm font-bold">Business Description</div>
            <textarea
              value={profile?.businessDescription ?? ""}
              onChange={(e) => setField("businessDescription", e.target.value)}
              className="mt-2 w-full rounded-xl border px-4 py-3"
              rows={4}
            />
          </div>

          <div>
            <div className="text-sm font-bold">Email *</div>
            <input
              value={profile?.email ?? ""}
              onChange={(e) => setField("email", e.target.value)}
              className="mt-2 w-full rounded-xl border px-4 py-3"
            />
            {errors.email ? <div className="text-xs text-rose-600">{errors.email}</div> : null}
          </div>

          <div>
            <div className="text-sm font-bold">Phone *</div>
            <input
              value={profile?.phone ?? ""}
              onChange={(e) => setField("phone", e.target.value)}
              className="mt-2 w-full rounded-xl border px-4 py-3"
            />
            {errors.phone ? <div className="text-xs text-rose-600">{errors.phone}</div> : null}
          </div>

          <div>
            <div className="text-sm font-bold">Website</div>
            <input
              value={profile?.website ?? ""}
              onChange={(e) => setField("website", e.target.value)}
              className="mt-2 w-full rounded-xl border px-4 py-3"
              placeholder="https://…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-sm font-bold">Country</div>
              <input
                value={profile?.country ?? "United States"}
                onChange={(e) => setField("country", e.target.value)}
                className="mt-2 w-full rounded-xl border px-4 py-3"
              />
            </div>
            <div>
              <div className="text-sm font-bold">ZIP</div>
              <input
                value={profile?.zip ?? ""}
                onChange={(e) => setField("zip", e.target.value)}
                className="mt-2 w-full rounded-xl border px-4 py-3"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow ring-1 ring-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xl font-extrabold">Business Categories</div>
            <div className="mt-1 text-sm font-semibold text-slate-600">
              Select all categories that fit your business. These categories are used in vendor search and filtering.
            </div>
          </div>

          <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-extrabold text-slate-700">
            {(profile?.categories ?? []).length} selected
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
          {CATEGORY_OPTIONS.map((cat) => {
            const selected = (profile?.categories ?? []).includes(cat);
            return (
              <button
                type="button"
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`rounded-xl border px-4 py-3 text-left font-bold transition ${
                  selected
                    ? "border-indigo-300 bg-indigo-50 text-indigo-700 shadow-sm"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {errors.categories ? <div className="mt-3 text-xs font-bold text-rose-600">{errors.categories}</div> : null}

        {(profile?.categories ?? []).length > 0 ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {(profile?.categories ?? []).map((cat) => (
              <span key={cat} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-extrabold text-slate-700">
                {cat}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl bg-white p-6 shadow ring-1 ring-slate-200">
        <div className="text-xl font-extrabold">Business Images</div>

        <div className="mt-4 flex gap-3">
          <input
            value={imgUrlInput}
            onChange={(e) => setImgUrlInput(e.target.value)}
            className="w-full rounded-xl border px-4 py-3"
            placeholder="Image URL"
          />
          <button onClick={addImage} className="rounded-xl bg-indigo-600 px-4 py-2 font-bold text-white">
            Add
          </button>
        </div>

        {(profile?.imageUrls ?? []).length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {(profile?.imageUrls ?? []).map((u) => (
              <div key={u} className="rounded-xl border border-slate-200 p-3">
                <div className="aspect-[4/3] overflow-hidden rounded-lg bg-slate-50">
                  <img src={u} className="h-full w-full object-cover" alt="Business" />
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

      <div className="rounded-2xl bg-white p-6 shadow ring-1 ring-slate-200">
        <div className="text-xl font-extrabold">Business Videos</div>

        <div className="mt-4 flex gap-3">
          <input
            value={videoUrlInput}
            onChange={(e) => setVideoUrlInput(e.target.value)}
            className="w-full rounded-xl border px-4 py-3"
            placeholder="Video URL"
          />
          <button onClick={addVideo} className="rounded-xl bg-indigo-600 px-4 py-2 font-bold text-white">
            Add
          </button>
        </div>

        {(profile?.videoUrls ?? []).length ? (
          <div className="mt-4 space-y-2">
            {(profile?.videoUrls ?? []).map((u) => (
              <div key={u} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                <div className="truncate text-sm font-semibold text-slate-700">{u}</div>
                <button className="text-xs font-bold text-slate-600 hover:text-slate-900" onClick={() => removeVideo(u)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex justify-end pb-8">
        <button onClick={save} className="rounded-full bg-indigo-600 px-6 py-3 font-bold text-white hover:bg-indigo-700">
          Save Profile
        </button>
      </div>
    </div>
  );
}



