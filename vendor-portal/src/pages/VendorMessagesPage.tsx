// src/pages/VendorMessagesPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * VendorMessagesPage (MVP)
 * - No backend required: persists to localStorage
 * - Two-pane inbox layout (threads + messages)
 * - Supports deep-linking via query params:
 *    /vendor/messages?eventId=6&appId=98&organizer=organizer@example.com&subject=Payment%20question&focus=payment
 */

type Message = {
  id: string;
  role: "vendor" | "organizer";
  text: string;
  createdAt: string; // ISO
};

type Thread = {
  id: string;
  eventId?: string;
  appId?: string;
  focus?: string;
  subject: string;
  organizer?: string; // email or name
  updatedAt: string; // ISO
  unread: number;
  messages: Message[];
};

const LS_KEY = "vc_messages_v1";

function safeJsonParse<T = any>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

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

function loadThreads(): Thread[] {
  const j = safeJsonParse<{ threads?: Thread[] }>(localStorage.getItem(LS_KEY));
  const threads = Array.isArray(j?.threads) ? j!.threads! : [];
  return threads
    .map((t) => ({
      ...t,
      id: normalizeId(t.id) || uid("t"),
      subject: String(t.subject || "Message"),
      updatedAt: String(t.updatedAt || nowIso()),
      unread: Number.isFinite(Number(t.unread)) ? Number(t.unread) : 0,
      messages: Array.isArray(t.messages) ? t.messages : [],
    }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function saveThreads(threads: Thread[]) {
  localStorage.setItem(LS_KEY, JSON.stringify({ threads }));
}

function buildTitle(t: Thread) {
  const bits: string[] = [];
  if (t.eventId) bits.push(`Event ${t.eventId}`);
  if (t.organizer) bits.push(t.organizer);
  const prefix = bits.length ? `${bits.join(" • ")} — ` : "";
  return `${prefix}${t.subject || "Message"}`;
}

export default function VendorMessagesPage() {
  const nav = useNavigate();
  const loc = useLocation();

  const qs = useMemo(() => new URLSearchParams(loc.search || ""), [loc.search]);
  const qEventId = normalizeId(qs.get("eventId"));
  const qOrganizer = normalizeId(qs.get("organizer"));
  const qSubject = normalizeId(qs.get("subject")) || "New message";
  const qAppId = normalizeId(qs.get("appId"));
  const qFocus = normalizeId(qs.get("focus"));

  const [threads, setThreads] = useState<Thread[]>(() => loadThreads());
  const [activeId, setActiveId] = useState<string>(() => threads[0]?.id || "");
  const [composer, setComposer] = useState<string>("");

  const bottomRef = useRef<HTMLDivElement | null>(null);

  // If deep-link params provided, open or create matching thread.
  useEffect(() => {
    if (!qEventId && !qOrganizer && !qSubject && !qAppId) return;

    setThreads((prev) => {
      const existing = prev.find(
        (t) =>
          t.eventId === (qEventId || undefined) &&
          (t.appId || "") === (qAppId || "") &&
          (t.focus || "") === (qFocus || "") &&
          (t.organizer || "") === (qOrganizer || "") &&
          (t.subject || "") === (qSubject || "New message")
      );
      if (existing) {
        setActiveId(existing.id);
        return prev;
      }

      const t: Thread = {
        id: uid("t"),
        eventId: qEventId || undefined,
        appId: qAppId || undefined,
        focus: qFocus || undefined,
        organizer: qOrganizer || undefined,
        subject: qSubject || "New message",
        updatedAt: nowIso(),
        unread: 0,
        messages: [
          {
            id: uid("m"),
            role: "organizer",
            createdAt: nowIso(),
            text:
              "Hi! This is your message thread with the organizer. (MVP: stored locally only.)\n\n" +
              "Tip: ask about payment, booth details, or setup timing here.",
          },
        ],
      };

      const next = [t, ...prev];
      saveThreads(next);
      setActiveId(t.id);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qEventId, qOrganizer, qSubject, qAppId, qFocus]);

  // Persist on any change
  useEffect(() => {
    saveThreads(threads);
  }, [threads]);

  const active = useMemo(() => threads.find((t) => t.id === activeId) || threads[0], [threads, activeId]);

  // Auto-scroll on active thread change / message count change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [active?.id, active?.messages?.length]);

  function markRead(threadId: string) {
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, unread: 0 } : t)));
  }

  function send() {
    const text = composer.trim();
    if (!text || !active) return;

    const msg: Message = { id: uid("m"), role: "vendor", text, createdAt: nowIso() };

    setThreads((prev) =>
      prev
        .map((t) =>
          t.id === active.id ? { ...t, updatedAt: nowIso(), messages: [...(t.messages || []), msg] } : t
        )
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    );

    setComposer("");

    // Optional: fake organizer echo (helps UX during demo). Remove later.
    window.setTimeout(() => {
      setThreads((prev) =>
        prev.map((t) => {
          if (t.id !== active.id) return t;
          const echo: Message = {
            id: uid("m"),
            role: "organizer",
            createdAt: nowIso(),
            text: "Got it — thanks! (Demo reply. Later this will come from the organizer.)",
          };
          return { ...t, updatedAt: nowIso(), unread: 0, messages: [...t.messages, echo] };
        })
      );
    }, 700);
  }

  function newThread() {
    const t: Thread = {
      id: uid("t"),
      subject: "New message",
      updatedAt: nowIso(),
      unread: 0,
      messages: [
        { id: uid("m"), role: "organizer", createdAt: nowIso(), text: "Start the conversation here. (MVP: stored locally only.)" },
      ],
    };
    setThreads((prev) => [t, ...prev]);
    setActiveId(t.id);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-slate-500">Vendor Portal</div>
            <h1 className="truncate text-2xl font-semibold text-slate-900">Messages</h1>
            <div className="mt-1 text-sm text-slate-600">
              Message organizers about your booth, payment, or logistics.
              <span className="ml-2 text-xs font-semibold text-slate-500">(MVP: saved locally)</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => nav("/vendor/dashboard")}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Back to Dashboard
            </button>

            <button
              type="button"
              onClick={newThread}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
            >
              New message
            </button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Thread list */}
          <div className="rounded-2xl border border-slate-200 bg-white p-3 lg:col-span-1">
            {threads.length === 0 ? (
              <div className="p-4 text-sm text-slate-600">
                No messages yet. Click <span className="font-semibold">New message</span> to start one.
              </div>
            ) : (
              <div className="space-y-2">
                {threads.map((t) => {
                  const isActive = t.id === active?.id;
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
                        "w-full rounded-xl border p-3 text-left transition",
                        isActive ? "border-indigo-200 bg-indigo-50" : "border-slate-200 hover:bg-slate-50",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">{buildTitle(t)}</div>
                          <div className="mt-1 truncate text-xs text-slate-600">{last?.text ? last.text : "—"}</div>
                        </div>

                        <div className="shrink-0 text-right">
                          <div className="text-[11px] font-semibold text-slate-500">{formatTime(t.updatedAt)}</div>
                          {t.unread > 0 ? (
                            <div className="mt-1 inline-flex rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">
                              {t.unread}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Conversation */}
          <div className="rounded-2xl border border-slate-200 bg-white lg:col-span-2">
            {!active ? (
              <div className="p-6 text-sm text-slate-600">Select a thread to view messages.</div>
            ) : (
              <div className="flex h-[70vh] flex-col">
                <div className="border-b border-slate-200 p-4">
                  <div className="text-sm font-semibold text-slate-900">{buildTitle(active)}</div>
                  <div className="mt-1 text-xs text-slate-600">
                    {active.eventId ? (
                      <>
                        Event: <span className="font-mono">{active.eventId}</span> •{" "}
                      </>
                    ) : null}
                    {active.organizer ? (
                      <>
                        Organizer: <span className="font-mono">{active.organizer}</span>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="flex-1 overflow-auto p-4">
                  <div className="space-y-3">
                    {(active.messages || []).map((m) => {
                      const mine = m.role === "vendor";
                      return (
                        <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                          <div
                            className={[
                              "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm",
                              mine ? "bg-slate-900 text-white" : "border border-slate-200 bg-slate-50 text-slate-900",
                            ].join(" ")}
                          >
                            <div className="text-xs font-bold opacity-80">{mine ? "You" : "Organizer"}</div>
                            <div className="mt-1">{m.text}</div>
                            <div className="mt-2 text-[11px] font-semibold opacity-70">{formatTime(m.createdAt)}</div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={bottomRef} />
                  </div>
                </div>

                <div className="border-t border-slate-200 p-4">
                  <div className="flex gap-2">
                    <textarea
                      value={composer}
                      onChange={(e) => setComposer(e.target.value)}
                      placeholder="Type your message…"
                      className="h-12 flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={send}
                      className="h-12 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 text-sm font-bold text-white hover:opacity-95"
                    >
                      Send
                    </button>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    Press <span className="font-semibold">Enter</span> to send • <span className="font-semibold">Shift+Enter</span>{" "}
                    for a new line
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tiny helper: dev reset */}
        <div className="mt-6 text-xs text-slate-500">
          <button
            type="button"
            className="hover:underline"
            onClick={() => {
              localStorage.removeItem(LS_KEY);
              setThreads([]);
              setActiveId("");
            }}
          >
            Reset local messages (dev)
          </button>
        </div>
      </div>
    </div>
  );
}
