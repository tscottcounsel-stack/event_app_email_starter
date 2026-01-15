// src/App.tsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import Layout from "./components/Layout";

// Public
import PublicEventsPage from "./pages/PublicEventsPage";
import RoleSelection from "./pages/RoleSelection";
import NotFound from "./pages/NotFound";

// Organizer
import OrganizerLoginPage from "./pages/OrganizerLoginPage";
import OrganizerDashboardPage from "./pages/OrganizerDashboardPage";
import OrganizerEventsPage from "./pages/OrganizerEventsPage";
import OrganizerCreateEventPage from "./pages/OrganizerCreateEventPage";
import OrganizerEventDetailPage from "./pages/OrganizerEventDetailPage";
import OrganizerEditEventPage from "./pages/OrganizerEditEventPage";
import OrganizerMapEditorPage from "./pages/OrganizerMapEditorPage";
import OrganizerApplicationsPage from "./pages/OrganizerApplicationsPage";
import OrganizerContactsPage from "./pages/OrganizerContactsPage";
import OrganizerProfilePage from "./pages/OrganizerProfilePage";
import OrganizerCampaignDetailPage from "./pages/OrganizerCampaignDetailPage";

// Vendor
import VendorDashboardPage from "./pages/VendorDashboardPage";
import VendorEventsPage from "./pages/VendorEventsPage";
import VendorApplicationsPage from "./pages/VendorApplicationsPage";
import VendorProfilePage from "./pages/VendorProfilePage";
import VendorDiagramPage from "./pages/VendorDiagramPage";

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="rounded-2xl border bg-white p-6">
      <div className="text-2xl font-semibold">{title}</div>
      <div className="mt-2 text-sm text-slate-600">This page isn’t built yet.</div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<Navigate to="/choose-role" replace />} />
      <Route path="/choose-role" element={<RoleSelection />} />
      <Route path="/public/events" element={<PublicEventsPage />} />

      {/* Organizer login outside shell */}
      <Route path="/organizer/login" element={<OrganizerLoginPage />} />

      {/* Main shell */}
      <Route element={<Layout />}>
        {/* Organizer */}
        <Route path="/organizer" element={<Navigate to="/organizer/dashboard" replace />} />
        <Route path="/organizer/dashboard" element={<OrganizerDashboardPage />} />
        <Route path="/organizer/events" element={<OrganizerEventsPage />} />
        <Route path="/organizer/events/new" element={<OrganizerCreateEventPage />} />

        <Route path="/organizer/events/:eventId" element={<OrganizerEventDetailPage />} />
        <Route path="/organizer/events/:eventId/edit" element={<OrganizerEditEventPage />} />
        <Route path="/organizer/events/:eventId/map" element={<OrganizerMapEditorPage />} />

        <Route path="/organizer/applications" element={<OrganizerApplicationsPage />} />
        <Route path="/organizer/contacts" element={<OrganizerContactsPage />} />
        <Route path="/organizer/profile" element={<OrganizerProfilePage />} />
        <Route path="/organizer/campaigns/:id" element={<OrganizerCampaignDetailPage />} />

        {/* placeholders */}
        <Route path="/organizer/messages" element={<PlaceholderPage title="Messaging" />} />
        <Route path="/organizer/billing" element={<PlaceholderPage title="Billing" />} />
        <Route path="/organizer/settings" element={<PlaceholderPage title="Settings" />} />

        {/* Vendor */}
        <Route path="/vendor" element={<Navigate to="/vendor/dashboard" replace />} />
        <Route path="/vendor/dashboard" element={<VendorDashboardPage />} />
        <Route path="/vendor/events" element={<VendorEventsPage />} />
        <Route path="/vendor/applications" element={<VendorApplicationsPage />} />
        <Route path="/vendor/profile" element={<VendorProfilePage />} />
        <Route path="/vendor/events/:eventId/diagram" element={<VendorDiagramPage />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
