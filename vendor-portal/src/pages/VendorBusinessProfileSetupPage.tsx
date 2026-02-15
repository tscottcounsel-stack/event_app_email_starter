import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

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

  /* ---------------- LOAD ---------------- */

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setProfile(JSON.parse(raw));
    } catch {}
  }, []);

  /* ---------------- HELPERS ---------------- */

  function setField<K extends keyof VendorProfile>(k: K, v: VendorProfile[K]) {
    setProfile((p) => ({ ...p, [k]: v }));
    setStatusMsg("");
  }

  function toggleCategory(cat: string) {
    setProfile((p) => {
      const exists = p.categories.includes(cat);
      return {
        ...p,
        categories: exists
          ? p.categories.filter((c) => c !== cat)
          : [...p.categories, cat],
      };
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

  function save() {
    if (!validate()) {
      setStatusMsg("Please complete required fields.");
      return;
    }

    const payload = {
      ...profile,
      updatedAt: new Date().toISOString(),
    };

    localStorage.setItem(LS_KEY, JSON.stringify(payload));
    setStatusMsg("Profile saved.");

    if (redirectAfterSave) {
      setTimeout(() => navigate(redirectAfterSave), 800);
    }
  }

  function onPickLogo(file: File | null) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setStatusMsg("Logo must be under 5MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setField("logoDataUrl", String(reader.result));
    reader.readAsDataURL(file);
  }

  function addImage() {
    if (!imgUrlInput.trim()) return;
    setProfile((p) => ({
      ...p,
      imageUrls: [...p.imageUrls, imgUrlInput.trim()],
    }));
    setImgUrlInput("");
  }

  function addVideo() {
    if (!videoUrlInput.trim()) return;
    setProfile((p) => ({
      ...p,
      videoUrls: [...p.videoUrls, videoUrlInput.trim()],
    }));
    setVideoUrlInput("");
  }

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
            className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-700"
          >
            Save Profile
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="text-3xl font-extrabold">Business Profile Setup</div>

      {/* Toast */}
      {inboundToast && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
          {inboundToast}
        </div>
      )}

      {statusMsg && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm font-bold">
          {statusMsg}
        </div>
      )}

      {/* Basic Info */}
      <div className="rounded-2xl bg-white p-6 shadow ring-1 ring-slate-200">
        <div className="text-xl font-extrabold">Basic Information</div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {/* Logo */}
          <div>
            <div className="font-bold text-sm">Business Logo</div>

            <div className="mt-3 flex gap-4">
              <div className="h-28 w-28 overflow-hidden rounded-2xl border border-dashed bg-slate-50">
                {profile.logoDataUrl && (
                  <img src={profile.logoDataUrl} className="h-full w-full object-cover" />
                )}
              </div>

              <div>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="rounded-xl border px-4 py-2 font-bold"
                >
                  Upload Logo
                </button>

                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  onChange={(e) => onPickLogo(e.target.files?.[0] || null)}
                />
              </div>
            </div>
          </div>

          {/* Name */}
          <div>
            <div className="text-sm font-bold">
              Business Name *
            </div>
            <input
              value={profile.businessName}
              onChange={(e) => setField("businessName", e.target.value)}
              className="mt-2 w-full rounded-xl border px-4 py-3"
            />
            {errors.businessName && (
              <div className="text-xs text-rose-600">{errors.businessName}</div>
            )}
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
          </div>

          {/* Phone */}
          <div>
            <div className="text-sm font-bold">Phone *</div>
            <input
              value={profile.phone}
              onChange={(e) => setField("phone", e.target.value)}
              className="mt-2 w-full rounded-xl border px-4 py-3"
            />
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
                  selected
                    ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                    : "border-slate-200 hover:bg-slate-50"
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
          <button
            onClick={addImage}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-white font-bold"
          >
            Add
          </button>
        </div>
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
          <button
            onClick={addVideo}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-white font-bold"
          >
            Add
          </button>
        </div>
      </div>

      {/* Bottom Save */}
      <div className="flex justify-end pb-8">
        <button
          onClick={save}
          className="rounded-full bg-indigo-600 px-6 py-3 text-white font-bold hover:bg-indigo-700"
        >
          Save Profile
        </button>
      </div>
    </div>
  );
}
