import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function VendorPaymentSuccessPage() {
  const navigate = useNavigate();

  useEffect(() => {
    // Give user a second to see confirmation
    const timer = setTimeout(() => {
      const token = localStorage.getItem("accessToken");

      if (!token) {
        navigate("/login?returnTo=/vendor/dashboard");
        return;
      }

      navigate("/vendor/dashboard");
    }, 2000);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <h1>✅ Payment Successful</h1>
      <p>Your booth has been confirmed.</p>
      <p>Redirecting you back to your dashboard...</p>
    </div>
  );
}