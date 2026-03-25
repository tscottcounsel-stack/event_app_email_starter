import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE ||
  "https://event-app-api-production-ccce.up.railway.app";

type VerificationStatus = "not_started" | "pending" | "verified" | "rejected";

type VerificationDocument = {
  name?: string;
  type?: string;
  url?: string;
  label?: string;
};

type VerificationRecord = {
  id?: number | string;
  user_id?: number | string;
  email?: string;
  role?: string;
  status?: VerificationStatus | string;
  submitted_at?: string | number | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  notes?: string | null;
  payment_status?: string | null;
  fee_amount?: number | null;
  documents?: VerificationDocument[];
};

function fmtDate(value?: string | number | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function money(value?: number | null) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function badge(status?: string) {
  const s = String(status || "").toLowerCase();
  if (s === "verified") return "bg-emerald-100 text-emerald-700";
  if (s === "rejected") return "bg-rose-100 text-rose-700";
  if (s === "pending") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

function toAbsoluteUrl(url?: string | null) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE}${url.startsWith("/") ? url : `/${url}`}`;
}

function getDocumentLinks(item: VerificationRecord): VerificationDocument[] {
  return Array.isArray(item.documents) ? item.documents : [];
}

export default function AdminVerificationsPage() {
  const [items, setItems] = useState<VerificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | number | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("pending");
  const [notesById, setNotesById] = useState<Record<string, string>>({});

  async function loadQueue() {
    try {
      setLoading(true);
      setError("");

      const res = await fetch(`${API_BASE}/admin/verifications`, {
        headers: buildAuthHeaders(),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(
          data?.detail ||
            data?.message ||
            "Unable to load verification queue."
        );
      }

      setItems(Array.isArray(data?.verifications) ? data.verifications : []);
    } catch (err: any) {
      setError(err?.message || "Unable to load verification queue.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQueue();
  }, []);

  async function reviewVerification(
    item: VerificationRecord,
    decision: "verified" | "rejected"
  ) {
    const id = item.id ?? item.user_id;
    if (id === undefined || id === null || id === "") {
      alert("Missing verification id.");
      return;
    }

    try {
      setBusyId(id);

      const res = await fetch(`${API_BASE}/admin/verify/${id}`, {
        method: "POST",
        headers: {
          ...buildAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: decision,
          notes: notesById[String(id)] || "",
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(
          data?.detail ||
            data?.message ||
            `Unable to mark ${decision}.`
        );
      }

      await loadQueue();
    } catch (err: any) {
      alert(err?.message || `Unable to mark ${decision}.`);
    } finally {
      setBusyId(null);
    }
  }

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter(
      (item) => String(item.status || "not_started").toLowerCase() === filter
    );
  }, [items, filter]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-slate-900">
              Verification Queue
            </h1>
            <p className="mt-2 text-sm font-semibold text-slate-600">
              Review submitted vendor and organizer verifications, confirm payment,
              and approve or reject accounts.
            </p>
          </div>

          <div className="flex gap-2">
            <Link
              to="/admin"
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-50"
            >
              Back to Admin
            </Link>
            <button
              onClick={loadQueue}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
              type="button"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-600">
              Total records: <span className="font-black text-slate-900">{items.length}</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {["pending", "verified", "rejected", "all"].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={
                    "rounded-full px-4 py-2 text-sm font-extrabold " +
                    (filter === f
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200")
                  }
                  type="button"
                >
                  {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-700 shadow-sm">
            Loading verification queue…
          </div>
        ) : error ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-semibold text-rose-800 shadow-sm">
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="text-lg font-black text-slate-900">No verification records</div>
            <div className="mt-2 text-sm font-semibold text-slate-600">
              There are no records matching the current filter.
            </div>
          </div>
        ) : (
          <div className="mt-6 grid gap-4">
            {filtered.map((item) => {
              const rowId = String(item.id ?? item.user_id ?? "");
              const docLinks = getDocumentLinks(item);
              return (
                <div
                  key={rowId}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-black text-slate-900">
                        {item.email || "Unknown account"}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-500">
                        Role: {item.role || "—"}
                        <span className="ml-3">Submitted: {fmtDate(item.submitted_at)}</span>
                        <span className="ml-3">Reviewed: {fmtDate(item.reviewed_at)}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${badge(item.status)}`}>
                        {String(item.status || "not_started").replace("_", " ").toUpperCase()}
                      </span>

                      <span
                        className={`rounded-full px-3 py-1 text-xs font-extrabold ${
                          String(item.payment_status || "").toLowerCase() === "paid"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {String(item.payment_status || "unpaid").toUpperCase()}
                      </span>

                      <div className="text-sm font-extrabold text-slate-700">Fee: {money(item.fee_amount)}</div>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-[1.2fr_1fr]">
                    <div className="rounded-xl bg-slate-50 p-4">
                      <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                        Submitted documents
                      </div>

                      {docLinks.length > 0 ? (
                        <div className="mt-3 grid gap-2">
                          {docLinks.map((doc, idx) => {
                            const href = toAbsoluteUrl(doc.url);
                            return href ? (
                              <a
                                key={`${href}-${idx}`}
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 underline hover:bg-slate-50"
                              >
                                {doc.label || doc.name || "Open document"}
                                {doc.name && doc.label && doc.name !== doc.label ? (
                                  <span className="ml-2 text-xs font-bold text-slate-400">({doc.name})</span>
                                ) : null}
                              </a>
                            ) : (
                              <div
                                key={`${doc.name || idx}`}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                              >
                                {doc?.name || "Unnamed document"}
                                {doc?.type ? (
                                  <span className="ml-2 text-xs font-bold text-slate-400">({doc.type})</span>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mt-3 text-sm font-semibold text-slate-500">
                          No uploaded documents found yet.
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl bg-slate-50 p-4">
                      <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                        Admin notes
                      </div>
                      <textarea
                        value={notesById[rowId] ?? item.notes ?? ""}
                        onChange={(e) =>
                          setNotesById((prev) => ({
                            ...prev,
                            [rowId]: e.target.value,
                          }))
                        }
                        placeholder="Add review notes…"
                        className="mt-3 min-h-[120px] w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-800 outline-none focus:border-slate-400"
                      />

                      <div className="mt-4 flex flex-wrap gap-3">
                        <button
                          onClick={() => reviewVerification(item, "verified")}
                          className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50"
                          type="button"
                          disabled={busyId === rowId}
                        >
                          {busyId === rowId ? "Saving..." : "Approve"}
                        </button>

                        <button
                          onClick={() => reviewVerification(item, "rejected")}
                          className="rounded-full bg-rose-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-rose-700 disabled:opacity-50"
                          type="button"
                          disabled={busyId === rowId}
                        >
                          {busyId === rowId ? "Saving..." : "Reject"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}





