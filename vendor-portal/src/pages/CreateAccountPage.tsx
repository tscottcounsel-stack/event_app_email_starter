// src/pages/CreateAccountPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { clearSession, readSession } from "../auth/authStorage";

type Role = "vendor" | "organizer";

const RAW_API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  "";

const API_BASE = String(RAW_API_BASE).replace(/\/+$/, "");

type AgreementItem = {
  id: string;
  title: string;
  details: string;
};

const VENDOR_AGREEMENTS: AgreementItem[] = [
  {
    id: "v1",
    title:
      "I certify that I am authorized to represent this business and that all information provided is accurate and truthful.",
    details:
      "You confirm you have authority to submit this account and the details you provide are correct.",
  },
  {
    id: "v2",
    title:
      "I understand that I operate as an independent business and am solely responsible for my products, services, taxes, permits, insurance, and compliance.",
    details:
      "You are responsible for legal compliance, licensing, insurance, and operating requirements for your business.",
  },
  {
    id: "v3",
    title:
      "I understand that booth fees are set by organizers and that payments and refunds are governed by each organizer's event policies.",
    details:
      "Pricing and refund terms are defined per event. VendorConnect displays those terms but does not override organizer policies.",
  },
  {
    id: "v4",
    title:
      "I agree to release the platform from liability related to event participation, transactions, or disputes.",
    details:
      "VendorConnect is a marketplace. You agree disputes are handled between the parties and subject to platform policies.",
  },
  {
    id: "v5",
    title: "I agree to the Terms of Service and Privacy Policy.",
    details:
      "You agree to the VendorConnect Terms of Service and Privacy Policy (to be linked later).",
  },
];

const ORGANIZER_AGREEMENTS: AgreementItem[] = [
  {
    id: "o1",
    title:
      "I certify that I am authorized to represent this organization and that all information provided is accurate.",
    details:
      "You confirm you have authority to create an organizer account and the information you provide is correct.",
  },
  {
    id: "o2",
    title:
      "I understand that I am solely responsible for operating my events in compliance with all laws and regulations.",
    details:
      "You are responsible for permits, venue compliance, safety rules, and local requirements.",
  },
  {
    id: "o3",
    title:
      "I understand that I am solely responsible for vendor selection, approvals, payments, refunds, and dispute resolution.",
    details:
      "You control approval decisions and payment/refund policies for each event (subject to platform rules).",
  },
  {
    id: "o4",
    title:
      "I understand that the platform may charge subscription or transaction fees and that payment processing fees may apply.",
    details:
      "VendorConnect may apply platform fees and third-party processing fees (to be configured later).",
  },
  {
    id: "o5",
    title:
      "I agree to release the platform from liability related to event execution, vendor disputes, payments, or damages.",
    details:
      "VendorConnect is a marketplace and is not responsible for event execution or third-party actions.",
  },
  {
    id: "o6",
    title: "I agree to the Terms of Service and Privacy Policy.",
    details:
      "You agree to the VendorConnect Terms of Service and Privacy Policy (to be linked later).",
  },
];

function TopBar() {
  const navigate = useNavigate();
  const session = readSession();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600" />
          <span className="text-lg font-black text-slate-900">VendorConnect</span>
        </Link>

        {session?.accessToken ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                clearSession();
                navigate('/login');
              }}
              className="rounded-full border border-red-200 bg-white px-5 py-2 text-sm font-extrabold text-red-700 hover:bg-red-50"
            >
              Logout
            </button>
          </div>
        ) : (
          <Link
            to="/login"
            className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}

function StepPill({ n, label, active }: { n: number; label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={[
          "grid h-9 w-9 place-items-center rounded-full text-sm font-black",
          active ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-700",
        ].join(" ")}
      >
        {n}
      </div>
      <div className={["text-sm font-extrabold", active ? "text-indigo-700" : "text-slate-500"].join(" ")}>
        {label}
      </div>
    </div>
  );
}

