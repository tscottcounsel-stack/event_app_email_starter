// src/App.tsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import BoothMapEditor from "./figma/pages/BoothMapEditor";
import AdminDashboardPage from "./pages/AdminDashboardPage";
import AdminEventsPage from "./pages/AdminEventsPage";
import OrganizerEventDashboardPage from "./pages/OrganizerEventDashboardPage";
import VendorEventMapLayoutPage from "./pages/VendorEventMapLayoutPage";
import AdminVerificationsPage from "./pages/AdminVerificationsPage";

/* ---------------- PUBLIC ---------------- */

import PublicHomePage from "./pages/PublicHomePage";
import PublicVendorsPage from "./pages/PublicVendorsPage";
import PublicPricingPage from "./pages/PublicPricingPage";
import PublicLoginPage from "./pages/PublicLoginPage";
import PublicFindVenuesPage from "./pages/PublicFindVenuesPage";
import PublicForgotPasswordPage from "./pages/PublicForgotPasswordPage";
import PublicGetStartedPage from "./pages/PublicGetStartedPage";
import CreateAccountPage from "./pages/CreateAccountPage";
import PublicEventsListPage from "./pages/PublicEventsListPage";
import PublicEventDetailPage from "./pages/PublicEventDetailPage";
import AdminPaymentsPage from "./pages/AdminPaymentsPage";


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
import OrganizerApplicationViewPage from "./pages/OrganizerApplicationViewPage";
import OrganizerVendorPreviewPage from "./pages/OrganizerVendorPreviewPage";
import OrganizerEventDetailsPage from "./pages/OrganizerEventDetailsPage";
import OrganizerContactsPage from "./pages/OrganizerContactsPage";
import MapEditorPage from "./pages/MapEditorPage";
import OrganizerProfilePage from "./pages/OrganizerProfilePage";
import OrganizerMessagesPage from "./pages/OrganizerMessagesPage";
import OrganizerGetVerifiedPage from "./pages/OrganizerGetVerifiedPage";
import OrganizerPublicProfilePage from "./pages/OrganizerPublicProfilePage";
import PublicOrganizersPage from "./pages/PublicOrganizersPage";

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
import VendorEventApplyPage from "./pages/VendorEventApplyPage";
import VendorInviteApplyPage from "./pages/VendorInviteApplyPage";
import VendorApplicationDetailPage from "./pages/VendorApplicationDetailPage";

/* ---------------- ADMIN ROLE HELPERS ---------------- */

