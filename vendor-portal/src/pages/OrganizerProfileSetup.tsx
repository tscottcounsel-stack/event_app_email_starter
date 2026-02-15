import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type OrganizerProfile = {
  organizationName: string;
  organizationType: string;
  contactName: string;
  email: string;
  phone: string;
  website: string;
  location: string;
  profileComplete: boolean;
  updatedAt: string;
};

const LS_KEY = "organizer_profile_v1";

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function loadProfile(): OrganizerProfile | null {
  return safeJsonParse<OrganizerProfile>(localStorage.getItem(LS_KEY));
}

function saveProfile(profile: OrganizerProfile) {
  localStorage.setItem(LS_KEY, JSON.stringify(profile));
}

const organizationTypes = [
  "Conference / Expo",
  "Festival",
  "Trade Show",
  "Market / Pop-up",
  "Concert / Entertainment",
  "Community Event",
  "Other",
];

export default function OrganizerProfileSetup() {
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState(organizationTypes[0]);
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [location, setLocation] = useState("");

  useEffect(() => {
    const existing = loadProfile();
    if (!existing) return;

    setOrgName(existing.organizationName || "");
    setOrgType(existing.organizationType || organizationTypes[0]);
    setContactName(existing.contactName || "");
    setEmail(existing.email || "");
    setPhone(existing.phone || "");
    setWebsite(existing.website || "");
    setLocation(existing.location || "");
  }, []);

  const isComplete = useMemo(() => {
    // keep it simple; you can tighten these rules later
    return Boolean(orgName.trim() && contactName.trim() && email.trim());
  }, [orgName, contactName, email]);

  function onSave() {
    const now = new Date().toISOString();

    const payload: OrganizerProfile = {
      organizationName: orgName.trim(),
      organizationType: orgType,
      contactName: contactName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      website: website.trim(),
      location: location.trim(),
      profileComplete: isComplete,
      updatedAt: now,
    };

    saveProfile(payload);
    toast.success("Organizer profile saved");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold text-slate-900">Organizer Profile</h1>
          <p className="mt-1 text-sm text-slate-600">
            This drives what vendors and the public see. (Demo persistence: localStorage)
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-sm font-semibold text-slate-800">Organization name *</label>
              <input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                placeholder="e.g. VendorConnect Events LLC"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-800">Organization type</label>
              <select
                value={orgType}
                onChange={(e) => setOrgType(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                {organizationTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-800">Primary contact name *</label>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                placeholder="Full name"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-800">Contact email *</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                placeholder="email@example.com"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-800">Contact phone</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                placeholder="(555) 555-5555"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-800">Website</label>
              <input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                placeholder="https://"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="text-sm font-semibold text-slate-800">Location</label>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                placeholder="City, State"
              />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              Status:{" "}
              <span className={isComplete ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>
                {isComplete ? "Complete" : "Incomplete"}
              </span>
            </div>

            <button
              type="button"
              onClick={onSave}
              className="rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
            >
              Save Profile
            </button>
          </div>

          <div className="mt-3 text-xs text-slate-400">Storage key: {LS_KEY}</div>
        </div>
      </div>
    </div>
  );
}
