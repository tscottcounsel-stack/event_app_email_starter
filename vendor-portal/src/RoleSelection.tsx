import { useNavigate } from "react-router-dom";

export default function RoleSelection() {
  const nav = useNavigate();

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/5 p-8 shadow-xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Welcome</h1>
          <p className="text-white/70 mt-2">
            Choose how you want to use VendorConnect today.
          </p>
        </div>

        <div className="grid gap-4">
          <button
            className="w-full rounded-xl bg-indigo-500 hover:bg-indigo-400 transition px-5 py-4 font-semibold"
            onClick={() => nav("/organizer/login")}
          >
            Continue as Organizer
          </button>

          <button
            className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 transition px-5 py-4 font-semibold"
            onClick={() => nav("/vendor/login")}
          >
            Continue as Vendor
          </button>
        </div>

        <div className="mt-6 text-sm text-white/60">
          Tip: You can switch roles anytime by signing out.
        </div>
      </div>
    </div>
  );
}
