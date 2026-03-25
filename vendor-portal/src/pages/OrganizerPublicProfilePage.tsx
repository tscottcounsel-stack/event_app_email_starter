import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE ||
  "https://event-app-api-production-ccce.up.railway.app";

type OrganizerReview = {
  id?: number;
  rating?: number;
  comment?: string;
  reviewer_name?: string;
  created_at?: string;
};

type OrganizerPublicProfile = {
  businessName?: string;
  businessDescription?: string;
  email?: string;
  phone?: string;
  website?: string;
  city?: string;
  state?: string;
  country?: string;
  categories?: string[];
  logoDataUrl?: string;
  updatedAt?: string;
  verified?: boolean;
  verification_status?: string;
  documents?: Array<{
    label?: string;
    name?: string;
    url?: string;
    type?: string;
  }>;
  rating?: number;
  review_count?: number;
  [k: string]: any;
};

function initials(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "OP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function GoldVerifiedBadge({ large = false }: { large?: boolean }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-2 rounded-full border-2 border-amber-300",
        "bg-gradient-to-br from-yellow-100 via-amber-50 to-yellow-200",
        "text-amber-900 shadow-[0_2px_10px_rgba(245,158,11,0.18)]",
        large ? "px-4 py-2 text-sm font-black" : "px-3 py-1.5 text-xs font-black",
      ].join(" ")}
    >
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-amber-500 bg-amber-500 text-xs font-black text-white shadow-sm">
        ✓
      </span>
      Verified Organizer
    </span>
  );
}

function parseNotes(notes: string) {
  const rawLines = String(notes || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const payoutLines = rawLines.filter((line) => {
    const lower = line.toLowerCase();
    return (
      lower.includes("paypal") ||
      lower.includes("venmo") ||
      lower.includes("cash app") ||
      lower.includes("cashapp")
    );
  });

  const aboutLines = rawLines.filter((line) => {
    const lower = line.toLowerCase();
    return !(
      lower === "preferred payout/contact routes:" ||
      lower.includes("paypal") ||
      lower.includes("venmo") ||
      lower.includes("cash app") ||
      lower.includes("cashapp")
    );
  });

  return {
    aboutText: aboutLines.join("\n").trim(),
    payoutLines,
  };
}

function renderStars(ratingValue?: number, className = "text-amber-500 text-lg") {
  const rating = Number(ratingValue ?? 0);

  return (
    <div className={`flex items-center ${className}`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={i < Math.round(rating) ? "" : "opacity-20"}
        >
          ★
        </span>
      ))}
    </div>
  );
}

