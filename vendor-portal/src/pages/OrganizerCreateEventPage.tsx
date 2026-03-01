// src/pages/OrganizerCreateEventPage.tsx
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type NextStep = "requirements" | "layout" | "details";

type CreatePayload = {
  title: string;
  description?: string;

  start_date?: string;
  end_date?: string;

  venue_name?: string;
  street_address?: string; // ✅ Address
  city?: string;
  state?: string;

  // ✅ Public flyer links
  ticketSalesUrl?: string;
  googleMapsLink?: string;

  // ✅ Media
  heroImageUrl?: string;
  imageUrls?: string[];
  videoUrls?: string[];
};

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

function buildNextUrl(eventId: string | number, next: NextStep) {
  if (next === "layout") return `/organizer/events/${eventId}/layout`;
  if (next === "details") return `/organizer/events/${eventId}/details`;
  return `/organizer/events/${eventId}/requirements`;
}

export default function OrganizerCreateEventPage() {
  const navigate = useNavigate();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ✅ v1 behavior: create -> requirements
  const [nextStep, setNextStep] = useState<NextStep>("requirements");

  // core
  const [title, setTitle] = useState("");
  const [venue, setVenue] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");

  const [startDate, setStartDate] = useState(""); // YYYY-MM-DD or ISO
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");

  // flyer links
  const [ticketSalesUrl, setTicketSalesUrl] = useState("");
  const [googleMapsLink, setGoogleMapsLink] = useState("");

  // media
  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [videoUrls, setVideoUrls] = useState<string[]>([]);
  const [videoDraft, setVideoDraft] = useState("");

  const validationError = useMemo(() => {
    const t = title.trim();
    if (!t) return "Event title is required.";
    if (t.length < 3) return "Event title must be at least 3 characters.";
    if (startDate && endDate && endDate < startDate) return "End date cannot be before start date.";
    return null;
  }, [title, startDate, endDate]);

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

      // ✅ FIX: correct endpoint
      const created: any = await createEvent(payload);

      const eventId =
        created?.event?.id ??
        created?.id ??
        created?.event_id ??
        created?.eventId;

      if (!eventId) throw new Error("Event created, but no event id was returned by the API.");

      navigate(buildNextUrl(eventId, nextStep));
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
    } catch (e: any) {
      setError(e?.message || "Failed to upload hero image.");
    }
  }

  async function onAddImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    try {
      const list = Array.from(files);
      const urls = await Promise.all(list.map(fileToDataUrl));
      setImageUrls((prev) => [...prev, ...urls]);
    } catch (e: any) {
      setError(e?.message || "Failed to upload images.");
    }
  }

  function removeImage(idx: number) {
    setImageUrls((prev) => prev.filter((_, i) => i !== idx));
  }

  function addVideoUrl() {
    const v = videoDraft.trim();
    if (!v) return;
    setVideoUrls((prev) => Array.from(new Set([...prev, v])));
    setVideoDraft("");
  }

  function removeVideo(idx: number) {
    setVideoUrls((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">Create Event</h1>
          <p className="mt-2 text-sm text-gray-600">
            Create the event, then continue to the next step (v1 defaults to Requirements).
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="text-xs font-bold text-gray-500">Next step:</div>

            <button
              type="button"
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                nextStep === "requirements" ? "bg-black text-white" : "bg-white"
              }`}
              onClick={() => setNextStep("requirements")}
            >
              Requirements
            </button>

            <button
              type="button"
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                nextStep === "layout" ? "bg-black text-white" : "bg-white"
              }`}
              onClick={() => setNextStep("layout")}
            >
              Layout
            </button>

            <button
              type="button"
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                nextStep === "details" ? "bg-black text-white" : "bg-white"
              }`}
              onClick={() => setNextStep("details")}
            >
              Details
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold"
            onClick={() => navigate("/organizer/events")}
            disabled={saving}
          >
            Cancel
          </button>

          <button
            type="button"
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
            onClick={onCreate}
            disabled={saving}
          >
            {saving ? "Creating…" : "Create & Continue →"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <form onSubmit={onCreate} className="space-y-6">
        {/* Core */}
        <div className="rounded-xl border bg-white p-5">
          <div className="text-lg font-bold">Core Info</div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-xs font-bold text-gray-600">Title *</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Event title"
              />
            </div>

            <div>
              <div className="text-xs font-bold text-gray-600">Venue Name</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="Venue / location name"
              />
            </div>

            <div className="md:col-span-2">
              <div className="text-xs font-bold text-gray-600">Address</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Street address (e.g., 123 Main St)"
              />
              <div className="mt-1 text-xs text-gray-500">
                Used for your flyer and for generating the map link (if you don’t paste one).
              </div>
            </div>

            <div>
              <div className="text-xs font-bold text-gray-600">City</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="City"
              />
            </div>

            <div>
              <div className="text-xs font-bold text-gray-600">State</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}
                placeholder="State (e.g., GA)"
              />
            </div>

            <div>
              <div className="text-xs font-bold text-gray-600">Start Date</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                placeholder="YYYY-MM-DD or ISO"
              />
            </div>

            <div>
              <div className="text-xs font-bold text-gray-600">End Date</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                placeholder="YYYY-MM-DD or ISO"
              />
            </div>

            <div className="md:col-span-2">
              <div className="text-xs font-bold text-gray-600">Description</div>
              <textarea
                className="mt-1 w-full rounded-lg border px-3 py-2"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this event about?"
              />
            </div>
          </div>
        </div>

        {/* Public Links */}
        <div className="rounded-xl border bg-white p-5">
          <div className="text-lg font-bold">Public Links</div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-xs font-bold text-gray-600">Ticket Sales URL</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={ticketSalesUrl}
                onChange={(e) => setTicketSalesUrl(e.target.value)}
                placeholder="https://tickets.example.com/your-event"
              />
            </div>

            <div>
              <div className="text-xs font-bold text-gray-600">Google Maps Link</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={googleMapsLink}
                onChange={(e) => setGoogleMapsLink(e.target.value)}
                placeholder="https://maps.google.com/?q=..."
              />
              <div className="mt-1 text-xs text-gray-500">
                If blank, your public page can generate one from Address + City/State.
              </div>
            </div>
          </div>
        </div>

        {/* Media */}
        <div className="rounded-xl border bg-white p-5">
          <div className="text-lg font-bold">Media</div>

          <div className="mt-4 space-y-4">
            {/* Hero */}
            <div>
              <div className="text-xs font-bold text-gray-600">Hero Image</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  className="w-full rounded-lg border px-3 py-2 md:flex-1"
                  value={heroImageUrl}
                  onChange={(e) => setHeroImageUrl(e.target.value)}
                  placeholder="(auto-filled on upload) or paste a URL/dataURL"
                />
                <label className="cursor-pointer rounded-lg border bg-white px-4 py-2 text-sm font-semibold">
                  Upload Hero
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => onUploadHero(e.target.files?.[0] || null)}
                  />
                </label>
              </div>

              {heroImageUrl ? (
                <div className="mt-3 overflow-hidden rounded-xl border">
                  <img
                    src={heroImageUrl}
                    alt="Hero preview"
                    className="h-56 w-full object-cover"
                  />
                </div>
              ) : null}
            </div>

            {/* Gallery Images */}
            <div>
              <div className="text-xs font-bold text-gray-600">Gallery Images</div>

              <div className="mt-2">
                <label className="cursor-pointer rounded-lg border bg-white px-4 py-2 text-sm font-semibold">
                  Upload Images
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => onAddImages(e.target.files)}
                  />
                </label>
              </div>

              {imageUrls.length > 0 ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {imageUrls.map((u, idx) => (
                    <div key={`${u}-${idx}`} className="overflow-hidden rounded-xl border bg-white">
                      <img src={u} alt={`img-${idx}`} className="h-32 w-full object-cover" />
                      <button
                        type="button"
                        className="w-full border-t px-3 py-2 text-sm font-semibold text-red-700"
                        onClick={() => removeImage(idx)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-sm text-gray-500">No images uploaded yet.</div>
              )}
            </div>

            {/* Videos */}
            <div>
              <div className="text-xs font-bold text-gray-600">Video URLs</div>
              <div className="mt-2 flex gap-2">
                <input
                  className="w-full rounded-lg border px-3 py-2"
                  value={videoDraft}
                  onChange={(e) => setVideoDraft(e.target.value)}
                  placeholder="https://youtube.com/..."
                />
                <button
                  type="button"
                  className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
                  onClick={addVideoUrl}
                >
                  Add
                </button>
              </div>

              {videoUrls.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {videoUrls.map((v, idx) => (
                    <li key={`${v}-${idx}`} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                      <a className="truncate text-sm text-blue-700 underline" href={v} target="_blank" rel="noreferrer">
                        {v}
                      </a>
                      <button
                        type="button"
                        className="rounded-lg border px-3 py-1 text-xs font-semibold text-red-700"
                        onClick={() => removeVideo(idx)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 text-sm text-gray-500">No video URLs added yet.</div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold"
            onClick={() => navigate("/organizer/events")}
            disabled={saving}
          >
            Cancel
          </button>

          <button
            type="submit"
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
            disabled={saving}
          >
            {saving ? "Creating…" : "Create & Continue →"}
          </button>
        </div>
      </form>
    </div>
  );
}
