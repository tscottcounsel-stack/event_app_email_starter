// src/pages/VendorPaymentSuccessPage.tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function VendorPaymentSuccessPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const token = localStorage.getItem("accessToken");

        if (!token) {
          navigate("/login?returnTo=/vendor/dashboard", { replace: true });
          return;
        }

        navigate("/vendor/dashboard?payment=success", { replace: true });
      } catch (err) {
        console.error("Payment success redirect error:", err);
        navigate("/vendor/dashboard", { replace: true });
      }
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [navigate]);

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