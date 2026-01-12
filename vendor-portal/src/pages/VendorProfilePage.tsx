// src/pages/VendorProfilePage.tsx
//
// Vendor control center: edit the vendor's own public profile.
// Mirrors OrganizerProfilePage style and API patterns.
//
// Backend endpoints (expected):
//   GET   /vendor/profile
//   PATCH /vendor/profile
//
// Auth:
//   Reads access_token from localStorage and sends it as Bearer.

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE } from "../api";

type VendorProfile = {
  id?: number;
  user_id?: number;
  business_name: string | null;
  contact_name: string | null;
  public_email: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  about: string | null;
  checklist_tags: string[];
  categories: string[];
};

type FetchState = "idle" | "loading" | "loaded" | "saving" | "error";

const VendorProfilePage: React.FC = () => {
  const navigate = useNavigate();

  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Core profile fields
  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [publicEmail, setPublicEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [city, setCity] = useState("");
  const [story, setStory] = useState("");
  const [checklistTagsInput, setChecklistTagsInput] = useState("");
  const [categoriesInput, setCategoriesInput] = useState("");

  // License / permit UI (not yet wired to backend – safe placeholders)
  const [licenseNumber, setLicenseNumber] = useState("");
  const [insuranceStatus, setInsuranceStatus] = useState<
    "not_provided" | "pending" | "verified"
  >("not_provided");
  const [permitStatus, setPermitStatus] = useState<
    "not_provided" | "pending" | "verified"
  >("not_provided");

  const accessToken =
    typeof window !== "undefined"
      ? localStorage.getItem("access_token")
      : null;

  const authHeaders: HeadersInit = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};

  const applyProfileToForm = (profile: VendorProfile) => {
    setBusinessName(profile.business_name ?? "");
    setContactName(profile.contact_name ?? "");
    setPublicEmail(profile.public_email ?? "");
    setPhone(profile.phone ?? "");
    setWebsite(profile.website ?? "");
    setCity(profile.city ?? "");
    setStory(profile.about ?? ""); // backend uses `about`
    setChecklistTagsInput((profile.checklist_tags || []).join(", "));
    setCategoriesInput((profile.categories || []).join(", "));
  };

  const loadProfile = async () => {
    try {
      setState("loading");
      setError(null);
      setSuccessMessage(null);

      const res = await fetch(`${API_BASE}/vendor/profile`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to load profile: ${res.status} ${text}`);
      }

      const data = (await res.json()) as VendorProfile;
      applyProfileToForm({
        business_name: data.business_name ?? "",
        contact_name: data.contact_name ?? "",
        public_email: data.public_email ?? "",
        phone: data.phone ?? "",
        website: data.website ?? "",
        city: data.city ?? "",
        about: data.about ?? "",
        checklist_tags: data.checklist_tags || [],
        categories: data.categories || [],
      });

      // License/permit fields are UI-only for now – if you later add them to the API,
      // you can hydrate them here from `data`.
      setState("loaded");
    } catch (err: any) {
      console.error("Failed to load vendor profile", err);
      setError(err?.message ?? "Failed to load vendor profile");
      setState("error");
    }
  };

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parseCommaList = (input: string): string[] =>
    input
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setState("saving");

    const checklistTags = parseCommaList(checklistTagsInput);
    const categories = parseCommaList(categoriesInput);

    try {
      const res = await fetch(`${API_BASE}/vendor/profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          business_name: businessName || null,
          contact_name: contactName || null,
          public_email: publicEmail || null,
          phone: phone || null,
          website: website || null,
          city: city || null,
          about: story || null,
          checklist_tags: checklistTags,
          categories,
          // TODO: once backend supports these, include:
          // license_number: licenseNumber || null,
          // insurance_status: insuranceStatus,
          // permit_status: permitStatus,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to save profile: ${res.status} ${text}`);
      }

      const data = (await res.json()) as VendorProfile;
      applyProfileToForm({
        business_name: data.business_name ?? "",
        contact_name: data.contact_name ?? "",
        public_email: data.public_email ?? "",
        phone: data.phone ?? "",
        website: data.website ?? "",
        city: data.city ?? "",
        about: data.about ?? "",
        checklist_tags: data.checklist_tags || [],
        categories: data.categories || [],
      });

      setSuccessMessage("Profile saved successfully.");
      setState("loaded");
    } catch (err: any) {
      console.error("Failed to save vendor profile", err);
      setError(err?.message ?? "Failed to save vendor profile");
      setState("error");
    }
  };

  const disabled = state === "loading" || state === "saving";

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Top bar / breadcrumbs */}
        <div className="mb-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => navigate("/vendor/dashboard")}
            className="text-[11px] font-medium text-emerald-300 hover:underline"
          >
            ← Back to vendor dashboard
          </button>
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300">
            Vendor profile
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* Profile editor */}
          <section className="rounded-2xl bg-slate-900 p-5 shadow-sm ring-1 ring-slate-800">
            <header className="mb-4 flex flex-col gap-1">
              <h1 className="text-xl font-bold text-white">My vendor profile</h1>
              <p className="text-xs text-slate-300">
                This is what organizers and shoppers see when they click on your
                name in event directories.
              </p>
            </header>

            {error && (
              <div className="mb-3 rounded-xl bg-red-950/70 p-3 text-[11px] text-red-100">
                <p className="font-semibold">There was a problem.</p>
                <p className="mt-1 text-red-200">{error}</p>
              </div>
            )}

            {successMessage && (
              <div className="mb-3 rounded-xl bg-emerald-950/60 p-3 text-[11px] text-emerald-100">
                {successMessage}
              </div>
            )}

            <form
              onSubmit={handleSave}
              className="space-y-4 text-xs text-slate-100"
            >
              {/* Business + contact */}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-slate-300">
                    Business name
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    disabled={disabled}
                    placeholder="Funnel Cake & Shake"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-slate-300">
                    Owner / contact name
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    disabled={disabled}
                    placeholder="Your name"
                  />
                </div>
              </div>

              {/* Public contact info */}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-slate-300">
                    Public email (what organizers see)
                  </label>
                  <input
                    type="email"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    value={publicEmail}
                    onChange={(e) => setPublicEmail(e.target.value)}
                    disabled={disabled}
                    placeholder="hello@funnelcakeandshake.com"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-slate-300">
                    Phone
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={disabled}
                    placeholder="555-555-5555"
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-slate-300">
                    Website or shop link
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    disabled={disabled}
                    placeholder="https://yourshop.com"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-slate-300">
                    City / area
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    disabled={disabled}
                    placeholder="Atlanta, GA"
                  />
                </div>
              </div>

              {/* Story */}
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-slate-300">
                  Your story
                </label>
                <textarea
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  rows={4}
                  value={story}
                  onChange={(e) => setStory(e.target.value)}
                  disabled={disabled}
                  placeholder="Tell organizers what you sell, your vibe, how your booth feels, and what makes you different."
                />
              </div>

              {/* Tags + categories */}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-slate-300">
                    Checklist tags
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    value={checklistTagsInput}
                    onChange={(e) => setChecklistTagsInput(e.target.value)}
                    disabled={disabled}
                    placeholder="food truck, dessert, family-friendly, generator on-board"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">
                    Comma-separated. These show up as badges on your profile.
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-slate-300">
                    Categories
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    value={categoriesInput}
                    onChange={(e) => setCategoriesInput(e.target.value)}
                    disabled={disabled}
                    placeholder="food, sweets, festival snack"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">
                    Comma-separated. Used to match you with events.
                  </p>
                </div>
              </div>

              {/* License & permit verification – UI only for now */}
              <div className="mt-4 rounded-2xl border border-emerald-800 bg-emerald-950/40 p-4">
                <h2 className="text-xs font-semibold text-emerald-100">
                  License &amp; permit verification (coming soon)
                </h2>
                <p className="mt-1 text-[10px] text-emerald-200/80">
                  Organizers often need to confirm health permits, insurance, and
                  business licenses. This section prepares your profile for that
                  workflow.
                </p>

                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <label className="block text-[11px] font-medium text-emerald-100">
                      Business license #
                    </label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-emerald-700 bg-slate-950 px-2 py-1.5 text-xs text-emerald-50 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                      value={licenseNumber}
                      onChange={(e) => setLicenseNumber(e.target.value)}
                      disabled={disabled}
                      placeholder="Optional for now"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] font-medium text-emerald-100">
                      Insurance status
                    </label>
                    <select
                      className="w-full rounded-lg border border-emerald-700 bg-slate-950 px-2 py-1.5 text-xs text-emerald-50 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                      value={insuranceStatus}
                      onChange={(e) =>
                        setInsuranceStatus(
                          e.target.value as "not_provided" | "pending" | "verified"
                        )
                      }
                      disabled={disabled}
                    >
                      <option value="not_provided">Not provided</option>
                      <option value="pending">Pending verification</option>
                      <option value="verified">Verified (future)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] font-medium text-emerald-100">
                      Permit status
                    </label>
                    <select
                      className="w-full rounded-lg border border-emerald-700 bg-slate-950 px-2 py-1.5 text-xs text-emerald-50 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                      value={permitStatus}
                      onChange={(e) =>
                        setPermitStatus(
                          e.target.value as "not_provided" | "pending" | "verified"
                        )
                      }
                      disabled={disabled}
                    >
                      <option value="not_provided">Not provided</option>
                      <option value="pending">Pending verification</option>
                      <option value="verified">Verified (future)</option>
                    </select>
                  </div>
                </div>

                <p className="mt-2 text-[10px] text-emerald-200/80">
                  Later, organizers will be able to request uploads and mark these as
                  verified. For now, this is for your own tracking.
                </p>
              </div>

              {/* Actions */}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={disabled}
                  className="inline-flex items-center rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {state === "saving" ? "Saving..." : "Save profile"}
                </button>
                <button
                  type="button"
                  onClick={loadProfile}
                  disabled={disabled}
                  className="inline-flex items-center rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Reload from server
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/vendor/public-preview")}
                  className="inline-flex items-center rounded-xl border border-emerald-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-emerald-200 shadow-sm hover:bg-emerald-800/40"
                >
                  View public preview
                </button>
              </div>
            </form>
          </section>

          {/* Right column: quick nav & tips */}
          <aside className="space-y-4">
            <section className="rounded-2xl bg-slate-900 p-4 shadow-sm ring-1 ring-slate-800">
              <h2 className="text-sm font-semibold text-white">
                Vendor control center
              </h2>
              <p className="mt-1 text-[11px] text-slate-300">
                Move between your events, applications, and public presence.
              </p>
              <div className="mt-3 grid gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => navigate("/vendor/events")}
                  className="inline-flex items-center justify-between rounded-xl bg-slate-800 px-3 py-2 text-slate-100 hover:bg-slate-700"
                >
                  <span>Browse events</span>
                  <span className="text-[10px] text-slate-300">→</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/vendor/applications")}
                  className="inline-flex items-center justify-between rounded-xl bg-slate-800 px-3 py-2 text-slate-100 hover:bg-slate-700"
                >
                  <span>My applications</span>
                  <span className="text-[10px] text-slate-300">→</span>
                </button>
              </div>
            </section>

            <section className="rounded-2xl bg-slate-900 p-4 shadow-sm ring-1 ring-slate-800">
              <h2 className="text-sm font-semibold text-white">
                Make your profile pop
              </h2>
              <ul className="mt-2 space-y-1.5 text-[11px] text-slate-300">
                <li>• Be specific about what you sell.</li>
                <li>• Use checklist tags to highlight power, trailer size, etc.</li>
                <li>• Include your primary service area so organizers can match you.</li>
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default VendorProfilePage;
