// vendor-portal/src/App.tsx
import React from "react";
import { Routes, Route } from "react-router-dom";

import HomePage from "./pages/HomePage";
import OrganizerLoginPage from "./pages/OrganizerLoginPage";
import VendorLoginPage from "./pages/VendorLoginPage";
import OrganizerEventsPage from "./pages/OrganizerEventsPage";
import VendorEventsPage from "./pages/VendorEventsPage";
import VendorDiagramPage from "./pages/VendorDiagramPage";
import OrganizerDiagramEditorPage from "./pages/OrganizerDiagramEditorPage";

const App: React.FC = () => {
  return (
    <Routes>
      {/* Landing */}
      <Route path="/" element={<HomePage />} />

      {/* Logins */}
      <Route path="/organizer/login" element={<OrganizerLoginPage />} />
      <Route path="/vendor/login" element={<VendorLoginPage />} />

      {/* Organizer side */}
      <Route path="/organizer/events" element={<OrganizerEventsPage />} />
      <Route
        path="/organizer/events/:eventId/diagram/edit"
        element={<OrganizerDiagramEditorPage />}
      />

      {/* Vendor side */}
      <Route path="/vendor/events" element={<VendorEventsPage />} />
      <Route
        path="/vendor/events/:eventId/diagram"
        element={<VendorDiagramPage />}
      />
    </Routes>
  );
};

export default App;
