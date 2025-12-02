// vendor-portal/src/pages/HomePage.tsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"organizer" | "vendor">(
    "organizer"
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top nav */}
      <header className="w-full border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-sm">
              EP
            </div>
            <span className="font-semibold text-slate-900">Event Portal</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/organizer/login")}
              className="px-4 py-1.5 rounded-full border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Organizer login
            </button>
            <button
              onClick={() => navigate("/vendor/login")}
              className="px-4 py-1.5 rounded-full bg-emerald-600 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Vendor login
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-4 py-10">
          <div className="mb-6 flex gap-3">
            <button
              type="button"
              onClick={() => setActiveTab("organizer")}
              className={`px-5 py-2 rounded-full text-sm font-medium border ${
                activeTab === "organizer"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-300"
              }`}
            >
              Organizer dashboard
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("vendor")}
              className={`px-5 py-2 rounded-full text-sm font-medium border ${
                activeTab === "vendor"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-300"
              }`}
            >
              Vendor dashboard
            </button>
          </div>

          <h1 className="text-3xl md:text-4xl font-semibold text-slate-900 mb-4 max-w-3xl">
            Connect events and vendors in one simple workspace.
          </h1>

          <p className="text-slate-600 text-base max-w-2xl mb-8">
            Organizers can design booth maps, manage applications, and track
            payments. Vendors get a clean dashboard to discover events, apply
            for booths, and see their status in real time.
          </p>

          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 max-w-3xl">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">
              How it works
            </h2>

            <div className="space-y-3 text-sm text-slate-700">
              <p>
                <span className="font-semibold">Organizers</span> create
                events, draw booth maps, and set pricing.
              </p>
              <p>
                <span className="font-semibold">Vendors</span> build a profile
                and apply directly to booths that fit their business.
              </p>
              <p>
                Approvals and payments are tracked in one place, with clear
                status colors on the diagram for both sides.
              </p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default HomePage;
