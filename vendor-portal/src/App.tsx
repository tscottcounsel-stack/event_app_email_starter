// vendor-portal/src/App.tsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import ComingSoon from "./pages/ComingSoon";

import Layout from "./components/Layout";

// Public
import PublicEventsPage from "./pages/PublicEventsPage";
import RoleSelection from "./pages/RoleSelection";

// Organizer
import OrganizerLoginPage from "./pages/OrganizerLoginPage";
import OrganizerDashboardPage from "./pages/OrganizerDashboardPage";
import OrganizerEventsPage from "./pages/OrganizerEventsPage";
import OrganizerMapEditorPage from "./pages/OrganizerMapEditorPage";
import OrganizerContactsPage from "./pages/OrganizerContactsPage";
import OrganizerApplicationsPage from "./pages/OrganizerApplicationsPage";
import OrganizerProfilePage from "./pages/OrganizerProfilePage";
import OrganizerCampaignDetailPage from "./pages/OrganizerCampaignDetailPage"; // ✅ NEW

// Vendor
import VendorLogin from "./pages/VendorLogin";
import VendorDashboardPage from "./pages/VendorDashboardPage";
import VendorEventsPage from "./pages/VendorEventsPage";
import VendorApplicationsPage from "./pages/VendorApplicationsPage";
import VendorProfilePage from "./pages/VendorProfilePage";
import VendorDiagramPage from "./pages/VendorDiagramPage";

import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<PublicEventsPage />} />
      <Route path="/roles" element={<RoleSelection />} />

      {/* Auth */}
      <Route path="/organizer/login" element={<OrganizerLoginPage />} />
      <Route path="/vendor/login" element={<VendorLogin />} />

      {/* Unified shell */}
      <Route element={<Layout />}>
        {/* Organizer */}
        <Route path="/organizer" element={<Navigate to="/organizer/dashboard" replace />} />
        <Route path="/organizer/dashboard" element={<OrganizerDashboardPage />} />
        <Route path="/organizer/events" element={<OrganizerEventsPage />} />
        <Route path="/organizer/events/:eventId/map" element={<OrganizerMapEditorPage />} />
        <Route path="/organizer/contacts" element={<OrganizerContactsPage />} />
        <Route path="/organizer/applications" element={<OrganizerApplicationsPage />} />
        <Route path="/organizer/profile" element={<OrganizerProfilePage />} />

        {/* ✅ Campaign detail page */}
        <Route path="/organizer/campaigns/:id" element={<OrganizerCampaignDetailPage />} />

        {/* Keep this as-is for now */}
        <Route path="/organizer/messages" element={<ComingSoon title="Messaging" />} />
        <Route path="/organizer/billing" element={<ComingSoon title="Billing" />} />
        <Route path="/organizer/settings" element={<ComingSoon title="Settings" />} />

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
