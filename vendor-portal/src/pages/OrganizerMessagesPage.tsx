// src/pages/OrganizerMessagesPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE =
  import.meta.env.VITE_API_BASE || "https://event-app-api-production-ccce.up.railway.app";

/**
 * OrganizerMessagesPage
 * Backend-first organizer messaging inbox for a single event.
 *
 * Expected backend:
 *   GET  /organizer/events/:eventId/messages
 *   POST /organizer/events/:eventId/messages
 *
 * GET response shape:
 * {
 *   threads: [
 *     {
 *       id: string,
 *       eventId?: string,
 *       appId?: string,
 *       focus?: string,
 *       subject: string,
 *       organizer?: string,
 *       updatedAt: string,
 *       unread: number,
 *       messages: [{ id, role, text, createdAt }]
 *     }
 *   ]
 * }
 *
 * POST body:
 * {
 *   thread_id?: string,
 *   subject?: string,
 *   text: string
 * }
 */

type Message = {
  id: string;
  role: "vendor" | "organizer";
  text: string;
  createdAt: string;
};

type Thread = {
  id: string;
  eventId?: string;
  appId?: string;
  focus?: string;
  subject: string;
  organizer?: string;
  updatedAt: string;
  unread: number;
  messages: Message[];
};

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix = "m") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function normalizeId(v: any) {
  return String(v ?? "").trim();
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function normalizeThreads(raw: any): Thread[] {
  const threads = Array.isArray(raw?.threads) ? raw.threads : Array.isArray(raw) ? raw : [];

  return threads
    .map((t: any) => ({
      ...t,
      id: normalizeId(t?.id) || uid("t"),
      eventId: normalizeId(t?.eventId || t?.event_id) || undefined,
      appId: normalizeId(t?.appId || t?.app_id) || undefined,
      focus: normalizeId(t?.focus) || undefined,
      subject: String(t?.subject || "Message"),
      organizer: normalizeId(t?.organizer) || undefined,
      updatedAt: String(t?.updatedAt || t?.updated_at || nowIso()),
      unread: Number.isFinite(Number(t?.unread)) ? Number(t.unread) : 0,
      messages: Array.isArray(t?.messages)
        ? t.messages.map((m: any) => ({
            id: normalizeId(m?.id) || uid("m"),
            role: m?.role === "vendor" ? "vendor" : "organizer",
            text: String(m?.text || ""),
            createdAt: String(m?.createdAt || m?.created_at || nowIso()),
          }))
        : [],
    }))
    .sort(
      (a: Thread, b: Thread) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
}

async function loadThreads(eventId: string): Promise<Thread[]> {
  const res = await fetch(`${API_BASE}/organizer/events/${eventId}/messages`, {
    headers: buildAuthHeaders(),
  });

  if (!res.ok) return [];

  const data = await res.json().catch(() => null);
  return normalizeThreads(data);
}

function buildTitle(t: Thread) {
  const bits: string[] = [];
  if (t.eventId) bits.push(`Event ${t.eventId}`);
  if (t.organizer) bits.push(t.organizer);
  const prefix = bits.length ? `${bits.join(" • ")} — ` : "";
  return `${prefix}${t.subject || "Message"}`;
}

export default function OrganizerMessagesPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const { eventId = "" } = useParams();

  const qs = useMemo(() => new URLSearchParams(loc.search || ""), [loc.search]);
  const qEventId = normalizeId(qs.get("eventId")) || eventId;
  const qOrganizer = normalizeId(qs.get("organizer"));
  const qSubject = normalizeId(qs.get("subject")) || "New message";
  const qAppId = normalizeId(qs.get("appId"));
  const qFocus = normalizeId(qs.get("focus"));

  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [composer, setComposer] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [sending, setSending] = useState<boolean>(false);
  const [refreshTick, setRefreshTick] = useState<number>(0);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!eventId) {
        if (!cancelled) {
          setThreads([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      try {
        const t = await loadThreads(eventId);
        if (!cancelled) setThreads(t);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();

    return () => {
      cancelled = true;
    };
  }, [eventId, refreshTick]);

  useEffect(() => {
    if (!activeId && threads[0]?.id) {
      setActiveId(threads[0].id);
      return;
    }
    if (activeId && !threads.some((t) => t.id === activeId)) {
      setActiveId(threads[0]?.id || "");
    }
  }, [threads, activeId]);

  // If deep-link params provided, open matching thread when present; otherwise seed a temporary draft thread.
  useEffect(() => {
    if (!qEventId && !qOrganizer && !qSubject && !qAppId && !qFocus) return;
    if (!threads.length) return;

    const existing = threads.find(
      (t) =>
        (t.eventId || "") === (qEventId || "") &&
        (t.appId || "") === (qAppId || "") &&
        (t.focus || "") === (qFocus || "") &&
        (t.organizer || "") === (qOrganizer || "") &&
        (t.subject || "") === (qSubject || "New message")
    );

    if (existing) {
      if (activeId !== existing.id) setActiveId(existing.id);
      return;
    }

    // Only create a local draft placeholder if there is deep-link intent and no real thread yet.
    const draftId = `draft_${qEventId || eventId || "x"}_${qAppId || "na"}_${qFocus || "na"}_${qSubject}`;
    const alreadyDrafted = threads.some((t) => t.id === draftId);
    if (alreadyDrafted) {
      if (activeId !== draftId) setActiveId(draftId);
      return;
    }

    const draft: Thread = {
      id: draftId,
      eventId: qEventId || eventId || undefined,
      appId: qAppId || undefined,
      focus: qFocus || undefined,
      organizer: qOrganizer || undefined,
      subject: qSubject || "New message",
      updatedAt: nowIso(),
      unread: 0,
      messages: [],
    };

    setThreads((prev) => [draft, ...prev]);
    setActiveId(draftId);
  }, [threads, qEventId, qOrganizer, qSubject, qAppId, qFocus, activeId, eventId]);

  const active = useMemo(
    () => threads.find((t) => t.id === activeId) || threads[0] || null,
    [threads, activeId]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [active?.id, active?.messages?.length]);

  function markRead(threadId: string) {
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, unread: 0 } : t))
    );
  }

  async function send() {
    const text = composer.trim();
    if (!text || !eventId || !active || sending) return;

    setSending(true);
    try {
      const payload: Record<string, any> = {
        text,
      };

      // Only send thread_id for real persisted threads, not draft placeholders.
      if (!active.id.startsWith("draft_")) {
        payload.thread_id = active.id;
      } else {
        payload.subject = active.subject || "New message";
        if (active.appId) payload.app_id = active.appId;
        if (active.focus) payload.focus = active.focus;
        if (active.organizer) payload.organizer = active.organizer;
      }

      const res = await fetch(`${API_BASE}/organizer/events/${eventId}/messages`, {
        method: "POST",
        headers: {
          ...buildAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) return;

      const reloaded = await loadThreads(eventId);
      setThreads(reloaded);
      setComposer("");

      if (reloaded.length) {
        const matched =
          (!active.id.startsWith("draft_") && reloaded.find((t) => t.id === active.id)) ||
          reloaded.find(
            (t) =>
              t.subject === (active.subject || "New message") &&
              (t.appId || "") === (active.appId || "") &&
              (t.focus || "") === (active.focus || "")
          ) ||
          reloaded[0];

        if (matched?.id) setActiveId(matched.id);
      }
    } finally {
      setSending(false);
    }
  }

  function createNewThread() {
    const draft: Thread = {
      id: uid("draft"),
      eventId: eventId || undefined,
      subject: "New message",
      updatedAt: nowIso(),
      unread: 0,
      messages: [],
    };

    setThreads((prev) => [draft, ...prev]);
    setActiveId(draft.id);
    setComposer("");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-8 py-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Organizer
            </h1>
            <p className="text-sm text-slate-600">
              A command center for events, applications, and contacts.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setRefreshTick((x) => x + 1)}
              className="rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
            >
              Refresh
            </button>
            <button
              type="button"
              className="rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] px-8 py-10">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 text-sm text-slate-500">Organizer Portal</div>
            <h2 className="text-4xl font-bold tracking-tight text-slate-900">
              Messages
            </h2>
            <p className="mt-2 text-lg text-slate-600">
              Message vendors about booth details, payment, setup, or logistics.
            </p>
            {eventId ? (
              <div className="mt-2 text-sm text-slate-500">Event ID: {eventId}</div>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => nav("/organizer/dashboard")}
              className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-base font-medium text-slate-800 transition hover:bg-slate-50"
            >
              Back to Dashboard
            </button>
            <button
              type="button"
              onClick={createNewThread}
              className="rounded-xl bg-slate-950 px-5 py-4 text-base font-semibold text-white transition hover:bg-slate-800"
            >
              New message
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="text-sm font-semibold text-slate-900">Conversations</div>
            </div>

            <div className="max-h-[720px] overflow-y-auto p-3">
              {loading ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                  Loading messages…
                </div>
              ) : threads.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                  No conversations yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {threads.map((t) => {
                    const selected = t.id === active?.id;
                    const last = t.messages?.[t.messages.length - 1];
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setActiveId(t.id);
                          markRead(t.id);
                        }}
                        className={[
                          "w-full rounded-2xl border px-4 py-4 text-left transition",
                          selected
                            ? "border-indigo-200 bg-indigo-50"
                            : "border-slate-200 bg-white hover:bg-slate-50",
                        ].join(" ")}
                      >
                        <div className="mb-2 flex items-start justify-between gap-3">
                          <div className="line-clamp-1 font-semibold text-slate-900">
                            {t.subject || "New message"}
                          </div>
                          <div className="shrink-0 text-xs text-slate-500">
                            {formatTime(t.updatedAt)}
                          </div>
                        </div>

                        <div className="line-clamp-2 text-sm text-slate-600">
                          {last?.text || buildTitle(t)}
                        </div>

                        {t.unread > 0 ? (
                          <div className="mt-3 inline-flex rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">
                            {t.unread} new
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="text-lg font-semibold text-slate-900">
                {active?.subject || "New message"}
              </div>
            </div>

            <div className="flex min-h-[720px] flex-col">
              <div className="flex-1 space-y-4 overflow-y-auto bg-white px-5 py-5">
                {!active ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
                    Select a conversation to view messages.
                  </div>
                ) : active.messages.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
                    Start the conversation here.
                  </div>
                ) : (
                  active.messages.map((m) => (
                    <div
                      key={m.id}
                      className={[
                        "max-w-[70%] rounded-3xl border px-5 py-4 shadow-sm",
                        m.role === "organizer"
                          ? "ml-auto border-indigo-200 bg-indigo-50"
                          : "border-slate-200 bg-slate-50",
                      ].join(" ")}
                    >
                      <div className="mb-2 text-sm font-semibold text-slate-900">
                        {m.role === "organizer" ? "Organizer" : "Vendor"}
                      </div>
                      <div className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800">
                        {m.text}
                      </div>
                      <div className="mt-3 text-xs text-slate-500">
                        {formatTime(m.createdAt)}
                      </div>
                    </div>
                  ))
                )}
                <div ref={bottomRef} />
              </div>

              <div className="border-t border-slate-200 bg-white p-4">
                <div className="flex items-end gap-3">
                  <textarea
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    rows={3}
                    placeholder="Type your message..."
                    className="min-h-[72px] flex-1 resize-y rounded-2xl border border-slate-200 px-4 py-3 text-base outline-none transition focus:border-slate-400"
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={!composer.trim() || !eventId || sending}
                    className="rounded-2xl bg-indigo-600 px-6 py-4 text-base font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sending ? "Sending..." : "Send"}
                  </button>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Press Ctrl/Cmd + Enter to send.
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}





