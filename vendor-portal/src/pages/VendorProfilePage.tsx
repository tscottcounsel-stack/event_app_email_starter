import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

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
  updated_at?: string;
};

type VendorReview = {
  id?: number | string;
  rating?: number;
  comment?: string;
  reviewer_name?: string;
  reviewer_display_name?: string;
  organizer_name?: string;
  author_name?: string;
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
  updated_at: "",
};

function normalizeVendorProfile(source: any): VendorProfile {
  return {
    vendor_id: String(source?.vendor_id ?? source?.vendorId ?? source?.id ?? ""),
    business_name:
      source?.business_name ??
      source?.businessName ??
      source?.company_name ??
      source?.name ??
      "",
    email: source?.email ?? source?.contact_email ?? "",
    phone: source?.phone ?? source?.contact_phone ?? "",
    description:
      source?.description ??
      source?.business_description ??
      source?.vendor_description ??
      "",
    categories: Array.isArray(source?.categories)
      ? source.categories.filter(Boolean)
      : Array.isArray(source?.vendor_categories)
      ? source.vendor_categories.filter(Boolean)
      : [],
    website: source?.website ?? source?.website_url ?? "",
    instagram: source?.instagram ?? source?.instagram_url ?? "",
    facebook: source?.facebook ?? source?.facebook_url ?? "",
    logo_url: source?.logo_url ?? source?.logoUrl ?? "",
    banner_url: source?.banner_url ?? source?.bannerUrl ?? "",
    contact_name:
      source?.contact_name ??
      source?.contactName ??
      source?.full_name ??
      "",
    updated_at: source?.updated_at ?? "",
  };
}

function renderStars(rating: number) {
  const rounded = Math.round(rating);
  return "★".repeat(rounded) + "☆".repeat(Math.max(0, 5 - rounded));
}

function readableReviewerName(review: VendorReview) {
  return (
    review.reviewer_display_name ||
    review.reviewer_name ||
    review.organizer_name ||
    review.author_name ||
    "Verified organizer"
  );
}

function formatDate(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
}

export default function VendorProfilePage() {
  const params = useParams();
  const vendorId = useMemo(
    () => String(params.vendorId ?? params.id ?? params.vendor_id ?? "").trim(),
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
        const url = vendorId ? `/vendors/public/${encodeURIComponent(vendorId)}` : "/vendors/me";
        const res = await fetch(url, {
          credentials: "include",
          headers: {
            Accept: "application/json",
          },
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
        console.error("Failed to load vendor profile", err);
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
        const res = await fetch(`/vendors/${encodeURIComponent(effectiveVendorId)}/reviews`, {
          credentials: "include",
          headers: {
            Accept: "application/json",
          },
        });

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

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {profile.banner_url ? (
          <img
            src={profile.banner_url}
            alt="Vendor banner"
            className="h-52 w-full object-cover"
          />
        ) : (
          <div className="h-24 w-full bg-gradient-to-r from-slate-100 to-slate-50" />
        )}

        <div className="px-6 pb-8 pt-6">
          <div className="mb-6 flex flex-wrap items-center gap-4">
            {profile.logo_url ? (
              <img
                src={profile.logo_url}
                alt="Vendor logo"
                className="h-24 w-24 rounded-2xl border border-slate-200 object-cover shadow-sm"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-lg font-bold text-slate-400">
                {(profile.business_name || "Vendor").slice(0, 1).toUpperCase()}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <h1 className="text-3xl font-black text-slate-900">
                {profile.business_name || "Vendor Profile"}
              </h1>
              <div className="mt-1 text-sm font-semibold text-slate-600">
                {profile.contact_name || "Vendor"}
              </div>

              <div className="mt-3 inline-flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2">
                <div className="text-lg font-black tracking-wide text-amber-600">
                  {renderStars(averageRating || 0)}
                </div>
                <div className="text-sm font-bold text-slate-900">
                  {reviewCount > 0 ? `${averageRating.toFixed(1)} / 5` : "No ratings yet"}
                </div>
                <div className="text-sm text-slate-600">
                  {reviewCount === 1 ? "1 review" : `${reviewCount} reviews`}
                </div>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Loading profile...
            </div>
          ) : null}

          {!loading && error ? (
            <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="grid gap-6 md:grid-cols-[1.3fr_0.9fr]">
            <div>
              <section className="mb-6">
                <h2 className="mb-2 text-lg font-bold text-slate-900">About</h2>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-slate-700">
                  {profile.description || "No description provided."}
                </div>
              </section>

              <section className="mb-6">
                <h2 className="mb-2 text-lg font-bold text-slate-900">Categories</h2>
                <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  {(profile.categories ?? []).length > 0 ? (
                    (profile.categories ?? []).map((category, index) => (
                      <span
                        key={`${category}-${index}`}
                        className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700"
                      >
                        {category}
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-500">No categories listed.</span>
                  )}
                </div>
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold text-slate-900">Reviews</h2>
                  <div className="text-sm font-semibold text-slate-500">
                    {reviewCount === 1 ? "1 review" : `${reviewCount} reviews`}
                  </div>
                </div>

                {reviewsLoading ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                    Loading reviews...
                  </div>
                ) : reviewsError ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
                    {reviewsError}
                  </div>
                ) : reviews.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-slate-500">
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

            <div>
              <section className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <h2 className="mb-3 text-lg font-bold text-slate-900">Contact Information</h2>

                <div className="space-y-3 text-slate-700">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contact</p>
                    <p>{profile.contact_name || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</p>
                    <p>{profile.email || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</p>
                    <p>{profile.phone || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Website</p>
                    <p>{profile.website || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Instagram</p>
                    <p>{profile.instagram || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Facebook</p>
                    <p>{profile.facebook || "—"}</p>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
