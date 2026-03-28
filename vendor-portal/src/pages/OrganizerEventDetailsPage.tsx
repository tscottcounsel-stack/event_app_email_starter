// src/pages/OrganizerEventDetailsPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  Clock3,
  DollarSign,
  Download,
  Edit3,
  Eye,
  Inbox,
  LayoutGrid,
  Map,
  MessageSquare,
  Percent,
  Send,
  Store,
  TrendingUp,
} from "lucide-react";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE =
  import.meta.env.VITE_API_BASE || "https://event-app-api-production-ccce.up.railway.app";

/* ---------------- Types ---------------- */

type EventModel = {
  id: number | string;

  title?: string;
  description?: string;

  venue_name?: string;

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

  heroImageUrl?: string;
  imageUrls?: string[];
  videoUrls?: string[];

  category?: string | null;
  event_type?: string | null;
  industry?: string | null;
  type?: string | null;

  ticket_sales_url?: string;
  google_maps_url?: string;

  address?: string;
  ticketUrl?: string;
  googleMapsUrl?: string;
};

type EventStats = {
  event_id: number;
  applications: number;
  booths_sold: number;
  pending_applications: number;
  revenue: number;
  approved_vendors?: number;
  booths_remaining?: number;
  approval_rate?: number;
  unread_vendor_replies?: number;
  booths_total?: number;
};

type VendorListItem = {
  id: string | number;
  company_name?: string | null;
  business_name?: string | null;
  vendor_company_name?: string | null;
  display_name?: string | null;
  vendor_display_name?: string | null;
  owner_name?: string | null;
  email?: string | null;
  vendor_email?: string | null;
  status?: string | null;
  booth_id?: string | null;
  payment_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  approved_at?: string | null;
};

type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  timeLabel: string;
};

/* ---------------- Helpers ---------------- */

function safeStr(x: any) {
  return String(x ?? "").trim();
}

