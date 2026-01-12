import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  fetchOrganizerProfile,
  saveOrganizerProfile,
  getAccessToken,
} from "../api";

type FetchState = "idle" | "loading" | "loaded" | "saving" | "error";

type OrganizerProfile = {
  id?: number;
  user_id?: number;
  business_name?: string | null;
  contact_name?: string | null;
  public_email?: string | null;
  phone?: string | null;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  organizer_story?: string | null;
  checklist_tags?: string[] | null;
  organizer_categories?: string[] | null;
  [k: string]: any;
};

const EMPTY: Required<
  Pick<
    OrganizerProfile,
    | "business_name"
    | "contact_name"
    | "public_email"
    | "phone"
    | "website"
    | "city"
    | "state"
    | "organizer_story"
    | "checklist_tags"
    | "organizer_categories"
  >
> = {
  business_name: "",
  contact_name: "",
  public_email: "",
  phone: "",
  website: "",
  city: "",
  state: "",
  organizer_story: "",
  checklist_tags: [],
  organizer_categories: [],
};

function parseCommaList(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const OrganizerProfilePage: React.FC = () => {
  const navigate = useNavigate();

  const [status, setStatus] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [notImplemented, setNotImplemented] = useState(false);

  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [publicEmail, setPublicEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [city, setCity] = useState("");
  const [stateField, setStateField] = useState("");
  const [story, setStory] = useState("");

  const [checklistTagsInput, setChecklistTagsInput] = useState("");
  const [categoriesInput, setCategoriesInput] = useState("");

  const token = useMemo(() => getAccessToken(), []);

  function applyProfileToForm(profile: OrganizerProfile | null | undefined) {
    const p = { ...EMPTY, ...(profile || {}) };

    setBusinessName(p.business_name ?? "");
    setContactName(p.contact_name ?? "");
    setPublicEmail(p.public_email ?? "");
    setPhone(p.phone ?? "");
    setWebsite(p.website ?? "");
    setCity(p.city ?? "");
    setStateField(p.state ?? "");
    setStory(p.organizer_story ?? "");

    setChecklistTagsInput((p.checklist_tags ?? []).join(", "));
    setCategoriesInput((p.organizer_categories ?? []).join(", "));
  }

  async function loadProfile() {
    try {
      setError(null);
      setSuccess(null);
      setNotImplemented(false);
      setStatus("loading");

      const res: any = await fetchOrganizerProfile(token);
      const profile: OrganizerProfile | null = res?.data ?? res ?? null;

      if (!profile) {
        // endpoint not implemented yet OR empty response
        applyProfileToForm(EMPTY);
        setNotImplemented(true);
        setStatus("loaded");
        return;
      }

      applyProfileToForm(profile);
      setStatus("loaded");
    } catch (e: any) {
      console.error("Failed to load organizer profile", e);
      setError(e?.message || "Failed to load organizer profile");
      setStatus("error");
    }
  }

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setNotImplemented(false);
    setStatus("saving");

    const payload: OrganizerProfile = {
      business_name: businessName || null,
      contact_name: contactName || null,
      public_email: publicEmail || null,
      phone: phone || null,
      website: website || null,
      city: city || null,
      state: stateField || null,
      organizer_story: story || null,
      checklist_tags: parseCommaList(checklistTagsInput),
      organizer_categories: parseCommaList(categoriesInput),
    };

    try {
      const res: any = await saveOrganizerProfile(payload, token);

      // some of our api helpers return null on 404 to keep UI stable
      const saved: OrganizerProfile | null = res?.data ?? res ?? null;

      if (!saved) {
        setNotImplemented(true);
        setError(
          "Organizer profile API returned 404 / empty. UI is stable; backend route still needs wiring."
        );
        setStatus("loaded");
        return;
      }

      applyProfileToForm(saved);
      setSuccess("Profile saved.");
      setStatus("loaded");
    } catch (e: any) {
      console.error("Failed to save organizer profile", e);
      if (e instanceof ApiError) setError(`${e.message} (HTTP ${e.status})`);
      else setError(e?.message || "Failed to save organizer profile");
      setStatus("error");
    }
  }

  const disabled = status === "loading" || status === "saving";

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => navigate("/organizer/dashboard")}
            className="text-[11px] font-medium text-indigo-300 hover:underline"
          >
            ← Back to dashboard
          </button>
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-300">
            Organizer control center
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* Main card */}
          <section className="rounded-2xl bg-slate-900 p-5 shadow-sm ring-1 ring-slate-800">
            <header className="mb-4">
              <h1 className="text-xl font-bold text-white">Organizer profile</h1>
              <p className="mt-1 text-xs text-slate-300">
                This is your public face to vendors and guests. Tell your story and keep your contact info up to date.
              </p>
            </header>

            {notImplemented && !error && (
              <div className="mb-3 rounded-xl bg-amber-950/40 p-3 text-[11px] text-amber-100">
                <p className="font-semibold">Profile API not enabled yet.</p>
                <p className="mt-1 text-amber-200">
                  Backend endpoint returned 404 / empty. This page stays usable.
                </p>
              </div>
            )}

            {error && (
              <div className="mb-3 rounded-xl bg-red-950/70 p-3 text-[11px] text-red-100">
                <p className="font-semibold">There was a problem.</p>
                <p className="mt-1 text-red-200">{error}</p>
              </div>
            )}

            {success && (
              <div className="mb-3 rounded-xl bg-emerald-950/60 p-3 text-[11px] text-emerald-100">
                {success}
              </div>
            )}

            <form onSubmit={onSave} className="space-y-4 text-xs text-slate-100">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-[11px] text-slate-300">Business / organization name</label>
                  <input
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    disabled={disabled}
                    placeholder="Cobb County Night Market"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] text-slate-300">Primary contact name</label>
                  <input
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    disabled={disabled}
                    placeholder="Your name"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] text-slate-300">Public email (what vendors see)</label>
                  <input
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
                    value={publicEmail}
                    onChange={(e) => setPublicEmail(e.target.value)}
                    disabled={disabled}
                    placeholder="hello@youreventseries.com"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] text-slate-300">Phone</label>
                  <input
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={disabled}
                    placeholder="(404) 555-0123"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] text-slate-300">Website</label>
                  <input
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    disabled={disabled}
                    placeholder="https://..."
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-slate-300">City</label>
                    <input
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      disabled={disabled}
                      placeholder="Marietta"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-slate-300">State</label>
                    <input
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
                      value={stateField}
                      onChange={(e) => setStateField(e.target.value)}
                      disabled={disabled}
                      placeholder="GA"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] text-slate-300">Organizer story / about</label>
                <textarea
                  className="min-h-[120px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
                  value={story}
                  onChange={(e) => setStory(e.target.value)}
                  disabled={disabled}
                  placeholder="Tell vendors and guests what your events are about..."
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-[11px] text-slate-300">Verification checklist tags (comma-separated)</label>
                  <input
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
                    value={checklistTagsInput}
                    onChange={(e) => setChecklistTagsInput(e.target.value)}
                    disabled={disabled}
                    placeholder="business_license, insurance, health_permit"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] text-slate-300">Organizer categories (comma-separated)</label>
                  <input
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
                    value={categoriesInput}
                    onChange={(e) => setCategoriesInput(e.target.value)}
                    disabled={disabled}
                    placeholder="food, arts, crafts, music"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2">
                <div className="text-[11px] text-slate-400">
                  Status:{" "}
                  <span className="font-mono">
                    {status}
                  </span>
                </div>
                <button
                  type="submit"
                  disabled={disabled}
                  className="inline-flex items-center justify-center rounded-xl bg-indigo-500 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {status === "saving" ? "Saving..." : "Save profile"}
                </button>
              </div>
            </form>
          </section>

          {/* Side panel */}
          <aside className="space-y-4">
            <section className="rounded-2xl bg-slate-900 p-4 shadow-sm ring-1 ring-slate-800">
              <h2 className="text-sm font-semibold text-white">Quick links</h2>
              <div className="mt-3 flex flex-col gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => navigate("/organizer/events")}
                  className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-3 py-2 font-semibold text-white ring-1 ring-slate-700 hover:bg-slate-900"
                >
                  Manage events
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/organizer/applications")}
                  className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-3 py-2 font-semibold text-white ring-1 ring-slate-700 hover:bg-slate-900"
                >
                  Review applicants
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/organizer/contacts")}
                  className="inline-flex items-center justify-center rounded-xl bg-indigo-500 px-3 py-2 font-semibold text-white shadow-sm hover:bg-indigo-600"
                >
                  Contacts
                </button>
              </div>
              <p className="mt-3 text-[11px] text-slate-300">
                If contacts/profile endpoints aren’t wired on the backend yet, this page will stay stable and show a helpful message.
              </p>
            </section>

            <section className="rounded-2xl bg-slate-900 p-4 shadow-sm ring-1 ring-slate-800">
              <h2 className="text-sm font-semibold text-white">Next steps</h2>
              <ul className="mt-2 space-y-2 text-[11px] text-slate-300">
                <li>• Add backend routes for organizer profile + contacts (if not already)</li>
                <li>• Add file uploads for permits/licenses</li>
                <li>• Add organizer “needs 50 vendors” category counts & capacity UI</li>
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default OrganizerProfilePage;