function getUserRole(): string | null {
  try {
    const token = localStorage.getItem("accessToken");
    if (!token) return null;

    if (token.startsWith("devtoken:")) {
      const parts = token.split(":");
      return parts[2] || null;
    }

    const payloadPart = token.split(".")[1];
    if (!payloadPart) return null;

    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    );

    const payload = JSON.parse(atob(padded));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const role = getUserRole();

  if (!role) {
    return <Navigate to="/login" replace />;
  }

  if (role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function PaymentSuccessStandalone() {
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const appId = params.get("appId") || params.get("app_id") || "";
    const sessionId = params.get("session_id") || "";

    const redirectToVendorApplications = () => {
      const next = new URL(window.location.origin + "/vendor/applications");
      next.searchParams.set("payment", "success");
      if (appId) next.searchParams.set("appId", appId);
      if (sessionId) next.searchParams.set("session_id", sessionId);
      window.location.replace(`${next.pathname}${next.search}`);
    };

    const timer = window.setTimeout(() => {
      try {
        const token =
          localStorage.getItem("accessToken") ||
          localStorage.getItem("token") ||
          sessionStorage.getItem("accessToken") ||
          sessionStorage.getItem("token");

        if (!token) {
          window.setTimeout(() => {
            const retryToken =
              localStorage.getItem("accessToken") ||
              localStorage.getItem("token") ||
              sessionStorage.getItem("accessToken") ||
              sessionStorage.getItem("token");

            if (!retryToken) {
              const loginUrl = new URL(window.location.origin + "/login");
              const returnTo = new URL(window.location.origin + "/vendor/applications");
              returnTo.searchParams.set("payment", "success");
              if (appId) returnTo.searchParams.set("appId", appId);
              if (sessionId) returnTo.searchParams.set("session_id", sessionId);
              loginUrl.searchParams.set("returnTo", `${returnTo.pathname}${returnTo.search}`);
              window.location.replace(`${loginUrl.pathname}${loginUrl.search}`);
              return;
            }

            redirectToVendorApplications();
          }, 800);
          return;
        }

        redirectToVendorApplications();
      } catch {
        redirectToVendorApplications();
      }
    }, 1500);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fafc",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          background: "#ffffff",
          border: "1px solid rgba(15,23,42,0.08)",
          borderRadius: 24,
          boxShadow: "0 12px 30px rgba(2,6,23,0.08)",
          padding: 32,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 44, marginBottom: 12 }}>✅</div>
        <h1
          style={{
            margin: 0,
            fontSize: 32,
            fontWeight: 800,
            color: "#0f172a",
          }}
        >
          Payment Successful
        </h1>
        <p
          style={{
            marginTop: 12,
            fontSize: 16,
            color: "#475569",
          }}
        >
          Your booth has been secured.
          <br />
          Redirecting you now…
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      {/* ---------- PUBLIC ---------- */}
      <Route path="/" element={<PublicHomePage />} />
      <Route path="/events" element={<PublicEventsListPage />} />
      <Route path="/events/:eventId" element={<PublicEventDetailPage />} />
      <Route path="/vendors" element={<PublicVendorsPage />} />
      <Route path="/vendors/:vendorId" element={<VendorPublicProfilePage />} />
      <Route path="/organizers" element={<PublicOrganizersPage />} />
      <Route path="/organizers/:email" element={<OrganizerPublicProfilePage />} />
      <Route path="/pricing" element={<PublicPricingPage />} />
      <Route path="/login" element={<PublicLoginPage />} />
      <Route path="/forgot-password" element={<PublicForgotPasswordPage />} />
      <Route path="/forgot" element={<Navigate to="/forgot-password" replace />} />
      <Route path="/forgotpassword" element={<Navigate to="/forgot-password" replace />} />
      <Route path="/reset-password" element={<Navigate to="/forgot-password" replace />} />
      <Route path="/get-started" element={<PublicGetStartedPage />} />
      <Route path="/create-account" element={<CreateAccountPage />} />
      <Route path="/venues" element={<PublicFindVenuesPage />} />
      <Route path="/apply/invite/:inviteId" element={<VendorInviteApplyPage />} />

      {/* ---------- ADMIN ---------- */}
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminDashboardPage />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/events"
        element={
          <AdminRoute>
            <AdminEventsPage />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/payments"
        element={
          <AdminRoute>
            <AdminPaymentsPage />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/verifications"
        element={
          <AdminRoute>
            <AdminVerificationsPage />
          </AdminRoute>
        }
      />

      {/* ---------- ORGANIZER EVENT DIRECT ---------- */}
      <Route
        path="/organizer/events/:eventId/dashboard"
        element={<OrganizerEventDashboardPage />}
      />

      {/* ---------- ORGANIZER PROTECTED ---------- */}
      <Route element={<RequireAuth allow={["organizer", "admin"]} />}>
        <Route path="/organizer" element={<OrganizerLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<OrganizerDashboard />} />
          <Route path="events" element={<OrganizerEventsPage />} />
          <Route path="events/create" element={<OrganizerCreateEventPage />} />
          <Route path="profile" element={<OrganizerProfilePage />} />
          <Route path="verify" element={<OrganizerGetVerifiedPage />} />
          <Route path="messages" element={<OrganizerMessagesPage />} />
          <Route path="events/:eventId/messages" element={<OrganizerMessagesPage />} />
          <Route path="events/:eventId/details" element={<OrganizerEventDetailsPage />} />
         <Route path="events/:eventId/map" element={<BoothMapEditor />} />
 
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
            path="events/:eventId/application/:applicationId"
            element={<OrganizerApplicationViewPage />}
          />
          <Route
            path="events/:eventId/applications/:appId"
            element={<OrganizerApplicationViewPage />}
          />
          <Route
            path="vendor-preview/:applicationId"
            element={<OrganizerVendorPreviewPage />}
          />
          <Route path="contacts" element={<OrganizerContactsPage />} />
        </Route>
      </Route>

      {/* ---------- VENDOR PUBLIC (payment return) ---------- */}
      <Route path="/vendor/payment-success" element={<PaymentSuccessStandalone />} />

      {/* ---------- VENDOR PROTECTED ---------- */}
      <Route element={<RequireAuth allow={["vendor", "admin"]} />}>
        <Route path="/vendor" element={<VendorLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<VendorDashboard />} />
          <Route path="events" element={<VendorAvailableEventsPage />} />
          <Route path="payment-cancel" element={<Navigate to="/vendor/applications" replace />} />
          <Route path="events/:eventId" element={<VendorEventDetailsPage />} />
          <Route
            path="events/:eventId/requirements"
            element={<VendorEventRequirementsPage />}
          />
<Route path="events/:eventId/map" element={<VendorEventMapLayoutPage />} /><Route path="events/:eventId/apply" element={<VendorEventApplyPage />} />
          <Route
            path="events/:eventId/application/:appId"
            element={<VendorApplicationDetailPage />}
          />
          <Route path="applications" element={<VendorApplicationsPage />} />
          <Route path="verify" element={<VendorGetVerifiedPage />} />
          <Route
            path="profile/setup"
            element={<VendorBusinessProfileSetupPage />}
          />
          <Route path="profile" element={<VendorPublicProfilePage />} />
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
