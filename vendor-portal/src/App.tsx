import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

/* ---------------- PUBLIC ---------------- */

import PublicHomePage from "./pages/PublicHomePage";
import PublicEventsPage from "./pages/PublicEventsPage";
import PublicVendorsPage from "./pages/PublicVendorsPage";
import PublicPricingPage from "./pages/PublicPricingPage";
import PublicLoginPage from "./pages/PublicLoginPage";
import PublicFindVenuesPage from "./pages/PublicFindVenuesPage";
import PublicForgotPasswordPage from "./pages/PublicForgotPasswordPage";
import PublicGetStartedPage from "./pages/PublicGetStartedPage";
import CreateAccountPage from "./pages/CreateAccountPage";

/* ---------------- AUTH ---------------- */

import RequireAuth from "./components/auth/RequireAuth";

/* ---------------- ORGANIZER ---------------- */

import OrganizerLayout from "./pages/OrganizerLayout";
import OrganizerDashboard from "./pages/OrganizerDashboard";
import OrganizerEventsPage from "./pages/OrganizerEventsPage";
import OrganizerCreateEventPage from "./pages/OrganizerCreateEventPage";
import OrganizerEventRequirementsPage from "./pages/OrganizerEventRequirementsPage";
import OrganizerEventReviewPage from "./pages/OrganizerEventReviewPage";
import OrganizerApplicationsPage from "./pages/OrganizerApplicationsPage";
import OrganizerVendorPreviewPage from "./pages/OrganizerVendorPreviewPage";
import OrganizerEventDetailsPage from "./pages/OrganizerEventDetailsPage";
import OrganizerContactsPage from "./pages/OrganizerContactsPage";
import MapEditorPage from "./pages/MapEditorPage";

/* ---------------- VENDOR ---------------- */

import VendorLayout from "./pages/VendorLayout";
import VendorDashboard from "./pages/VendorDashboard";
import VendorAvailableEventsPage from "./pages/VendorAvailableEventsPage";
import VendorApplicationsPage from "./pages/VendorApplicationsPage";
import VendorGetVerifiedPage from "./pages/VendorGetVerifiedPage";
import VendorBusinessProfileSetupPage from "./pages/VendorBusinessProfileSetupPage";
import VendorPublicProfilePage from "./pages/VendorPublicProfilePage";
import VendorMessagesPage from "./pages/VendorMessagesPage";
import VendorSettingsPage from "./pages/VendorSettingsPage";
import VendorEventDetailsPage from "./pages/VendorEventDetailsPage";
import VendorEventRequirementsPage from "./pages/VendorEventRequirementsPage";
import VendorEventMapLayoutPage from "./pages/VendorEventMapLayoutPage";
import VendorEventApplyPage from "./pages/VendorEventApplyPage";

export default function App() {
  return (
    <Routes>
      {/* ---------- PUBLIC ---------- */}
      <Route path="/" element={<PublicHomePage />} />
      <Route path="/events" element={<PublicEventsPage />} />
      <Route path="/vendors" element={<PublicVendorsPage />} />
      <Route path="/pricing" element={<PublicPricingPage />} />
      <Route path="/login" element={<PublicLoginPage />} />
      <Route path="/forgot-password" element={<PublicForgotPasswordPage />} />

      {/* Figma flow */}
      <Route path="/get-started" element={<PublicGetStartedPage />} />
      <Route path="/create-account" element={<CreateAccountPage />} />

      <Route path="/venues" element={<PublicFindVenuesPage />} />

      {/* ---------- ORGANIZER PROTECTED ---------- */}
      <Route element={<RequireAuth allow={["organizer", "admin"]} />}>
        <Route path="/organizer" element={<OrganizerLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />

          <Route path="dashboard" element={<OrganizerDashboard />} />
          <Route path="events" element={<OrganizerEventsPage />} />
          <Route path="events/create" element={<OrganizerCreateEventPage />} />

          {/* ✅ DETAILS ROUTE (this is what Open should target) */}
          <Route
            path="events/:eventId/details"
            element={<OrganizerEventDetailsPage />}
          />

          <Route
            path="events/:eventId/requirements"
            element={<OrganizerEventRequirementsPage />}
          />
          <Route path="events/:eventId/review" element={<OrganizerEventReviewPage />} />
          <Route path="events/:eventId/layout" element={<MapEditorPage />} />
          <Route
            path="events/:eventId/applications"
            element={<OrganizerApplicationsPage />}
          />
          <Route
            path="vendor-preview/:applicationId"
            element={<OrganizerVendorPreviewPage />}
          />
          <Route path="contacts" element={<OrganizerContactsPage />} />
        </Route>
      </Route>

      {/* ---------- VENDOR PROTECTED ---------- */}
      <Route element={<RequireAuth allow={["vendor", "admin"]} />}>
        <Route path="/vendor" element={<VendorLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />

          <Route path="dashboard" element={<VendorDashboard />} />
          <Route path="events" element={<VendorAvailableEventsPage />} />
          <Route path="events/:eventId" element={<VendorEventDetailsPage />} />
          <Route
            path="events/:eventId/requirements"
            element={<VendorEventRequirementsPage />}
          />
          <Route path="events/:eventId/map" element={<VendorEventMapLayoutPage />} />
          <Route path="events/:eventId/apply" element={<VendorEventApplyPage />} />

          <Route path="applications" element={<VendorApplicationsPage />} />
          <Route path="verify" element={<VendorGetVerifiedPage />} />
          <Route path="profile/setup" element={<VendorBusinessProfileSetupPage />} />
          <Route path="profile/public" element={<VendorPublicProfilePage />} />
          <Route path="messages" element={<VendorMessagesPage />} />
          <Route path="settings" element={<VendorSettingsPage />} />
        </Route>
      </Route>

      {/* ---------- FALLBACK ---------- */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
