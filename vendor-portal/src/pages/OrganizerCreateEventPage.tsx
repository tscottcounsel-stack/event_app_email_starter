
// src/pages/OrganizerCreateEventPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "https://event-app-api-production-ccce.up.railway.app";

type NextStep = "requirements" | "layout" | "details";

type CreatePayload = {
  title: string;
  description?: string;

  start_date?: string;
  end_date?: string;

  venue_name?: string;
  street_address?: string;
  city?: string;
  state?: string;

  ticketSalesUrl?: string;
  googleMapsLink?: string;

  heroImageUrl?: string;
  imageUrls?: string[];
  videoUrls?: string[];
};

type SavedTemplateOption = {
  id: string;
  name: string;
  category?: string;
};

type BuiltInTemplateOption = {
  id: string;
  name: string;
  subtitle: string;
  category: string;
};

const BUILT_IN_TEMPLATE_OPTIONS: BuiltInTemplateOption[] = [
  { id: "retail_market", name: "Retail Vendor Market", subtitle: "General retail vendors and makers", category: "Marketplace / Retail" },
  { id: "arts_crafts_fair", name: "Arts & Crafts Fair", subtitle: "Handmade goods and artist-friendly defaults", category: "Marketplace / Retail" },
  { id: "fashion_popup", name: "Fashion / Apparel Pop-Up", subtitle: "Boutique, apparel, and accessories", category: "Marketplace / Retail" },
  { id: "food_vendor_market", name: "Food Vendor Market", subtitle: "Prepared food and packaged food booths", category: "Food" },
  { id: "food_truck_rally", name: "Food Truck Rally", subtitle: "Truck-specific spacing, fire, and health docs", category: "Food" },
  { id: "farmers_market", name: "Farmers Market", subtitle: "Produce, packaged goods, and local vendors", category: "Food" },
  { id: "tech_startup_expo", name: "Tech / Startup Expo", subtitle: "Demo-heavy, power-friendly exhibitor setup", category: "Exhibitions" },
  { id: "trade_show_b2b", name: "Trade Show (B2B)", subtitle: "Professional exhibitor layout and documents", category: "Exhibitions" },
  { id: "sponsor_booths", name: "Sponsor Booths", subtitle: "Premium sponsor and activation setups", category: "Exhibitions" },
  { id: "community_festival", name: "Community Festival", subtitle: "Mixed vendors and community organizations", category: "Community" },
  { id: "nonprofit_fair", name: "Non-Profit Fair", subtitle: "Outreach booths and low-friction compliance", category: "Community" },
  { id: "kids_family_event", name: "Kids / Family Event", subtitle: "Family-safe activities and tighter safety defaults", category: "Community" },
];

function cleanStr(v?: string) {
  const s = String(v ?? "").trim();
  return s.length ? s : undefined;
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Failed to read file"));
    r.onload = () => resolve(String(r.result || ""));
    r.readAsDataURL(file);
  });
}

function buildNextUrl(
  eventId: string | number,
  next: NextStep,
  templateSelection?: { source: "builtin" | "saved"; id: string } | null
) {
  if (next === "layout") return `/organizer/events/${eventId}/layout`;
  if (next === "details") return `/organizer/events/${eventId}/details`;

  const sp = new URLSearchParams();
  if (templateSelection?.id) {
    sp.set("templateId", templateSelection.id);
    sp.set("templateSource", templateSelection.source);
  }

  const q = sp.toString();
  return `/organizer/events/${eventId}/requirements${q ? `?${q}` : ""}`;
}

async function fetchJson(path: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      ...buildAuthHeaders(),
      Accept: "application/json",
    },
  });

  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

  return { ok: res.ok, status: res.status, data };
}

