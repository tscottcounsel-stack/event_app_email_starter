// src/pages/HomePage.tsx
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
            <div className="h-8 w-8 rounded-xl bg-indigo-600 flex items-center justify-center text-xs font-bold text-white">
              EV
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">
                Event Portal
              </div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                Organizers &amp; Vendors
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigate("/public/vendors")}
              className="hidden sm:inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Browse vendors
            </button>
            <button
              type="button"
              onClick={() => navigate("/public/organizers")}
              className="hidden sm:inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Browse organizers
            </button>
            <button
              type="button"
              onClick={() => navigate("/public/events")}
              className="hidden sm:inline-flex items-center rounded-xl border border-slate-200 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-50 hover:bg-slate-800"
            >
              View events
            </button>
          </div>
        </div>
      </header>

      {/* Hero + tabs */}
      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <section className="mb-8 grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-500">
                Booking • Booths • Layouts
              </p>
              <h1 className="mt-2 text-3xl font-bold text-slate-900">
                Connect organizers and vendors in one workspace.
              </h1>
              <p className="mt-3 text-sm text-slate-600">
                Organizers design their event layout, vendors pick their booths,
                and everyone tracks applications and approvals in one place.
              </p>

              {/* Tabs */}
              <div className="mt-6 flex gap-2 rounded-xl bg-slate-100 p-1 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setActiveTab("organizer")}
                  className={`flex-1 rounded-lg px-3 py-2 ${
                    activeTab === "organizer"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  I&apos;m an organizer
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("vendor")}
                  className={`flex-1 rounded-lg px-3 py-2 ${
                    activeTab === "vendor"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  I&apos;m a vendor
                </button>
              </div>

              {/* Tab content */}
              <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
                {activeTab === "organizer" ? (
                  <>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Build your event, then fill every booth.
                    </h2>
                    <p className="mt-1 text-xs text-slate-600">
                      Create your organizer profile, design your event layout,
                      manage vendor applications, and now store your key
                      contacts—all from one dashboard.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => navigate("/organizer/login")}
                        className="inline-flex items-center rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                      >
                        Organizer login
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate("/organizer/profile")}
                        className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                      >
                        Create / update organizer profile
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate("/organizer/vendors")}
                        className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                      >
                        Browse vendors (organizer view)
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate("/organizer/contacts")}
                        className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                      >
                        Organizer contacts
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Tell your story, then pick your perfect spot.
                    </h2>
                    <p className="mt-1 text-xs text-slate-600">
                      Create your vendor profile once, then apply to events and
                      claim booths as organizers open their layouts.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => navigate("/vendor/login")}
                        className="inline-flex items-center rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                      >
                        Vendor login
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate("/vendor/profile")}
                        className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                      >
                        Create / update vendor profile
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate("/public/events")}
                        className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                      >
                        View upcoming events
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Side card: Public discovery */}
            <aside className="rounded-2xl bg-slate-900 p-5 text-sm text-slate-100 shadow-sm">
              <h2 className="text-sm font-semibold text-white">
                Public discovery built in.
              </h2>
              <p className="mt-2 text-xs text-slate-300">
                Vendors and guests can browse organizers, vendors, and public
                event previews:
              </p>
              <ul className="mt-3 space-y-1.5 text-xs text-slate-200">
                <li>• Public vendor directory with stories &amp; tags</li>
                <li>• Public organizer directory for event hosts</li>
                <li>• Event previews page for markets &amp; shows</li>
              </ul>
              <div className="mt-4 grid gap-2">
                <button
                  type="button"
                  onClick={() => navigate("/public/vendors")}
                  className="inline-flex items-center justify-center rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-50 hover:bg-slate-700"
                >
                  Browse featured vendors
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/public/organizers")}
                  className="inline-flex items-center justify-center rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-50 hover:bg-slate-700"
                >
                  Browse organizers
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/public/events")}
                  className="inline-flex items-center justify-center rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800"
                >
                  View events (preview)
                </button>
              </div>
            </aside>
          </section>

          {/* How it works */}
          <section className="mt-4 grid gap-4 md:grid-cols-3 text-xs text-slate-700">
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">
                1. Profiles
              </h3>
              <p className="mt-2">
                Organizers and vendors each create a story-driven profile with
                tags, categories, and contact info.
              </p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">
                2. Events &amp; layouts
              </h3>
              <p className="mt-2">
                Organizers design their grids, price booths, and manage
                applications on top of the event diagram.
              </p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">
                3. Discovery &amp; outreach
              </h3>
              <p className="mt-2">
                Public directories, event previews, and your own contact list
                help you fill every booth with the right vendors.
              </p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default HomePage;