function RoleCard({
  active,
  title,
  subtitle,
  icon,
  bullets,
  onClick,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  bullets: string[];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full rounded-[28px] border bg-white p-7 text-left shadow-sm transition",
        active ? "border-indigo-500 ring-2 ring-indigo-200" : "border-slate-200 hover:bg-slate-50",
      ].join(" ")}
    >
      <div className="flex items-start gap-5">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-50">{icon}</div>
        <div className="min-w-0">
          <div className="text-2xl font-black text-slate-900">{title}</div>
          <div className="mt-1 text-sm font-semibold text-slate-600">{subtitle}</div>

          <ul className="mt-5 space-y-2 text-sm font-semibold text-slate-700">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span className={active ? "text-indigo-600" : "text-slate-400"}>•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>

          {active ? (
            <div className="mt-6 inline-flex items-center gap-2 text-sm font-black text-indigo-700">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-indigo-600 text-white">✓</span>
              Selected
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function AgreementRow({
  checked,
  title,
  details,
  onToggle,
}: {
  checked: boolean;
  title: string;
  details: string;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onToggle}
          className={[
            "grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 transition",
            checked ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white",
          ].join(" ")}
          aria-label={checked ? "Checked" : "Unchecked"}
        >
          {checked ? "✓" : ""}
        </button>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-extrabold text-slate-900">{title}</div>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-2 inline-flex items-center gap-2 text-sm font-bold text-indigo-700 hover:text-indigo-800"
          >
            View details
            <span className={["transition", open ? "rotate-180" : ""].join(" ")}>▾</span>
          </button>

          {open ? <div className="mt-3 text-sm font-semibold text-slate-600">{details}</div> : null}
        </div>
      </div>
    </div>
  );
}

function normalizeRole(raw: string | null): Role | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v === "vendor") return "vendor";
  if (v === "organizer") return "organizer";
  return null;
}

