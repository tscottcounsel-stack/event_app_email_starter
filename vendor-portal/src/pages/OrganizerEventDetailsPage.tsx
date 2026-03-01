// src/pages/OrganizerEventDetailsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

/* ---------------- Types ---------------- */

type EventModel = {
  id: number | string;

  title?: string;
  description?: string;

  venue_name?: string;

  // Backend canonical
  street_address?: string;
  city?: string;
  state?: string;
  zip_code?: string;

  start_date?: string | null;
  end_date?: string | null;

  published?: boolean;
  archived?: boolean;

  requirements_published?: boolean;
  layout_published?: boolean;

  // Media stored on event
  heroImageUrl?: string;
  imageUrls?: string[];
  videoUrls?: string[];

  // Backend canonical
  ticket_sales_url?: string;
  google_maps_url?: string;

  // Legacy fields (keep reading)
  address?: string;
  ticketUrl?: string;
  googleMapsUrl?: string;
};

/* ---------------- Helpers ---------------- */

function safeStr(x: any) {
  return String(x ?? "").trim();
}

function asArrayOfStrings(x: any): string[] {
  if (!Array.isArray(x)) return [];
  return x.map((v) => String(v ?? "").trim()).filter(Boolean);
}

function isLikelyHttpUrl(s: string) {
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

/**
 * For <input type="datetime-local">:
 * - value must be "YYYY-MM-DDTHH:mm" (no seconds, no timezone)
 */
function isoToLocalInput(iso?: string | null) {
  const s = safeStr(iso);
  if (!s) return "";

  // If backend already stores date-only "YYYY-MM-DD"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00`;

  // Otherwise parse ISO timestamp and render local date/time
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";

  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  return `${yyyy}-${mm}-${dd}T00:00`;
}

function localInputToIso(value?: string | null) {
  const v = safeStr(value);
  if (!v) return null;

  // v like "2026-04-04T00:00"
  const datePart = v.split("T")[0] || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;

  // Store DATE-ONLY to avoid timezone shifts
  return datePart;
}
/* ---------------- Page ---------------- */

export default function OrganizerEventDetailsPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const eid = String(eventId || "").trim();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [event, setEvent] = useState<EventModel | null>(null);

  // Core editable fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [venue, setVenue] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");

  // datetime-local values
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");

  // Public flyer links
  const [ticketSalesUrl, setTicketSalesUrl] = useState("");
  const [googleMapsUrl, setGoogleMapsUrl] = useState("");

  // Media
  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [videoUrls, setVideoUrls] = useState<string[]>([]);

  const [imgDraft, setImgDraft] = useState("");
  const [vidDraft, setVidDraft] = useState("");

  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadingHero, setUploadingHero] = useState(false);

  // Public preview route
  const previewPublicHref = useMemo(() => `/events/${eid}`, [eid]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        const headers = buildAuthHeaders();
        const res = await fetch(`${API_BASE}/organizer/events/${eid}`, { headers });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text?.trim() || `Failed to load event (${res.status})`);
        }

        const data = (await res.json().catch(() => null)) as any;
        const ev: EventModel | null =
          data && typeof data === "object" ? (data.event ?? data) : null;

        if (!ev) throw new Error("Invalid event payload");
        if (cancelled) return;

        setEvent(ev);

        setTitle(safeStr(ev.title));
        setDescription(safeStr(ev.description));

        setVenue(safeStr(ev.venue_name));

        // ✅ Prefer backend canonical, fall back to legacy
        setStreetAddress(safeStr((ev as any).street_address ?? (ev as any).address));
        setCity(safeStr(ev.city));
        setStateCode(safeStr(ev.state));

        // ✅ Convert ISO -> datetime-local
        setStartLocal(isoToLocalInput(ev.start_date ?? null));
        setEndLocal(isoToLocalInput(ev.end_date ?? null));

        // ✅ Prefer backend canonical, fall back to legacy
        setTicketSalesUrl(
          safeStr((ev as any).ticket_sales_url ?? (ev as any).ticketUrl)
        );
        setGoogleMapsUrl(
          safeStr((ev as any).google_maps_url ?? (ev as any).googleMapsUrl)
        );

        setHeroImageUrl(safeStr(ev.heroImageUrl));
        setImageUrls(asArrayOfStrings(ev.imageUrls));
        setVideoUrls(asArrayOfStrings(ev.videoUrls));
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ? String(e.message) : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (eid) load();
    else {
      setLoading(false);
      setErr("Missing eventId");
    }

    return () => {
      cancelled = true;
    };
  }, [eid]);

  async function saveChanges() {
    if (!eid) return;
    setSaving(true);
    setErr(null);

    try {
      const headers = { ...buildAuthHeaders(), "Content-Type": "application/json" };

      const payload: Partial<EventModel> = {
        title: safeStr(title) || undefined,
        description: safeStr(description) || undefined,

        venue_name: safeStr(venue) || undefined,

        // ✅ backend canonical
        street_address: safeStr(streetAddress) || undefined,
        city: safeStr(city) || undefined,
        state: safeStr(stateCode) || undefined,

        // ✅ store as ISO; empty -> null (prevents 1970)
        start_date: localInputToIso(startLocal),
        end_date: localInputToIso(endLocal),

        // ✅ backend canonical
        ticket_sales_url: safeStr(ticketSalesUrl) || undefined,
        google_maps_url: safeStr(googleMapsUrl) || undefined,

        heroImageUrl: safeStr(heroImageUrl) || undefined,
        imageUrls,
        videoUrls,
      };

      const res = await fetch(`${API_BASE}/organizer/events/${eid}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
      });

      const contentType = res.headers.get("content-type") || "";
      const body = contentType.includes("application/json")
        ? await res.json().catch(() => null)
        : await res.text().catch(() => "");

      if (!res.ok) {
        const msg =
          (typeof body === "string" && body.trim()) ||
          (body &&
            typeof body === "object" &&
            ((body as any).detail || (body as any).message || JSON.stringify(body))) ||
          `Save failed (${res.status})`;
        throw new Error(msg);
      }

      const next: EventModel | null =
        body && typeof body === "object" ? ((body as any).event ?? (body as any)) : null;

      if (next) {
        setEvent(next);

        setTitle(safeStr(next.title));
        setDescription(safeStr(next.description));

        setVenue(safeStr(next.venue_name));
        setStreetAddress(
          safeStr((next as any).street_address ?? (next as any).address)
        );
        setCity(safeStr(next.city));
        setStateCode(safeStr(next.state));

        setStartLocal(isoToLocalInput(next.start_date ?? null));
        setEndLocal(isoToLocalInput(next.end_date ?? null));

        setTicketSalesUrl(
          safeStr((next as any).ticket_sales_url ?? (next as any).ticketUrl)
        );
        setGoogleMapsUrl(
          safeStr((next as any).google_maps_url ?? (next as any).googleMapsUrl)
        );

        setHeroImageUrl(safeStr(next.heroImageUrl));
        setImageUrls(asArrayOfStrings(next.imageUrls));
        setVideoUrls(asArrayOfStrings(next.videoUrls));
      }
    } catch (e: any) {
      setErr(e?.message ? String(e.message) : String(e));
    } finally {
      setSaving(false);
    }
  }

  function addImageUrl() {
    const v = safeStr(imgDraft);
    if (!v) return;
    setImageUrls((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setImgDraft("");
    if (!safeStr(heroImageUrl)) setHeroImageUrl(v);
  }

  function addVideoUrl() {
    const v = safeStr(vidDraft);
    if (!v) return;
    setVideoUrls((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setVidDraft("");
  }

  function removeImage(url: string) {
    setImageUrls((prev) => prev.filter((x) => x !== url));
    if (safeStr(heroImageUrl) === url) setHeroImageUrl("");
  }

  function removeVideo(url: string) {
    setVideoUrls((prev) => prev.filter((x) => x !== url));
  }

  async function onUploadImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingImages(true);
    setErr(null);

    try {
      const dataUrls = await Promise.all(Array.from(files).map(fileToDataUrl));
      setImageUrls((prev) => {
        const next = [...prev];
        for (const u of dataUrls) if (u && !next.includes(u)) next.push(u);
        return next;
      });

      if (!safeStr(heroImageUrl) && dataUrls[0]) setHeroImageUrl(dataUrls[0]);
    } catch (e: any) {
      setErr(e?.message ? String(e.message) : String(e));
    } finally {
      setUploadingImages(false);
    }
  }

  async function onUploadHero(file: File | null) {
    if (!file) return;
    setUploadingHero(true);
    setErr(null);

    try {
      const u = await fileToDataUrl(file);
      if (u) {
        setHeroImageUrl(u);
        setImageUrls((prev) => (prev.includes(u) ? prev : [u, ...prev]));
      }
    } catch (e: any) {
      setErr(e?.message ? String(e.message) : String(e));
    } finally {
      setUploadingHero(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-gray-600">Loading event…</div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          {err}
        </div>
        <button className="mt-4 rounded-lg border px-4 py-2" onClick={() => navigate(-1)}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Event Details</h1>
          <div className="text-sm text-gray-500">
            Event ID: <span className="font-mono">{eid}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="rounded-lg border px-4 py-2" onClick={() => navigate(-1)}>
            ← Back
          </button>

          <button
            className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white"
            onClick={() =>
              window.open(
                `${window.location.origin}${previewPublicHref}`,
                "_blank",
                "noopener,noreferrer"
              )
            }
          >
            Preview as Public
          </button>
        </div>
      </div>

      {/* Core details */}
      <div className="mb-8 rounded-xl border bg-white p-5">
        <h2 className="mb-4 text-lg font-semibold">Core Info</h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block">
            <div className="mb-1 text-sm font-medium text-gray-700">Title</div>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title"
            />
          </label>

          <label className="block">
            <div className="mb-1 text-sm font-medium text-gray-700">Venue Name</div>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="Venue / location name"
            />
          </label>

          <label className="block md:col-span-2">
            <div className="mb-1 text-sm font-medium text-gray-700">Address</div>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={streetAddress}
              onChange={(e) => setStreetAddress(e.target.value)}
              placeholder="Street address (e.g., 123 Main St)"
            />
            <div className="mt-1 text-xs text-gray-500">
              Used for the public flyer + map link.
            </div>
          </label>

          <label className="block">
            <div className="mb-1 text-sm font-medium text-gray-700">City</div>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City"
            />
          </label>

          <label className="block">
            <div className="mb-1 text-sm font-medium text-gray-700">State</div>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value)}
              placeholder="State (e.g., GA)"
            />
          </label>

          <label className="block">
            <div className="mb-1 text-sm font-medium text-gray-700">Start Date</div>
            <input
              type="datetime-local"
              className="w-full rounded-lg border px-3 py-2"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
            />
          </label>

          <label className="block">
            <div className="mb-1 text-sm font-medium text-gray-700">End Date</div>
            <input
              type="datetime-local"
              className="w-full rounded-lg border px-3 py-2"
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
            />
          </label>

          <label className="block md:col-span-2">
            <div className="mb-1 text-sm font-medium text-gray-700">Description</div>
            <textarea
              className="min-h-[96px] w-full rounded-lg border px-3 py-2"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this event about?"
            />
          </label>
        </div>
      </div>

      {/* Public flyer links */}
      <div className="mb-8 rounded-xl border bg-white p-5">
        <h2 className="mb-4 text-lg font-semibold">Public Links</h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block">
            <div className="mb-1 text-sm font-medium text-gray-700">Ticket Sales URL</div>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={ticketSalesUrl}
              onChange={(e) => setTicketSalesUrl(e.target.value)}
              placeholder="https://tickets.example.com/your-event"
            />
            {ticketSalesUrl && !isLikelyHttpUrl(ticketSalesUrl) ? (
              <div className="mt-1 text-xs text-amber-700">That doesn’t look like a valid URL.</div>
            ) : null}
          </label>

          <label className="block">
            <div className="mb-1 text-sm font-medium text-gray-700">Google Maps Link</div>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={googleMapsUrl}
              onChange={(e) => setGoogleMapsUrl(e.target.value)}
              placeholder="https://maps.google.com/?q=..."
            />
            {googleMapsUrl && !isLikelyHttpUrl(googleMapsUrl) ? (
              <div className="mt-1 text-xs text-amber-700">That doesn’t look like a valid URL.</div>
            ) : null}
            <div className="mt-1 text-xs text-gray-500">
              If you don’t paste a Maps link, the public page will generate one from the Address.
            </div>
          </label>
        </div>
      </div>

      {/* Media */}
      <div className="rounded-xl border bg-white p-5">
        <h2 className="mb-4 text-lg font-semibold">Media</h2>

        {/* Hero */}
        <div className="mb-6">
          <div className="mb-2 text-sm font-medium text-gray-700">Hero Image</div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <input
              className="flex-1 rounded-lg border px-3 py-2"
              value={heroImageUrl}
              onChange={(e) => setHeroImageUrl(e.target.value)}
              placeholder="Paste hero image URL OR upload below"
            />

            <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium">
              {uploadingHero ? "Uploading…" : "Upload Hero"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onUploadHero(e.target.files?.[0] || null)}
              />
            </label>
          </div>

          {heroImageUrl ? (
            <div className="mt-3 overflow-hidden rounded-lg border">
              <img src={heroImageUrl} alt="Hero" className="h-48 w-full object-cover" />
            </div>
          ) : null}
        </div>

        {/* Images */}
        <div className="mb-6">
          <div className="mb-2 text-lg font-semibold">Images</div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white">
              {uploadingImages ? "Uploading…" : "Upload Images"}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => onUploadImages(e.target.files)}
              />
            </label>

            <div className="text-sm text-gray-600">
              Stored on the event as embedded images (v1). You can also paste URLs below.
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <input
              className="flex-1 rounded-lg border px-3 py-2"
              placeholder="Paste image URL (optional)"
              value={imgDraft}
              onChange={(e) => setImgDraft(e.target.value)}
            />
            <button
              className="rounded-lg bg-green-600 px-4 py-2 font-medium text-white"
              onClick={addImageUrl}
            >
              Add URL
            </button>
          </div>

          {imageUrls.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {imageUrls.map((url) => (
                <div key={url} className="overflow-hidden rounded-lg border">
                  <div className="flex items-center justify-between gap-2 border-b bg-gray-50 px-3 py-2">
                    <div className="truncate text-xs text-gray-600">
                      {url.startsWith("data:image/") ? "(uploaded image)" : url}
                    </div>
                    <button className="rounded border px-2 py-1 text-xs" onClick={() => removeImage(url)}>
                      Remove
                    </button>
                  </div>
                  <img src={url} alt="Event" className="h-40 w-full object-cover" />
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-sm text-gray-500">No images yet.</div>
          )}
        </div>

        {/* Videos */}
        <div className="mb-6">
          <div className="mb-2 text-lg font-semibold">Videos</div>

          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border px-3 py-2"
              placeholder="Paste YouTube or video URL"
              value={vidDraft}
              onChange={(e) => setVidDraft(e.target.value)}
            />
            <button className="rounded-lg bg-green-600 px-4 py-2 font-medium text-white" onClick={addVideoUrl}>
              Add
            </button>
          </div>

          {videoUrls.length > 0 ? (
            <div className="mt-4 space-y-2">
              {videoUrls.map((url) => (
                <div key={url} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <div className="truncate text-sm text-gray-700">{url}</div>
                  <div className="flex gap-2">
                    <button className="rounded border px-3 py-1 text-sm" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
                      Open
                    </button>
                    <button className="rounded border px-3 py-1 text-sm" onClick={() => removeVideo(url)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-sm text-gray-500">No videos yet.</div>
          )}
        </div>

        <button
          className="rounded-lg bg-black px-6 py-3 font-medium text-white disabled:opacity-60"
          onClick={saveChanges}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