function asArrayOfStrings(x: any): string[] {
  if (!Array.isArray(x)) return [];
  return x
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
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

function buildUploadHeaders() {
  const headers = buildAuthHeaders() as Record<string, string>;
  const normalized: Record<string, string> = {};

  Object.entries(headers || {}).forEach(([key, value]) => {
    if (key.toLowerCase() !== "content-type") {
      normalized[key] = value;
    }
  });

  return normalized;
}

function toAbsoluteMediaUrl(url?: string | null) {
  const value = safeStr(url);
  if (!value) return "";
  if (isLikelyHttpUrl(value)) return value;
  if (value.startsWith("/")) return `${API_BASE}${value}`;
  return `${API_BASE}/${value.replace(/^\/+/, "")}`;
}

async function uploadImageFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE}/upload/image`, {
    method: "POST",
    headers: buildUploadHeaders(),
    body: formData,
  });

  const contentType = res.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await res.json().catch(() => null)
    : await res.text().catch(() => "");

  if (!res.ok) {
    const msg =
      (typeof body === "string" && body.trim()) ||
      (body && typeof body === "object" && ((body as any).detail || (body as any).message)) ||
      `Upload failed (${res.status})`;
    throw new Error(String(msg));
  }

  const relativeUrl = safeStr(body?.url);
  if (!relativeUrl) {
    throw new Error("Upload succeeded but no URL was returned.");
  }

  return toAbsoluteMediaUrl(relativeUrl);
}

function isoToDateInput(iso?: string | null) {
  const s = safeStr(iso);
  if (!s) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";

  return d.toISOString().slice(0, 10);
}

function normalizeDateInput(value?: string | null) {
  const raw = safeStr(value);
  if (!raw) return null;

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  if (dateOnly.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString().slice(0, 10);
}

async function fetchFirstJson(urls: string[], headers: Record<string, string>) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      if (data != null) return data;
    } catch {
      // Try next endpoint
    }
  }
  return null;
}

function asArray<T = any>(data: any): T[] {
  if (Array.isArray(data)) return data as T[];
  if (Array.isArray(data?.items)) return data.items as T[];
  if (Array.isArray(data?.applications)) return data.applications as T[];
  if (Array.isArray(data?.vendors)) return data.vendors as T[];
  if (Array.isArray(data?.results)) return data.results as T[];
  return [];
}

function pickVendorName(v: VendorListItem) {
  return (
    safeStr(v.company_name) ||
    safeStr(v.business_name) ||
    safeStr(v.vendor_company_name) ||
    safeStr(v.display_name) ||
    safeStr(v.vendor_display_name) ||
    safeStr(v.owner_name) ||
    "Vendor"
  );
}

function pickVendorEmail(v: VendorListItem) {
  return safeStr(v.email) || safeStr(v.vendor_email);
}

function formatDateTimeLabel(value?: string | null) {
  const s = safeStr(value);
  if (!s) return "Recently";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "Recently";
  return d.toLocaleString();
}

function downloadCsv(filename: string, rows: string[][]) {
  const esc = (value: string) => {
    const s = String(value ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const csv = rows.map((row) => row.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

/* ---------------- Category ---------------- */

const CATEGORY_OPTIONS = [
  "Food",
  "Tech",
  "Arts & Crafts",
  "Fashion",
  "Music",
  "Health & Wellness",
  "Business / Trade Show",
  "Community",
  "Holiday / Seasonal",
  "Other",
] as const;

function pickCategoryFromEvent(ev: any) {
  const raw =
    safeStr(ev?.category) ||
    safeStr(ev?.event_type) ||
    safeStr(ev?.industry) ||
    safeStr(ev?.type);
  return raw || "";
}

function normalizeCategory(v: string) {
  const s = safeStr(v);
  return s;
}

/* ---------------- Page ---------------- */

export default function OrganizerEventDetailsPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const eid = String(eventId || "").trim();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [event, setEvent] = useState<EventModel | null>(null);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [vendors, setVendors] = useState<VendorListItem[]>([]);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [downloadingVendorList, setDownloadingVendorList] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [venue, setVenue] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [category, setCategory] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [ticketSalesUrl, setTicketSalesUrl] = useState("");
  const [googleMapsUrl, setGoogleMapsUrl] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [videoUrls, setVideoUrls] = useState<string[]>([]);
  const [imgDraft, setImgDraft] = useState("");
  const [vidDraft, setVidDraft] = useState("");
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadingHero, setUploadingHero] = useState(false);

  const previewPublicHref = useMemo(() => `/events/${eid}`, [eid]);
  const coreInfoRef = useRef<HTMLDivElement | null>(null);
  const recentActivityRef = useRef<HTMLDivElement | null>(null);

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
        setStreetAddress(safeStr((ev as any).street_address ?? (ev as any).address));
        setCity(safeStr(ev.city));
        setStateCode(safeStr(ev.state));
        setCategory(pickCategoryFromEvent(ev));
        setStartLocal(isoToDateInput(ev.start_date ?? null));
        setEndLocal(isoToDateInput(ev.end_date ?? null));
        setTicketSalesUrl(safeStr((ev as any).ticket_sales_url ?? (ev as any).ticketUrl));
        setGoogleMapsUrl(safeStr((ev as any).google_maps_url ?? (ev as any).googleMapsUrl));
        setHeroImageUrl(toAbsoluteMediaUrl(ev.heroImageUrl));
        setImageUrls(asArrayOfStrings(ev.imageUrls).map(toAbsoluteMediaUrl).filter(Boolean));
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

  useEffect(() => {
    let cancelled = false;

    async function loadStats() {
      if (!eid) return;

      try {
        const res = await fetch(`${API_BASE}/events/${eid}/stats`, {
          headers: buildAuthHeaders(),
        });

        if (!res.ok) return;

        const data = (await res.json().catch(() => null)) as EventStats | null;
        if (!cancelled && data && typeof data === "object") {
          setStats(data);
        }
      } catch {
        if (!cancelled) setStats(null);
      }
    }

    loadStats();

    return () => {
      cancelled = true;
    };
  }, [eid]);

  useEffect(() => {
    let cancelled = false;

    async function loadVendorsAndActivity() {
      if (!eid) return;

      const headers = buildAuthHeaders();
      const data = await fetchFirstJson(
        [
          `${API_BASE}/organizer/events/${eid}/applications`,
          `${API_BASE}/organizer/events/${eid}/vendors`,
          `${API_BASE}/events/${eid}/applications`,
        ],
        headers
      );

      const items = asArray<VendorListItem>(data);
      if (cancelled) return;

      setVendors(items);

      const nextActivity: ActivityItem[] = items
        .slice()
        .sort((a, b) => {
          const ad = new Date(a.updated_at || a.created_at || a.approved_at || 0).getTime();
          const bd = new Date(b.updated_at || b.created_at || b.approved_at || 0).getTime();
          return bd - ad;
        })
        .slice(0, 6)
        .map((item, index) => {
          const vendorName = pickVendorName(item);
          const status = safeStr(item.status).toLowerCase();
          let title = "Vendor activity";
          if (status === "approved") title = "Vendor approved";
          else if (status === "submitted") title = "Application submitted";
          else if (status === "paid") title = "Payment received";
          else if (status === "rejected") title = "Vendor declined";
          else if (status === "draft") title = "Application started";

          const detailParts = [
            vendorName,
            safeStr(item.booth_id) ? `Booth ${safeStr(item.booth_id)}` : "",
            safeStr(item.payment_status) ? `Payment: ${safeStr(item.payment_status)}` : "",
          ].filter(Boolean);

          return {
            id: String(item.id ?? `${vendorName}-${index}`),
            title,
            detail: detailParts.join(" • ") || vendorName,
            timeLabel: formatDateTimeLabel(item.updated_at || item.approved_at || item.created_at),
          };
        });

      setActivityItems(nextActivity);
    }

    loadVendorsAndActivity();

    return () => {
      cancelled = true;
    };
  }, [eid]);

  function goToMessageVendors() {
    if (!eid) return;
    navigate(`/organizer/events/${encodeURIComponent(eid)}/messages`);
  }

  function goToBoothMap() {
    if (!eid) return;
    navigate(`/organizer/events/${encodeURIComponent(eid)}/map`);
  }

  function scrollToCoreInfo() {
    coreInfoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollToRecentActivity() {
    recentActivityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleDownloadVendorList() {
    if (!eid) return;

    setDownloadingVendorList(true);
    try {
      let rowsSource = vendors;

      if (!rowsSource.length) {
        const data = await fetchFirstJson(
          [
            `${API_BASE}/organizer/events/${eid}/applications`,
            `${API_BASE}/organizer/events/${eid}/vendors`,
            `${API_BASE}/events/${eid}/applications`,
          ],
          buildAuthHeaders()
        );
        rowsSource = asArray<VendorListItem>(data);
        setVendors(rowsSource);
      }

      const rows = [
        ["Vendor", "Email", "Status", "Booth", "Payment Status", "Updated"],
        ...rowsSource.map((item) => [
          pickVendorName(item),
          pickVendorEmail(item),
          safeStr(item.status),
          safeStr(item.booth_id),
          safeStr(item.payment_status),
          formatDateTimeLabel(item.updated_at || item.approved_at || item.created_at),
        ]),
      ];

      downloadCsv(`event-${eid}-vendors.csv`, rows);
    } finally {
      setDownloadingVendorList(false);
    }
  }

  async function saveChanges() {
    if (!eid) return;
    setSaving(true);
    setErr(null);
    setStatusMsg(null);

    try {
      const headers = {
        ...buildAuthHeaders(),
        Accept: "application/json",
        "Content-Type": "application/json",
      };

      const cat = normalizeCategory(category);

      const payload: Partial<EventModel> = {
        title: safeStr(title) || undefined,
        description: safeStr(description) || undefined,
        venue_name: safeStr(venue) || undefined,
        street_address: safeStr(streetAddress) || undefined,
        city: safeStr(city) || undefined,
        state: safeStr(stateCode) || undefined,
        start_date: normalizeDateInput(startLocal),
        end_date: normalizeDateInput(endLocal),
        category: cat || undefined,
        event_type: cat || undefined,
        ticket_sales_url: safeStr(ticketSalesUrl) || undefined,
        google_maps_url: safeStr(googleMapsUrl) || undefined,
        heroImageUrl: safeStr(heroImageUrl) || undefined,
        imageUrls,
        videoUrls,
      };

      const res = await fetch(`${API_BASE}/organizer/events/${eid}`, {
        method: "PATCH",
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
        setStreetAddress(safeStr((next as any).street_address ?? (next as any).address));
        setCity(safeStr(next.city));
        setStateCode(safeStr(next.state));
        setCategory(pickCategoryFromEvent(next));
        setStartLocal(isoToDateInput(next.start_date ?? null));
        setEndLocal(isoToDateInput(next.end_date ?? null));
        setTicketSalesUrl(safeStr((next as any).ticket_sales_url ?? (next as any).ticketUrl));
        setGoogleMapsUrl(safeStr((next as any).google_maps_url ?? (next as any).googleMapsUrl));
        setHeroImageUrl(toAbsoluteMediaUrl(next.heroImageUrl));
        setImageUrls(asArrayOfStrings(next.imageUrls).map(toAbsoluteMediaUrl).filter(Boolean));
        setVideoUrls(asArrayOfStrings(next.videoUrls));
      }

      setStatusMsg("Changes saved successfully.");
    } catch (e: any) {
      setErr(e?.message ? String(e.message) : String(e));
    } finally {
      setSaving(false);
    }
  }

  function addImageUrl() {
    const v = toAbsoluteMediaUrl(imgDraft);
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
    setStatusMsg(null);

    try {
      const uploadedUrls = await Promise.all(Array.from(files).map(uploadImageFile));
      setImageUrls((prev) => {
        const next = [...prev];
        for (const url of uploadedUrls) {
          if (url && !next.includes(url)) next.push(url);
        }
        return next;
      });

      if (!safeStr(heroImageUrl) && uploadedUrls[0]) {
        setHeroImageUrl(uploadedUrls[0]);
      }

      setStatusMsg(uploadedUrls.length === 1 ? "Image uploaded." : `${uploadedUrls.length} images uploaded.`);
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
    setStatusMsg(null);

    try {
      const url = await uploadImageFile(file);
      if (url) {
        setHeroImageUrl(url);
        setImageUrls((prev) => (prev.includes(url) ? prev : [url, ...prev]));
        setStatusMsg("Hero image uploaded.");
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
          <button
            className="inline-flex items-center gap-2 rounded-lg border px-4 py-2"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          <button
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white"
            onClick={() =>
              window.open(
                `${window.location.origin}${previewPublicHref}`,
                "_blank",
                "noopener,noreferrer"
              )
            }
          >
            <Eye className="h-4 w-4" />
            Preview as Public
          </button>
        </div>
      </div>

      {err ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          {err}
        </div>
      ) : null}

      {statusMsg ? (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
          {statusMsg}
        </div>
      ) : null}

      <div className="mb-6 rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">Organizer Quick Actions</div>
            <div className="text-xs text-gray-500">
              Jump into the most common organizer workflows for this event.
            </div>
          </div>
          <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
            Event {eid}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <button
            className="flex items-start gap-3 rounded-xl border px-4 py-4 text-left transition hover:bg-gray-50"
            onClick={scrollToCoreInfo}
            type="button"
          >
            <span className="rounded-lg bg-blue-50 p-2 text-blue-600">
              <Edit3 className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-gray-900">Edit Event</span>
              <span className="block text-xs text-gray-500">
                Jump to the editable event fields on this page.
              </span>
            </span>
          </button>

          <button
            className="flex items-start gap-3 rounded-xl border px-4 py-4 text-left transition hover:bg-gray-50"
            onClick={goToBoothMap}
            type="button"
          >
            <span className="rounded-lg bg-purple-50 p-2 text-purple-600">
              <Map className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-gray-900">View Booth Map</span>
              <span className="block text-xs text-gray-500">
                Open the map editor for booth layout and assignments.
              </span>
            </span>
          </button>

          <button
            className="flex items-start gap-3 rounded-xl border px-4 py-4 text-left transition hover:bg-gray-50"
            onClick={goToMessageVendors}
            type="button"
          >
            <span className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
              <Send className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-gray-900">Message Vendors</span>
              <span className="block text-xs text-gray-500">
                Open vendor messaging filtered to this event.
              </span>
            </span>
          </button>

          <button
            className="flex items-start gap-3 rounded-xl border px-4 py-4 text-left transition hover:bg-gray-50"
            onClick={handleDownloadVendorList}
            type="button"
            disabled={downloadingVendorList}
          >
            <span className="rounded-lg bg-amber-50 p-2 text-amber-600">
              <Download className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-gray-900">
                {downloadingVendorList ? "Preparing Vendor List..." : "Download Vendor List"}
              </span>
              <span className="block text-xs text-gray-500">
                Export current vendors and application statuses as CSV.
              </span>
            </span>
          </button>

          <button
            className="flex items-start gap-3 rounded-xl border px-4 py-4 text-left transition hover:bg-gray-50"
            onClick={scrollToRecentActivity}
            type="button"
          >
            <span className="rounded-lg bg-pink-50 p-2 text-pink-600">
              <Activity className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-gray-900">Recent Activity</span>
              <span className="block text-xs text-gray-500">
                Jump to the latest application and approval activity.
              </span>
            </span>
          </button>
        </div>
      </div>

      {stats ? (
        <>
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="mb-2 flex justify-between text-xs text-gray-500">
                Booths Sold
                <LayoutGrid className="h-4 w-4 text-blue-500" />
              </div>
              <div className="text-2xl font-bold">{stats.booths_sold}</div>
            </div>

            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="mb-2 flex justify-between text-xs text-gray-500">
                Revenue
                <DollarSign className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="text-2xl font-bold">
                ${Number(stats.revenue || 0).toLocaleString()}
              </div>
            </div>

            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="mb-2 flex justify-between text-xs text-gray-500">
                Pending Applications
                <Clock3 className="h-4 w-4 text-amber-500" />
              </div>
              <div className="text-2xl font-bold">{stats.pending_applications}</div>
            </div>

            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="mb-2 flex justify-between text-xs text-gray-500">
                Approved Vendors
                <BadgeCheck className="h-4 w-4 text-green-500" />
              </div>
              <div className="text-2xl font-bold">{stats.approved_vendors ?? 0}</div>
            </div>

            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="mb-2 flex justify-between text-xs text-gray-500">
                Total Applications
                <Inbox className="h-4 w-4 text-indigo-500" />
              </div>
              <div className="text-2xl font-bold">{stats.applications ?? 0}</div>
            </div>

            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="mb-2 flex justify-between text-xs text-gray-500">
                Booths Remaining
                <Store className="h-4 w-4 text-purple-500" />
              </div>
              <div className="text-2xl font-bold">{stats.booths_remaining ?? 0}</div>
            </div>

            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="mb-2 flex justify-between text-xs text-gray-500">
                Approval Rate
                <Percent className="h-4 w-4 text-pink-500" />
              </div>
              <div className="text-2xl font-bold">
                {Math.round((stats.approval_rate ?? 0) * 100)}%
              </div>
            </div>

            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="mb-2 flex justify-between text-xs text-gray-500">
                Unread Vendor Replies
                <MessageSquare className="h-4 w-4 text-purple-500" />
              </div>
              <div className="text-2xl font-bold">{stats.unread_vendor_replies ?? 0}</div>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-xl border bg-white p-5 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold">Booth Fill Progress</div>
                <TrendingUp className="h-5 w-5 text-gray-400" />
              </div>

              <div className="mb-2 text-xs text-gray-500">
                {stats.booths_sold} of {stats.booths_total ?? 0} booths filled
              </div>

              <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full bg-blue-600"
                  style={{
                    width: `${
                      stats.booths_total
                        ? Math.min(
                            100,
                            Math.round((stats.booths_sold / stats.booths_total) * 100)
                          )
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>

            <div className="rounded-xl border bg-white p-5 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold">Revenue Progress</div>
                <DollarSign className="h-5 w-5 text-gray-400" />
              </div>

              <div className="mb-2 text-xs text-gray-500">
                ${Number(stats.revenue || 0).toLocaleString()}
              </div>

              <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full bg-emerald-600"
                  style={{
                    width: `${
                      stats.booths_total && stats.booths_sold && stats.revenue
                        ? Math.min(
                            100,
                            Math.round(
                              (stats.revenue /
                                ((stats.revenue / stats.booths_sold) * stats.booths_total)) *
                                100
                            )
                          )
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          </div>

          <div className="mb-6 rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900">Vendor Conversion Funnel</div>
              <TrendingUp className="h-4 w-4 text-gray-400" />
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className="rounded-lg border p-3 text-center">
                <div className="text-xs text-gray-500">Applications</div>
                <div className="text-xl font-semibold">{stats.applications ?? 0}</div>
              </div>

              <div className="rounded-lg border p-3 text-center">
                <div className="text-xs text-gray-500">Approved</div>
                <div className="text-xl font-semibold">{stats.approved_vendors ?? 0}</div>
              </div>

              <div className="rounded-lg border p-3 text-center">
                <div className="text-xs text-gray-500">Booths Sold</div>
                <div className="text-xl font-semibold">{stats.booths_sold ?? 0}</div>
              </div>

              <div className="rounded-lg border p-3 text-center">
                <div className="text-xs text-gray-500">Revenue</div>
                <div className="text-xl font-semibold">
                  ${Number(stats.revenue ?? 0).toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      <div ref={coreInfoRef} className="mb-8 rounded-xl border bg-white p-5">
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

          <label className="block">
            <div className="mb-1 text-sm font-medium text-gray-700">Category</div>
            <select
              className="w-full rounded-lg border px-3 py-2"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Select category</option>
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <div className="mt-1 text-xs text-gray-500">
              This powers the “Food / Tech / …” pill on vendor event cards.
            </div>
          </label>

          <label className="block md:col-span-2">
            <div className="mb-1 text-sm font-medium text-gray-700">Address</div>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={streetAddress}
              onChange={(e) => setStreetAddress(e.target.value)}
              placeholder="Street address (e.g., 123 Main St)"
            />
            <div className="mt-1 text-xs text-gray-500">Used for the public flyer + map link.</div>
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
              type="date"
              className="w-full rounded-lg border px-3 py-2"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
            />
          </label>

          <label className="block">
            <div className="mb-1 text-sm font-medium text-gray-700">End Date</div>
            <input
              type="date"
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

      <div className="rounded-xl border bg-white p-5">
        <h2 className="mb-4 text-lg font-semibold">Media</h2>

        <div className="mb-6">
          <div className="mb-2 text-sm font-medium text-gray-700">Hero Image</div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <input
              className="flex-1 rounded-lg border px-3 py-2"
              value={heroImageUrl}
              onChange={(e) => setHeroImageUrl(e.target.value)}
              placeholder="Paste hero image URL OR upload below"
            />

            <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-60">
              {uploadingHero ? "Uploading…" : "Upload Hero"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploadingHero}
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

        <div className="mb-6">
          <div className="mb-2 text-lg font-semibold">Images</div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              {uploadingImages ? "Uploading…" : "Upload Images"}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                disabled={uploadingImages}
                onChange={(e) => onUploadImages(e.target.files)}
              />
            </label>

            <div className="text-sm text-gray-600">
              Images now upload as real files. You can still paste image URLs below if needed.
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
              type="button"
            >
              Add URL
            </button>
          </div>

          {imageUrls.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {imageUrls.map((url) => (
                <div key={url} className="overflow-hidden rounded-lg border">
                  <div className="flex items-center justify-between gap-2 border-b bg-gray-50 px-3 py-2">
                    <div className="truncate text-xs text-gray-600">{url}</div>
                    <button
                      className="rounded border px-2 py-1 text-xs"
                      onClick={() => removeImage(url)}
                      type="button"
                    >
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

        <div className="mb-6">
          <div className="mb-2 text-lg font-semibold">Videos</div>

          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border px-3 py-2"
              placeholder="Paste YouTube or video URL"
              value={vidDraft}
              onChange={(e) => setVidDraft(e.target.value)}
            />
            <button
              className="rounded-lg bg-green-600 px-4 py-2 font-medium text-white"
              onClick={addVideoUrl}
              type="button"
            >
              Add
            </button>
          </div>

          {videoUrls.length > 0 ? (
            <div className="mt-4 space-y-2">
              {videoUrls.map((url) => (
                <div
                  key={url}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                >
                  <div className="truncate text-sm text-gray-700">{url}</div>
                  <div className="flex gap-2">
                    <button
                      className="rounded border px-3 py-1 text-sm"
                      onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
                      type="button"
                    >
                      Open
                    </button>
                    <button
                      className="rounded border px-3 py-1 text-sm"
                      onClick={() => removeVideo(url)}
                      type="button"
                    >
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

        <div ref={recentActivityRef} className="mb-8 rounded-2xl border bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
              <div className="text-sm text-gray-500">
                Latest organizer-side movement for this event.
              </div>
            </div>
            <Activity className="h-5 w-5 text-gray-400" />
          </div>

          {activityItems.length ? (
            <div className="space-y-3">
              {activityItems.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-1 rounded-xl border border-gray-200 px-4 py-3 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{item.title}</div>
                    <div className="text-sm text-gray-600">{item.detail}</div>
                  </div>
                  <div className="text-xs text-gray-500">{item.timeLabel}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-500">
              No recent activity yet for this event.
            </div>
          )}
        </div>

        <button
          className="rounded-lg bg-black px-6 py-3 font-medium text-white disabled:opacity-60"
          onClick={saveChanges}
          disabled={saving || uploadingHero || uploadingImages}
          type="button"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
