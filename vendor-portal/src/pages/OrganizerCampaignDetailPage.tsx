import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiGet } from "../api";

type BulkMessageSummary = {
  id: number;
  channel: "email" | "sms";
  subject: string | null;
  body: string;
  status: string;
  created_at?: string | null;
  queued_at?: string | null;
  eligible_count?: number | null;
  skipped_count?: number | null;
};

type BulkMessageRecipientOut = {
  contact_id: number;
  name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  status: string;
  reason_skipped?: string | null;
  rendered_text?: string | null;
};

type BulkMessageDetailResponse = {
  message: BulkMessageSummary;
  recipients: BulkMessageRecipientOut[];
};

export default function OrganizerCampaignDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<BulkMessageDetailResponse | null>(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");

  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setErr(null);
      try {
        const bulkId = Number(id);
        if (!bulkId || Number.isNaN(bulkId)) throw new Error("Invalid campaign id.");

        const res = await apiGet<BulkMessageDetailResponse>(`/organizer/messages/${bulkId}`);
        if (!alive) return;

        if (!res?.message || !Array.isArray(res.recipients)) {
          throw new Error("Unexpected response shape (missing message/recipients).");
        }

        setData(res);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Failed to load campaign.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [id]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of data?.recipients ?? []) set.add((r.status || "unknown").toLowerCase());
    return ["all", ...Array.from(set).sort()];
  }, [data]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return (data?.recipients ?? []).filter((r) => {
      const st = (r.status || "unknown").toLowerCase();
      if (status !== "all" && st !== status) return false;
      if (!qq) return true;

      const hay = [
        r.name || "",
        r.company || "",
        r.email || "",
        r.phone || "",
        r.reason_skipped || "",
        r.rendered_text || "",
        String(r.contact_id ?? ""),
      ]
        .join(" ")
        .toLowerCase();

      return hay.includes(qq);
    });
  }, [data, q, status]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold">
            {data?.message ? `Campaign #${data.message.id}` : "Campaign"}
          </div>
          {data?.message && (
            <div className="text-sm text-gray-500 mt-1">
              Channel: {data.message.channel.toUpperCase()} · Status: {data.message.status}
            </div>
          )}
        </div>

        <button className="px-3 py-2 rounded-lg border hover:bg-gray-50" onClick={() => nav(-1)}>
          Back
        </button>
      </div>

      {loading ? (
        <div className="rounded-2xl border bg-white p-6 text-sm text-gray-600">Loading…</div>
      ) : err ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">{err}</div>
      ) : !data ? (
        <div className="rounded-2xl border bg-white p-6 text-sm text-gray-600">No data.</div>
      ) : (
        <>
          <div className="rounded-2xl border bg-white p-6 space-y-3">
            {data.message.subject !== null && (
              <div>
                <div className="text-sm font-medium">Subject</div>
                <div className="text-sm text-gray-700">{data.message.subject || "—"}</div>
              </div>
            )}

            <div>
              <div className="text-sm font-medium">Body</div>
              <pre className="mt-1 whitespace-pre-wrap rounded-lg border bg-gray-50 p-3 text-xs">
                {data.message.body}
              </pre>
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium">Status</div>
              <select
                className="border rounded-lg px-2 py-2 bg-white text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1 md:max-w-md">
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Search name/email/phone/reason/rendered…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-2xl border bg-white overflow-hidden">
            <div className="px-5 py-4 border-b">
              <div className="text-lg font-semibold">Recipients</div>
              <div className="text-sm text-gray-500 mt-1">
                Showing {filtered.length} of {data.recipients.length}
              </div>
            </div>

            <div className="overflow-auto">
              <table className="min-w-[980px] w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-5 py-3 w-28">Contact ID</th>
                    <th className="text-left px-5 py-3">Name</th>
                    <th className="text-left px-5 py-3">Email</th>
                    <th className="text-left px-5 py-3">Phone</th>
                    <th className="text-left px-5 py-3 w-28">Status</th>
                    <th className="text-left px-5 py-3">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, idx) => (
                    <tr key={`${r.contact_id}-${idx}`} className="border-t align-top">
                      <td className="px-5 py-3 font-medium">{r.contact_id}</td>
                      <td className="px-5 py-3">{r.name || "—"}</td>
                      <td className="px-5 py-3">{r.email || "—"}</td>
                      <td className="px-5 py-3">{r.phone || "—"}</td>
                      <td className="px-5 py-3">{r.status}</td>
                      <td className="px-5 py-3">{r.reason_skipped || "—"}</td>
                    </tr>
                  ))}

                  {filtered.length === 0 ? (
                    <tr>
                      <td className="px-5 py-8 text-gray-600" colSpan={6}>
                        No recipients match your filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
