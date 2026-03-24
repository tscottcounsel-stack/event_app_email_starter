import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { readSession } from "../auth/authStorage";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE ||
  (import.meta as any).env?.VITE_API_BASE_URL ||
  "http://127.0.0.1:8002";

type VendorProfile = {
  vendor_id: string;
  business_name: string;
  email: string;
  phone: string;
  description: string;
  categories: string[];
  website: string;
  instagram: string;
  facebook: string;
  logo_url: string;
  banner_url: string;
  contact_name: string;
  image_urls: string[];
  video_urls: string[];
  city: string;
  state: string;
  country: string;
  zip: string;
  verified: boolean;
  verification_status: string;
};

type VendorReview = {
  id?: number | string;
  rating?: number;
  comment?: string;
  reviewer_name?: string;
  reviewer_display_name?: string;
  organizer_name?: string;
  author_name?: string;
  organizer_email?: string;
  created_at?: string;
};

type VendorReviewsResponse = {
  reviews?: VendorReview[];
  rating?: number;
  review_count?: number;
};

const EMPTY_PROFILE: VendorProfile = {
  vendor_id: "",
  business_name: "",
  email: "",
  phone: "",
  description: "",
  categories: [],
  website: "",
  instagram: "",
  facebook: "",
  logo_url: "",
  banner_url: "",
  contact_name: "",
  image_urls: [],
  video_urls: [],
  city: "",
  state: "",
  country: "",
  zip: "",
  verified: false,
  verification_status: "",
};

function decodeJwtPayload(token: string): any | null {
  try {
    const parts = token.split(".");
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

function buildVendorHeaders(extra?: Record<string, string>) {
  const session: any = readSession?.() || {};
  const token = session?.accessToken || "";
  const payload = token ? decodeJwtPayload(token) : null;
  const sub = payload?.sub ?? "";

  return {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(session?.email ? { "x-user-email": session.email } : {}),
    ...(sub ? { "x-user-id": String(sub) } : {}),
    ...(extra ?? {}),
  };
}

function asString(value: any, fallback = "") {
  if (value == null) return fallback;
  return String(value).trim();
}

function asStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function inferVerified(source: any): boolean {
  const explicit = source?.verified ?? source?.is_verified ?? source?.isVerified;
  if (typeof explicit === "boolean") return explicit;

  const status = String(
    source?.verification_status ??
      source?.verificationStatus ??
      source?.verified_status ??
      ""
  )
    .trim()
    .toLowerCase();

  return status === "verified" || status === "approved" || status === "complete";
}

function normalizeVendorProfile(source: any): VendorProfile {
  return {
    vendor_id: asString(source?.vendor_id ?? source?.vendorId ?? source?.id),
    business_name: asString(
      source?.business_name ??
        source?.businessName ??
        source?.company_name ??
        source?.name
    ),
    email: asString(source?.email ?? source?.contact_email),
    phone: asString(source?.phone ?? source?.contact_phone),
    description: asString(
      source?.description ??
        source?.business_description ??
        source?.vendor_description
    ),
    categories: asStringArray(source?.categories ?? source?.vendor_categories),
    website: asString(source?.website ?? source?.website_url),
    instagram: asString(source?.instagram ?? source?.instagram_url),
    facebook: asString(source?.facebook ?? source?.facebook_url),
    logo_url: asString(
      source?.logo_url ?? source?.logoUrl ?? source?.logo_data_url ?? source?.logoDataUrl
    ),
    banner_url: asString(
      source?.banner_url ?? source?.bannerUrl ?? source?.cover_url ?? source?.coverUrl
    ),
    contact_name: asString(
      source?.contact_name ?? source?.contactName ?? source?.full_name
    ),
    image_urls: asStringArray(source?.image_urls ?? source?.imageUrls ?? source?.images),
    video_urls: asStringArray(source?.video_urls ?? source?.videoUrls ?? source?.videos),
    city: asString(source?.city),
    state: asString(source?.state),
    country: asString(source?.country),
    zip: asString(source?.zip ?? source?.zip_code ?? source?.postal_code),
    verified: inferVerified(source),
    verification_status: asString(
      source?.verification_status ?? source?.verificationStatus
    ),
  };
}

function renderStars(rating: number) {
  const safe = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(safe) + "☆".repeat(Math.max(0, 5 - safe));
}

function readableReviewerName(review: VendorReview) {
  return (
    review.reviewer_display_name ||
    review.reviewer_name ||
    review.organizer_name ||
    review.author_name ||
    review.organizer_email ||
    "Verified organizer"
  );
}

function formatDate(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
}

function formatHandle(urlOrHandle: string) {
  const value = String(urlOrHandle || "").trim();
  if (!value) return "—";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("@")) return value;
  return `@${value}`;
}

function buildHref(value: string) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  return `https://${v}`;
}