export default function OrganizerPublicProfilePage() {
  const navigate = useNavigate();
  const { email } = useParams();

  const [profile, setProfile] = useState<OrganizerPublicProfile>({
    businessName: "",
    businessDescription: "",
    email: "",
    phone: "",
    website: "",
    city: "",
    state: "",
    country: "United States",
    categories: [],
    logoDataUrl: "",
    updatedAt: "",
    verified: false,
    verification_status: "",
    documents: [],
    rating: 0,
    review_count: 0,
  });

  const [reviews, setReviews] = useState<OrganizerReview[]>([]);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewMessage, setReviewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [err, setErr] = useState("");

  const authToken =
    localStorage.getItem("accessToken") ||
    localStorage.getItem("token") ||
    "";

  const name = useMemo(
    () => profile.businessName?.trim() || "Organizer",
    [profile.businessName]
  );

  const locationLine = useMemo(() => {
    const parts = [
      profile.city?.trim(),
      profile.state?.trim(),
      profile.country?.trim(),
    ].filter(Boolean);
    return parts.join(", ") || profile.country || "United States";
  }, [profile.city, profile.state, profile.country]);

  const verificationStatus = useMemo(() => {
    const raw = String(
      profile.verification_status || (profile.verified ? "verified" : "")
    ).toLowerCase();

    if (profile.verified) return "verified";
    if (raw === "approved") return "verified";
    if (raw === "verified") return "verified";
    if (raw === "pending") return "pending";
    if (raw === "rejected") return "rejected";
    return "unverified";
  }, [profile.verified, profile.verification_status]);

  const isVerified = verificationStatus === "verified";

  const { aboutText, payoutLines } = useMemo(
    () => parseNotes(profile.businessDescription || ""),
    [profile.businessDescription]
  );

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setErr("");

      try {
        const res = await fetch(
          `${API_BASE}/verification/public/${encodeURIComponent(email || "")}`,
          {
            headers: {
              Accept: "application/json",
            },
          }
        );

        const data = await res.json().catch(() => null);

        if (!res.ok) {
          throw new Error(data?.detail || "Failed to load organizer profile.");
        }

        const verification = data?.verification || null;

        if (!verification) {
          throw new Error("Organizer profile not found.");
        }

        const normalized: OrganizerPublicProfile = {
          businessName: String(verification?.business_name || "Organizer"),
          businessDescription: String(verification?.notes || ""),
          email: String(email || ""),
          phone: "",
          website: "",
          city: "",
          state: "",
          country: "United States",
          categories: [],
          logoDataUrl: "",
          updatedAt: "",
          verified:
            verification?.status === "verified" ||
            verification?.status === "approved",
          verification_status: String(verification?.status || ""),
          documents: Array.isArray(verification?.documents)
            ? verification.documents
            : [],
          rating: Number(verification?.rating ?? 0),
          review_count: Number(verification?.review_count ?? 0),
        };

        if (mounted) {
          setProfile(normalized);
        }
      } catch (e: any) {
        if (mounted) {
          setErr(e?.message || "Unable to load organizer profile.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, [email]);

  useEffect(() => {
    let mounted = true;

    async function loadReviews() {
      if (!email) {
        if (mounted) {
          setReviews([]);
          setReviewsLoading(false);
        }
        return;
      }

      try {
        setReviewsLoading(true);

        const res = await fetch(
          `${API_BASE}/organizers/public/${encodeURIComponent(email)}/reviews`,
          {
            headers: {
              Accept: "application/json",
            },
          }
        );

        const data = await res.json().catch(() => null);

        if (!res.ok) {
          throw new Error(data?.detail || "Failed to load reviews.");
        }

        if (!mounted) return;

        const nextReviews = Array.isArray(data?.reviews) ? data.reviews : [];
        setReviews(nextReviews);

        setProfile((prev) => ({
          ...prev,
          rating: Number(data?.rating ?? prev.rating ?? 0),
          review_count: Number(data?.review_count ?? nextReviews.length ?? 0),
        }));
      } catch {
        if (mounted) {
          setReviews([]);
        }
      } finally {
        if (mounted) {
          setReviewsLoading(false);
        }
      }
    }

    loadReviews();

    return () => {
      mounted = false;
    };
  }, [email]);

  async function handleSubmitReview() {
    if (!email) {
      setReviewMessage("Organizer email is missing.");
      return;
    }

    try {
      setReviewSubmitting(true);
      setReviewMessage("");

      const res = await fetch(`${API_BASE}/organizers/public/${encodeURIComponent(email)}/reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          rating: Number(reviewRating),
          comment: reviewComment.trim(),
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.detail || "Unable to submit review.");
      }

      const nextReviews = Array.isArray(data?.reviews)
        ? data.reviews
        : reviews;

      setReviews(nextReviews);
      setProfile((prev) => ({
        ...prev,
        rating: Number(data?.rating ?? prev.rating ?? 0),
        review_count: Number(data?.review_count ?? nextReviews.length ?? prev.review_count ?? 0),
      }));
      setReviewComment("");
      setReviewRating(5);
      setReviewMessage("Review submitted.");
    } catch (e: any) {
      setReviewMessage(e?.message || "Unable to submit review.");
    } finally {
      setReviewSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          Loading organizer profile…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
        >
          ← Back
        </button>

        <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-600">
          Public Organizer Profile
        </div>
      </div>

      {err ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 shadow-sm">
          {err}
        </div>
      ) : null}

      {!err ? (
        <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
          <div className="h-32 bg-gradient-to-r from-indigo-600 to-purple-600" />

          <div className="bg-slate-50 p-6">
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-6">
                  <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                    {profile.logoDataUrl ? (
                      <img
                        src={profile.logoDataUrl}
                        alt="Organizer logo"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="text-4xl font-extrabold text-indigo-600">
                        {initials(name)}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h1 className="text-5xl font-black tracking-tight text-slate-900">
                        {name}
                      </h1>
                      {isVerified ? <GoldVerifiedBadge large /> : null}
                      {!isVerified && verificationStatus === "pending" ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-4 py-2 text-sm font-black text-amber-800">
                          Pending Verification
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      {renderStars(profile?.rating, "text-amber-500 text-lg")}
                      <span className="text-sm font-semibold text-slate-600">
                        {Number(profile?.rating ?? 0).toFixed(1)} ({profile?.review_count ?? 0} reviews)
                      </span>
                    </div>

                    <p className="text-lg font-semibold text-slate-700">
                      {aboutText || "Professional event organizer"}
                    </p>

                    <div className="space-y-2 text-base font-semibold text-slate-700">
                      <div className="flex items-center gap-3">
                        <span className="inline-block h-5 w-5 rounded bg-slate-100" />
                        {locationLine}
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="inline-block h-5 w-5 rounded bg-slate-100" />
                        {profile.email || "organizer@example.com"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="rounded-full bg-emerald-600 px-6 py-3 text-base font-black text-white hover:bg-emerald-700"
                  >
                    Contact Organizer
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 bg-white px-6 py-3 text-base font-black text-slate-700 hover:bg-slate-50"
                  >
                    Share Profile
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_280px]">
              <div className="space-y-6">
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                  <h2 className="text-2xl font-black text-slate-900">About Us</h2>
                  <p className="mt-4 whitespace-pre-line text-lg font-medium text-slate-700">
                    {aboutText || "No description provided yet."}
                  </p>
                </div>

                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                  <h2 className="text-2xl font-black text-slate-900">Reviews</h2>

                  <div className="mt-4 flex items-center gap-3 text-slate-400">
                    {renderStars(profile?.rating, "text-amber-500 text-xl")}
                    <span className="ml-2 text-5xl font-black text-slate-900">
                      {Number(profile?.rating ?? 0).toFixed(1)}
                    </span>
                    <span className="text-xl font-semibold text-slate-600">
                      ({profile?.review_count ?? 0} reviews)
                    </span>
                  </div>

                  {reviewsLoading ? (
                    <div className="mt-6 text-sm text-slate-500">Loading reviews…</div>
                  ) : reviews.length === 0 ? (
                    <div className="flex min-h-[220px] flex-col items-center justify-center text-center text-slate-600">
                      <div className="mb-4 h-12 w-12 rounded-2xl bg-slate-100" />
                      <div className="text-2xl font-semibold">No reviews yet.</div>
                    </div>
                  ) : (
                    <div className="mt-6 space-y-4">
                      {reviews.map((review, index) => (
                        <div
                          key={`${review.id ?? "review"}-${index}`}
                          className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="font-black text-slate-900">
                                {review.reviewer_name || "Verified Vendor"}
                              </div>
                              <div className="mt-1">
                                {renderStars(review.rating, "text-amber-500")}
                              </div>
                            </div>

                            <div className="text-sm text-slate-500">
                              {review.created_at
                                ? new Date(review.created_at).toLocaleDateString()
                                : ""}
                            </div>
                          </div>

                          <p className="mt-3 text-base font-medium text-slate-700">
                            {review.comment || "No written comment provided."}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                  <h2 className="text-2xl font-black text-slate-900">Leave a Review</h2>
                  <p className="mt-2 text-base text-slate-600">
                    Share your experience working with this organizer.
                  </p>

                  <div className="mt-5 space-y-4">
                    <div>
                      <label className="mb-2 block text-sm font-black text-slate-700">
                        Rating
                      </label>
                      <select
                        value={reviewRating}
                        onChange={(e) => setReviewRating(Number(e.target.value))}
                        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-base font-semibold text-slate-800"
                      >
                        <option value={5}>5 - Excellent</option>
                        <option value={4}>4 - Very Good</option>
                        <option value={3}>3 - Good</option>
                        <option value={2}>2 - Fair</option>
                        <option value={1}>1 - Poor</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-black text-slate-700">
                        Comment
                      </label>
                      <textarea
                        value={reviewComment}
                        onChange={(e) => setReviewComment(e.target.value)}
                        className="min-h-[120px] w-full rounded-xl border border-slate-200 px-4 py-3 text-base font-medium text-slate-800"
                        placeholder="Tell others about your experience working with this organizer."
                      />
                    </div>

                    {reviewMessage ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                        {reviewMessage}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={handleSubmitReview}
                      disabled={reviewSubmitting}
                      className={`rounded-full px-6 py-3 text-base font-black ${
                        reviewSubmitting
                          ? "bg-slate-200 text-slate-500"
                          : "bg-indigo-600 text-white hover:bg-indigo-700"
                      }`}
                    >
                      {reviewSubmitting ? "Submitting…" : "Submit Review"}
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                  <h2 className="text-2xl font-black text-slate-900">Events & Experience</h2>

                  <div className="flex min-h-[220px] flex-col items-center justify-center text-center text-slate-600">
                    <div className="mb-4 h-12 w-12 rounded-2xl bg-slate-100" />
                    <div className="text-2xl font-semibold">No public event history yet.</div>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                  <h3 className="text-2xl font-black text-slate-900">Quick Stats</h3>
                  <div className="mt-6 space-y-4 text-lg font-semibold text-slate-700">
                    <div className="flex items-center justify-between">
                      <span>Events Hosted</span>
                      <span className="font-black text-slate-900">0</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Member Since</span>
                      <span className="font-black text-slate-900">
                        {profile.updatedAt
                          ? new Date(profile.updatedAt).getFullYear()
                          : new Date().getFullYear()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Average Rating</span>
                      <span className="font-black text-slate-900">
                        ★ {Number(profile?.rating ?? 0).toFixed(1)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Response Time</span>
                      <span className="font-black text-slate-900">&lt; 24 hours</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                  <h3 className="text-2xl font-black text-slate-900">Categories</h3>
                  <div className="mt-5">
                    {Array.isArray(profile.categories) && profile.categories.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {profile.categories.map((cat) => (
                          <span
                            key={cat}
                            className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-bold text-slate-700"
                          >
                            {cat}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-lg font-medium text-slate-700">
                        No categories specified
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                  <h3 className="text-2xl font-black text-slate-900">Verified Organizer</h3>
                  <p className="mt-3 text-lg font-medium text-slate-700">
                    Verification status for this organizer.
                  </p>

                  <div className="mt-5">
                    {isVerified ? (
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-amber-500 text-lg font-black text-white shadow-sm">
                          ✓
                        </span>
                        <GoldVerifiedBadge />
                      </div>
                    ) : verificationStatus === "pending" ? (
                      <div className="flex items-center gap-3 text-amber-700">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-lg font-black">
                          •
                        </span>
                        <span className="text-xl font-black">Pending Verification</span>
                      </div>
                    ) : verificationStatus === "rejected" ? (
                      <div className="flex items-center gap-3 text-rose-700">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-lg font-black">
                          !
                        </span>
                        <span className="text-xl font-black">Verification Rejected</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 text-slate-500">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-lg font-black text-slate-600">
                          ✓
                        </span>
                        <span className="text-xl font-black">Not Verified Yet</span>
                      </div>
                    )}
                  </div>
                </div>

                {payoutLines.length > 0 ? (
                  <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                    <h3 className="text-2xl font-black text-slate-900">Contact / Payout</h3>
                    <div className="mt-5 space-y-2 text-lg font-medium text-slate-700">
                      {payoutLines.map((line, index) => (
                        <div key={`${line}-${index}`}>{line}</div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}