export default function OrganizerCreateEventPage() {
  const navigate = useNavigate();

  const [saving, setSaving] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nextStep, setNextStep] = useState<NextStep>("requirements");

  const [title, setTitle] = useState("");
  const [venue, setVenue] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");

  const [ticketSalesUrl, setTicketSalesUrl] = useState("");
  const [googleMapsLink, setGoogleMapsLink] = useState("");

  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [videoUrls, setVideoUrls] = useState<string[]>([]);
  const [videoDraft, setVideoDraft] = useState("");

  const [savedTemplates, setSavedTemplates] = useState<SavedTemplateOption[]>([]);
  const [templateMode, setTemplateMode] = useState<"none" | "builtin" | "saved">("builtin");
  const [selectedBuiltInTemplateId, setSelectedBuiltInTemplateId] = useState<string>(
    BUILT_IN_TEMPLATE_OPTIONS[0]?.id || "retail_market"
  );
  const [selectedSavedTemplateId, setSelectedSavedTemplateId] = useState<string>("");

  const validationError = useMemo(() => {
    const t = title.trim();
    if (!t) return "Event title is required.";
    if (t.length < 3) return "Event title must be at least 3 characters.";
    if (startDate && endDate && endDate < startDate) return "End date cannot be before start date.";
    return null;
  }, [title, startDate, endDate]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoadingTemplates(true);
      try {
        const res = await fetchJson("/organizer/requirement-templates");
        if (!cancelled && res.ok) {
          const raw = Array.isArray((res.data as any)?.items)
            ? (res.data as any).items
            : Array.isArray(res.data)
            ? (res.data as any[])
            : [];

          const items: SavedTemplateOption[] = raw
            .map((item: any) => ({
              id: String(item?.id ?? ""),
              name: String(item?.name ?? "Saved template"),
              category: item?.category ? String(item.category) : "",
            }))
            .filter((item) => item.id);

          setSavedTemplates(items);
          if (!selectedSavedTemplateId && items[0]?.id) {
            setSelectedSavedTemplateId(items[0].id);
          }
        }
      } catch {
        // ignore; backend route may not exist yet
      } finally {
        if (!cancelled) setLoadingTemplates(false);
      }
    }

    run();
    return () => {
      cancelled = true
    };
  }, []);

  async function createEvent(payload: CreatePayload) {
    const headers = { ...buildAuthHeaders(), "Content-Type": "application/json" };

    const res = await fetch(`${API_BASE}/organizer/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const ct = res.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");
    const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

    if (!res.ok) {
      const msg =
        (isJson && data && (data.detail || data.message || data.error)) ||
        (typeof data === "string" ? data : null) ||
        `Request failed (${res.status})`;
      throw new Error(msg);
    }

    return data;
  }

  const onCreate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);

    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setSaving(true);

      const payload: CreatePayload = {
        title: title.trim(),
        description: cleanStr(description),

        venue_name: cleanStr(venue),
        street_address: cleanStr(address),
        city: cleanStr(city),
        state: cleanStr(stateCode),

        start_date: cleanStr(startDate),
        end_date: cleanStr(endDate),

        ticketSalesUrl: cleanStr(ticketSalesUrl),
        googleMapsLink: cleanStr(googleMapsLink),

        heroImageUrl: cleanStr(heroImageUrl),
        imageUrls: imageUrls.filter(Boolean),
        videoUrls: videoUrls.filter(Boolean),
      };

      const created: any = await createEvent(payload);

      const eventId =
        created?.event?.id ??
        created?.id ??
        created?.event_id ??
        created?.eventId;

      if (!eventId) throw new Error("Event created, but no event id was returned by the API.");

      const templateSelection =
        templateMode === "builtin" && selectedBuiltInTemplateId
          ? { source: "builtin" as const, id: selectedBuiltInTemplateId }
          : templateMode === "saved" && selectedSavedTemplateId
          ? { source: "saved" as const, id: selectedSavedTemplateId }
          : null;

      navigate(buildNextUrl(eventId, nextStep, templateSelection));
    } catch (err: any) {
      setError(err?.message || "Unable to create event. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  async function onUploadHero(file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setHeroImageUrl(dataUrl);
    } catch (err: any) {
      setError(err?.message || "Unable to upload image.");
    }
  }

  async function onAddGalleryImages(files: FileList | null) {
    if (!files || !files.length) return;
    try {
      const next = [...imageUrls];
      for (const file of Array.from(files)) {
        next.push(await fileToDataUrl(file));
      }
      setImageUrls(next);
    } catch (err: any) {
      setError(err?.message || "Unable to upload one or more images.");
    }
  }

  function addVideoUrl() {
    const v = videoDraft.trim();
    if (!v) return;
    setVideoUrls((prev) => [...prev, v]);
    setVideoDraft("");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div>
            <div className="text-2xl font-black text-slate-900">Create Event</div>
            <div className="mt-1 text-sm font-semibold text-slate-600">
              Create the event once, then start from a built-in or saved requirements template.
            </div>
          </div>

          <div className="flex items-center gap-3">
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
              value={nextStep}
              onChange={(e) => setNextStep(e.target.value as NextStep)}
            >
              <option value="requirements">Next: Requirements</option>
              <option value="layout">Next: Booth Layout</option>
              <option value="details">Next: Event Details</option>
            </select>

            <button
              type="button"
              onClick={onCreate}
              disabled={saving}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Creating…" : "Create & Continue →"}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <form onSubmit={onCreate} className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-lg font-black text-slate-900">Requirements Template</div>
                <div className="mt-1 text-sm font-semibold text-slate-600">
                  Choose a built-in or organizer-saved template to preload the next requirements page.
                </div>
              </div>

              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600">
                Backend mode
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    checked={templateMode === "none"}
                    onChange={() => setTemplateMode("none")}
                  />
                  <div>
                    <div className="text-sm font-black text-slate-900">Start blank</div>
                    <div className="text-xs font-semibold text-slate-600">
                      Don’t preload any requirement template.
                    </div>
                  </div>
                </div>
              </label>

              <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    checked={templateMode === "builtin"}
                    onChange={() => setTemplateMode("builtin")}
                  />
                  <div>
                    <div className="text-sm font-black text-slate-900">Built-in template</div>
                    <div className="text-xs font-semibold text-slate-600">
                      Start from one of the marketplace defaults.
                    </div>
                  </div>
                </div>

                <select
                  className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                  value={selectedBuiltInTemplateId}
                  onChange={(e) => setSelectedBuiltInTemplateId(e.target.value)}
                  disabled={templateMode !== "builtin"}
                >
                  {BUILT_IN_TEMPLATE_OPTIONS.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name} — {tpl.category}
                    </option>
                  ))}
                </select>

                <div className="mt-2 text-xs font-semibold text-slate-600">
                  {BUILT_IN_TEMPLATE_OPTIONS.find((tpl) => tpl.id === selectedBuiltInTemplateId)?.subtitle}
                </div>
              </label>

              <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    checked={templateMode === "saved"}
                    onChange={() => setTemplateMode("saved")}
                  />
                  <div>
                    <div className="text-sm font-black text-slate-900">Saved organizer template</div>
                    <div className="text-xs font-semibold text-slate-600">
                      Reuse a template saved from a prior event.
                    </div>
                  </div>
                </div>

                <select
                  className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                  value={selectedSavedTemplateId}
                  onChange={(e) => setSelectedSavedTemplateId(e.target.value)}
                  disabled={templateMode !== "saved" || loadingTemplates || savedTemplates.length === 0}
                >
                  {savedTemplates.length === 0 ? (
                    <option value="">
                      {loadingTemplates ? "Loading saved templates…" : "No saved templates yet"}
                    </option>
                  ) : null}
                  {savedTemplates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}{tpl.category ? ` — ${tpl.category}` : ""}
                    </option>
                  ))}
                </select>

                <div className="mt-2 text-xs font-semibold text-slate-600">
                  Saved templates come from your backend endpoint and work across devices.
                </div>
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-lg font-bold text-slate-900">Core Info</div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-xs font-bold text-slate-600">Title *</div>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Event title"
                />
              </div>

              <div>
                <div className="text-xs font-bold text-slate-600">Venue Name</div>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={venue}
                  onChange={(e) => setVenue(e.target.value)}
                  placeholder="Venue / location name"
                />
              </div>

              <div className="md:col-span-2">
                <div className="text-xs font-bold text-slate-600">Address</div>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street address (e.g., 123 Main St)"
                />
              </div>

              <div>
                <div className="text-xs font-bold text-slate-600">City</div>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="City"
                />
              </div>

              <div>
                <div className="text-xs font-bold text-slate-600">State</div>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={stateCode}
                  onChange={(e) => setStateCode(e.target.value)}
                  placeholder="State (e.g., GA)"
                />
              </div>

              <div>
                <div className="text-xs font-bold text-slate-600">Start Date</div>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  placeholder="YYYY-MM-DD or ISO"
                />
              </div>

              <div>
                <div className="text-xs font-bold text-slate-600">End Date</div>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  placeholder="YYYY-MM-DD or ISO"
                />
              </div>

              <div className="md:col-span-2">
                <div className="text-xs font-bold text-slate-600">Description</div>
                <textarea
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this event about?"
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-lg font-bold text-slate-900">Public Links</div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-xs font-bold text-slate-600">Ticket Sales URL</div>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={ticketSalesUrl}
                  onChange={(e) => setTicketSalesUrl(e.target.value)}
                  placeholder="https://tickets.example.com/your-event"
                />
              </div>

              <div>
                <div className="text-xs font-bold text-slate-600">Google Maps Link</div>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={googleMapsLink}
                  onChange={(e) => setGoogleMapsLink(e.target.value)}
                  placeholder="https://maps.google.com/?q=..."
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-lg font-bold text-slate-900">Media</div>

            <div className="mt-4 space-y-4">
              <div>
                <div className="text-xs font-bold text-slate-600">Hero Image</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 md:flex-1"
                    value={heroImageUrl}
                    onChange={(e) => setHeroImageUrl(e.target.value)}
                    placeholder="(auto-filled on upload) or paste a URL/dataURL"
                  />
                  <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">
                    Upload Hero
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => onUploadHero(e.target.files?.[0] || null)}
                    />
                  </label>
                </div>
              </div>

              <div>
                <div className="text-xs font-bold text-slate-600">Gallery Images</div>
                <div className="mt-2 flex items-center gap-2">
                  <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">
                    Upload Images
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => onAddGalleryImages(e.target.files)}
                    />
                  </label>
                  <div className="text-xs font-semibold text-slate-500">
                    {imageUrls.length} image{imageUrls.length === 1 ? "" : "s"} selected
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs font-bold text-slate-600">Video URLs</div>
                <div className="mt-2 flex flex-col gap-2 md:flex-row">
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={videoDraft}
                    onChange={(e) => setVideoDraft(e.target.value)}
                    placeholder="Paste a video URL"
                  />
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold"
                    onClick={addVideoUrl}
                  >
                    Add Video
                  </button>
                </div>

                {videoUrls.length ? (
                  <div className="mt-3 space-y-2">
                    {videoUrls.map((url, idx) => (
                      <div
                        key={`${url}_${idx}`}
                        className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                      >
                        <span className="truncate pr-3">{url}</span>
                        <button
                          type="button"
                          className="text-red-600"
                          onClick={() => setVideoUrls((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Creating…" : "Create & Continue →"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}