export default function CreateAccountPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const roleFromUrl = useMemo(() => normalizeRole(searchParams.get("role")), [searchParams]);

  const [step, setStep] = useState<1 | 2 | 3>(roleFromUrl ? 2 : 1);
  const [role, setRole] = useState<Role>(roleFromUrl ?? "vendor");

  useEffect(() => {
    if (roleFromUrl && roleFromUrl !== role) {
      setRole(roleFromUrl);
      setStep(2);
      setCheckedIds([]);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleFromUrl]);

  const agreements = useMemo(() => (role === "vendor" ? VENDOR_AGREEMENTS : ORGANIZER_AGREEMENTS), [role]);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const completed = checkedIds.length;
  const total = agreements.length;
  const pct = total ? Math.round((completed / total) * 100) : 0;

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForRole(nextRole: Role) {
    setRole(nextRole);
    setCheckedIds([]);
    setError(null);
  }

  function toggleAgreement(id: string) {
    setCheckedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function goBack() {
    if (step === 1) {
      navigate("/get-started");
      return;
    }
    setStep((s) => (s === 3 ? 2 : 1));
  }

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!API_BASE) {
      setError("API base URL is not configured.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const payload: any = { email, password, role };
      if (role === "organizer") payload.full_name = fullName;

      const res = await fetch(`${API_BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let message = "Account creation failed";

        try {
          const data = await res.json();
          message = data?.detail || data?.message || data?.error || message;
        } catch {
          const text = await res.text().catch(() => "");
          if (text) message = text;
        }

        throw new Error(message);
      }

      const data = await res.json().catch(() => ({} as any));
      const token = data.access_token || data.accessToken || data.token;

      if (token) localStorage.setItem("accessToken", token);
      localStorage.setItem("userRole", role);
      localStorage.setItem("userEmail", email);

      navigate(role === "organizer" ? "/organizer/dashboard" : "/vendor/dashboard");
    } catch (err: any) {
      setError(err?.message || "Account creation failed");
    } finally {
      setLoading(false);
    }
  }

  const headerTitle =
    step === 1
      ? "Create Your Account"
      : step === 2
      ? `${role === "vendor" ? "Vendor" : "Organizer"} Agreement`
      : "Account Details";

  const headerSub =
    step === 1
      ? "Join VendorConnect's trusted marketplace of verified organizers and vendors"
      : step === 2
      ? "Please review and confirm the following before creating your account."
      : `Create your ${role === "vendor" ? "Vendor" : "Organizer"} account. You can update your profile after signing in.`;

  return (
    <div className="min-h-screen bg-white">
      <TopBar />

      <section className="min-h-[calc(100vh-73px)] bg-gradient-to-br from-indigo-50 via-white to-purple-50">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-4 py-2 text-sm font-extrabold text-indigo-700 shadow-sm">
              <span className="text-indigo-600">🛡️</span> Verified Partners Only
            </div>
          </div>

          <div className="mt-7 text-center">
            <h1 className="text-5xl font-black text-slate-900">{headerTitle}</h1>
            <p className="mx-auto mt-3 max-w-2xl text-base font-semibold text-slate-600">{headerSub}</p>
          </div>

          <div className="mx-auto mt-10 max-w-5xl">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => navigate("/get-started")}
                className="inline-flex items-center gap-2 text-sm font-extrabold text-slate-600 hover:text-slate-900"
              >
                ← Back to role selection
              </button>

              <div className="flex items-center gap-6">
                <StepPill n={1} label="Role" active={step === 1} />
                <div className="h-0.5 w-10 rounded bg-slate-200" />
                <StepPill n={2} label="Verification" active={step === 2} />
                <div className="h-0.5 w-10 rounded bg-slate-200" />
                <StepPill n={3} label="Details" active={step === 3} />
              </div>
            </div>

            <div className="mt-8 rounded-[34px] border border-slate-200 bg-white p-8 shadow-sm">
              {step === 1 ? (
                <>
                  <div className="grid gap-6 md:grid-cols-2">
                    <RoleCard
                      active={role === "vendor"}
                      title="Vendor"
                      subtitle="Apply to events, manage your business profile, and book booths."
                      icon={
                        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-700">
                          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 7l1-2h16l1 2v13H3V7Z" />
                            <path d="M5 7h14" />
                            <path d="M8 11h8" />
                          </svg>
                        </div>
                      }
                      bullets={["Browse verified events", "Interactive booth selection", "Showcase your portfolio", "Secure payment processing"]}
                      onClick={() => resetForRole("vendor")}
                    />

                    <RoleCard
                      active={role === "organizer"}
                      title="Organizer"
                      subtitle="Create events, manage vendors, sell booth space, and accept payments."
                      icon={
                        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-purple-50 text-purple-700">
                          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M7 2v4M17 2v4M3 9h18" />
                            <path d="M5 6h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
                          </svg>
                        </div>
                      }
                      bullets={["Create unlimited events", "Custom booth layouts", "Vendor applications management", "Payment & analytics dashboard"]}
                      onClick={() => resetForRole("organizer")}
                    />
                  </div>

                  <div className="mt-10 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 px-14 py-4 text-base font-black text-white shadow-sm"
                    >
                      Continue
                    </button>
                  </div>

                  <div className="mt-5 text-center text-sm font-semibold text-slate-600">
                    Already have an account?{" "}
                    <Link to="/login" className="font-black text-indigo-700 hover:text-indigo-800">
                      Sign in
                    </Link>
                  </div>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-start gap-4">
                      <div
                        className={[
                          "grid h-12 w-12 place-items-center rounded-2xl",
                          role === "vendor" ? "bg-indigo-50 text-indigo-700" : "bg-purple-50 text-purple-700",
                        ].join(" ")}
                      >
                        🛡️
                      </div>
                      <div className="min-w-0">
                        <div className="text-2xl font-black text-slate-900">
                          {role === "vendor" ? "Vendor Account Agreement" : "Organizer Account Agreement"}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-600">
                          Please review and accept all required agreements to continue.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-7 space-y-4">
                    {agreements.map((a) => (
                      <AgreementRow
                        key={a.id}
                        checked={checkedIds.includes(a.id)}
                        title={a.title}
                        details={a.details}
                        onToggle={() => toggleAgreement(a.id)}
                      />
                    ))}
                  </div>

                  <div className="mt-8">
                    <div className="flex items-center justify-between text-sm font-bold text-slate-600">
                      <div>
                        {completed} of {total} completed
                      </div>
                      <div className="text-indigo-700">{pct}%</div>
                    </div>
                    <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-indigo-600 to-purple-600"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-10 flex items-center justify-center gap-4">
                    <button
                      type="button"
                      onClick={goBack}
                      className="rounded-2xl border border-slate-200 bg-white px-12 py-4 text-base font-black text-slate-900 hover:bg-slate-50"
                    >
                      Back
                    </button>

                    <button
                      type="button"
                      disabled={completed !== total}
                      onClick={() => setStep(3)}
                      className={[
                        "rounded-2xl px-12 py-4 text-base font-black text-white shadow-sm",
                        completed === total ? "bg-gradient-to-r from-indigo-600 to-purple-600" : "bg-slate-300",
                      ].join(" ")}
                    >
                      Continue
                    </button>
                  </div>
                </>
              ) : null}

              {step === 3 ? (
                <>
                  <div className="text-sm font-bold text-slate-500">Step 3 of 3 — Account Details</div>

                  <div className="mt-4">
                    <div className="text-4xl font-black text-slate-900">Account Details</div>
                    <div className="mt-2 text-base font-semibold text-slate-600">{headerSub}</div>
                  </div>

                  {error ? (
                    <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-bold text-red-700">
                      {error}
                    </div>
                  ) : null}

                  <form onSubmit={handleCreateAccount} className="mt-10 space-y-6">
                    {role === "organizer" ? (
                      <div>
                        <label htmlFor="fullName" className="text-sm font-black text-slate-900">
                          Full Name
                        </label>
                        <input
                          id="fullName"
                          name="fullName"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Your full name"
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-400"
                        />
                      </div>
                    ) : null}

                    <div>
                      <label htmlFor="email" className="text-sm font-black text-slate-900">
                        Email
                      </label>
                      <input
                        id="email"
                        name="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        autoComplete="email"
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-400"
                      />
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                      <div>
                        <label htmlFor="password" className="text-sm font-black text-slate-900">
                          Password
                        </label>
                        <input
                          id="password"
                          name="password"
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Create a password"
                          autoComplete="new-password"
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-400"
                        />
                      </div>

                      <div>
                        <label htmlFor="confirmPassword" className="text-sm font-black text-slate-900">
                          Confirm Password
                        </label>
                        <input
                          id="confirmPassword"
                          name="confirmPassword"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Re-enter your password"
                          autoComplete="new-password"
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-400"
                        />
                      </div>
                    </div>

                    <div className="mt-10 flex items-center justify-center gap-4">
                      <button
                        type="button"
                        onClick={goBack}
                        className="rounded-2xl border border-slate-200 bg-white px-12 py-4 text-base font-black text-slate-900 hover:bg-slate-50"
                      >
                        Back
                      </button>

                      <button
                        type="submit"
                        disabled={loading}
                        className={[
                          "rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 px-14 py-4 text-base font-black text-white shadow-sm",
                          loading ? "opacity-70" : "",
                        ].join(" ")}
                      >
                        {loading ? "Creating..." : "Create Account"}
                      </button>
                    </div>

                    <div className="mt-5 text-center text-sm font-semibold text-slate-600">
                      Already have an account?{" "}
                      <Link to="/login" className="font-black text-indigo-700 hover:text-indigo-800">
                        Sign in
                      </Link>
                    </div>
                  </form>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
