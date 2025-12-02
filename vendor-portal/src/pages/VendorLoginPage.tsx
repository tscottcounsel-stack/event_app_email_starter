// vendor-portal/src/pages/VendorLoginPage.tsx
import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const VendorLoginPage: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    console.log("[VendorLoginPage] MOUNTED on /vendor/login");
  }, []);

  function handleFakeLogin() {
    console.log("[VendorLoginPage] CLICK -> navigate('/vendor/events')");
    navigate("/vendor/events");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-yellow-100">
      <div className="max-w-md w-full bg-white shadow-lg rounded-2xl p-8 border-4 border-yellow-400">
        <h1 className="text-2xl font-extrabold mb-4 text-yellow-700">
          VENDOR LOGIN – DEBUG
        </h1>
        <p className="text-sm text-slate-600 mb-6">
          You are on <code>/vendor/login</code>. Clicking the button below will
          call <code>navigate('/vendor/events')</code>.
        </p>

        <button
          type="button"
          onClick={handleFakeLogin}
          className="w-full rounded-full px-4 py-2 text-sm font-medium bg-yellow-500 text-white hover:bg-yellow-600"
        >
          Login as vendor (go to /vendor/events)
        </button>
      </div>
    </div>
  );
};

export default VendorLoginPage;