export default function VendorPublicProfilePage() {
  const params = useParams();
  const vendorId = useMemo(
    () => String(params.vendorId ?? params.id ?? "").trim(),
    [params]
  );

  const [profile, setProfile] = useState<VendorProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState("");
  const [reviews, setReviews] = useState<VendorReview[]>([]);
  const [averageRating, setAverageRating] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      setLoading(true);
      setError("");

      try {
        const endpoint = vendorId
          ? `${API_BASE}/vendors/public/${encodeURIComponent(vendorId)}`
          : `${API_BASE}/vendors/me`;

        const res = await fetch(endpoint, {
          headers: buildVendorHeaders(),
        });

        const text = await res.text().catch(() => "");
        if (!res.ok) {
          let message = text || `Failed to load vendor profile (${res.status})`;
          try {
            const parsed = text ? JSON.parse(text) : null;
            if (parsed?.detail) message = String(parsed.detail);
          } catch {}
          throw new Error(message);
        }

        const data = text ? JSON.parse(text) : {};
        if (!mounted) return;

        setProfile(normalizeVendorProfile(data));
      } catch (err: any) {
        if (!mounted) return;
        console.error("Failed to load vendor public profile", err);
        setProfile(EMPTY_PROFILE);
        setError(String(err?.message || err || "Failed to load vendor profile."));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadProfile();
    return () => {
      mounted = false;
    };
  }, [vendorId]);

  const effectiveVendorId = useMemo(
    () => String(vendorId || profile.vendor_id || "").trim(),
    [vendorId, profile.vendor_id]
  );

  useEffect(() => {
    let mounted = true;

    async function loadReviews() {
      if (!effectiveVendorId) {
        setReviews([]);
        setAverageRating(0);
        setReviewCount(0);
        return;
      }

      setReviewsLoading(true);
      setReviewsError("");

      try {
        const res = await fetch(
          `${API_BASE}/vendors/${encodeURIComponent(effectiveVendorId)}/reviews`,
          {
            headers: buildVendorHeaders(),
          }
        );

        const text = await res.text().catch(() => "");
        if (!res.ok) {
          let message = text || `Failed to load reviews (${res.status})`;
          try {
            const parsed = text ? JSON.parse(text) : null;
            if (parsed?.detail) message = String(parsed.detail);
          } catch {}
          throw new Error(message);
        }

        const data: VendorReviewsResponse = text ? JSON.parse(text) : {};
        if (!mounted) return;

        setReviews(Array.isArray(data?.reviews) ? data.reviews : []);
        setAverageRating(Number(data?.rating || 0));
        setReviewCount(Number(data?.review_count || 0));
      } catch (err: any) {
        if (!mounted) return;
        console.error("Failed to load vendor reviews", err);
        setReviews([]);
        setAverageRating(0);
        setReviewCount(0);
        setReviewsError(String(err?.message || err || "Failed to load reviews."));
      } finally {
        if (mounted) setReviewsLoading(false);
      }
    }

    void loadReviews();
    return () => {
      mounted = false;
    };
  }, [effectiveVendorId]);

  const locationLine = useMemo(() => {
    const parts = [profile.city, profile.state, profile.country].filter(Boolean);
    return parts.join(", ");
  }, [profile.city, profile.state, profile.country]);

  const heroInitial = (profile.business_name || "Vendor").slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="relative">
            {profile.banner_url ? (
              <img
                src={profile.banner_url}
                alt="Vendor banner"
                className="h-72 w-full object-cover"
              />
            ) : (
              <div className="h-72 w-full bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200" />
            )}

            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-6 pb-6 pt-16">
              <div className="flex flex-wrap items-end gap-5">
                <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl border-4 border-white bg-white shadow-lg">
                  {profile.logo_url ? (
                    <img
                      src={profile.logo_url}
                      alt="Vendor logo"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="text-3xl font-black text-slate-400">{heroInitial}</div>
                  )}
                </div>

                <div className="min-w-0 flex-1 text-white">
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="truncate text-3xl font-black md:text-4xl">
                      {profile.business_name || "Vendor Profile"}
                    </h1>
                    {profile.verified ? (
                      <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm font-extrabold text-amber-700">
                        Verified Vendor
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-4 text-sm font-semibold text-white/90">
                    <span>{profile.contact_name || "Vendor"}</span>
                    {locationLine ? <span>{locationLine}</span> : null}
                    {profile.zip ? <span>{profile.zip}</span> : null}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <div className="inline-flex flex-wrap items-center gap-3 rounded-2xl border border-white/20 bg-white/15 px-4 py-2 backdrop-blur">
                      <div className="text-lg font-black tracking-wide text-amber-200">
                        {renderStars(averageRating || 0)}
                      </div>
                      <div className="text-sm font-bold text-white">
                        {reviewCount > 0 ? `${averageRating.toFixed(1)} / 5` : "No ratings yet"}
                      </div>
                      <div className="text-sm text-white/85">
                        {reviewCount === 1 ? "1 review" : `${reviewCount} reviews`}
                      </div>
                    </div>

                    <a
                      href="#reviews"
                      className="rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-extrabold text-white backdrop-blur hover:bg-white/20"
                    >
                      Read Reviews
                    </a>

                    <Link
                      to="/events"
                      className="rounded-2xl border border-white/20 bg-white px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-100"
                    >
                      Apply to Event
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 px-6 py-8 md:grid-cols-[1.45fr_0.95fr]">
            <div className="space-y-6">
              {loading ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  Loading vendor profile...
                </div>
              ) : null}

              {!loading && error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}

              <section className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
                <h2 className="mb-3 text-xl font-black text-slate-900">About</h2>
                <div className="text-slate-700">
                  {profile.description || "No description provided."}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
                <h2 className="mb-3 text-xl font-black text-slate-900">Categories</h2>
                <div className="flex flex-wrap gap-2">
                  {profile.categories.length > 0 ? (
                    profile.categories.map((category, index) => (
                      <span
                        key={`${category}-${index}`}
                        className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-sm font-semibold text-slate-700"
                      >
                        {category}
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-500">No categories listed.</span>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-xl font-black text-slate-900">Gallery</h2>
                  <div className="text-sm font-semibold text-slate-500">
                    {profile.image_urls.length === 1
                      ? "1 image"
                      : `${profile.image_urls.length} images`}
                  </div>
                </div>

                {profile.image_urls.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 px-4 py-4 text-slate-500">
                    No gallery images yet.
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {profile.image_urls.map((url, index) => (
                      <div
                        key={`${url}-${index}`}
                        className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"
                      >
                        <img
                          src={url}
                          alt={`Vendor gallery ${index + 1}`}
                          className="aspect-[4/3] h-full w-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section
                id="reviews"
                className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-xl font-black text-slate-900">Reviews</h2>
                  <div className="text-sm font-semibold text-slate-500">
                    {reviewCount === 1 ? "1 review" : `${reviewCount} reviews`}
                  </div>
                </div>

                {reviewsLoading ? (
                  <div className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-600">
                    Loading reviews...
                  </div>
                ) : reviewsError ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
                    {reviewsError}
                  </div>
                ) : reviews.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 px-4 py-4 text-slate-500">
                    No reviews yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {reviews.map((review, index) => {
                      const rating = Number(review.rating || 0);
                      const reviewer = readableReviewerName(review);
                      const created = formatDate(review.created_at);

                      return (
                        <div
                          key={String(review.id ?? `${reviewer}-${index}`)}
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="text-base font-black text-amber-600">
                                {renderStars(rating)}
                              </div>
                              <div className="mt-1 text-sm font-bold text-slate-900">
                                {reviewer}
                              </div>
                            </div>
                            {created ? (
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                {created}
                              </div>
                            ) : null}
                          </div>

                          <div className="mt-3 text-sm text-slate-700">
                            {String(review.comment || "").trim() || "No written feedback provided."}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            <div className="space-y-6">
              <section className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
                <h2 className="mb-4 text-xl font-black text-slate-900">Contact</h2>

                <div className="space-y-4 text-slate-700">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Contact Name
                    </p>
                    <p>{profile.contact_name || "—"}</p>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Email
                    </p>
                    <p>{profile.email || "—"}</p>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Phone
                    </p>
                    <p>{profile.phone || "—"}</p>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Website
                    </p>
                    {profile.website ? (
                      <a
                        href={buildHref(profile.website)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-indigo-700 hover:underline"
                      >
                        {profile.website}
                      </a>
                    ) : (
                      <p>—</p>
                    )}
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
                <h2 className="mb-4 text-xl font-black text-slate-900">Online Presence</h2>

                <div className="space-y-4 text-slate-700">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Instagram
                    </p>
                    <p>{profile.instagram ? formatHandle(profile.instagram) : "—"}</p>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Facebook
                    </p>
                    <p>{profile.facebook || "—"}</p>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Location
                    </p>
                    <p>{locationLine || "—"}</p>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5 shadow-sm">
                <h2 className="mb-3 text-xl font-black text-slate-900">Book / Connect</h2>
                <div className="space-y-3">
                  <Link
                    to="/events"
                    className="block rounded-2xl bg-indigo-600 px-4 py-3 text-center text-sm font-extrabold text-white hover:bg-indigo-700"
                  >
                    Apply to Event
                  </Link>

                  <a
                    href={profile.email ? `mailto:${profile.email}` : "#"}
                    className={`block rounded-2xl border px-4 py-3 text-center text-sm font-extrabold ${
                      profile.email
                        ? "border-slate-300 bg-white text-slate-900 hover:bg-slate-100"
                        : "pointer-events-none border-slate-200 bg-slate-100 text-slate-400"
                    }`}
                  >
                    Message Vendor
                  </a>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
