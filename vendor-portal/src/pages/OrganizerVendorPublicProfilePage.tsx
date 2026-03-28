import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "https://event-app-api-production-ccce.up.railway.app";

function fixImageUrl(url: string) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("/uploads")) {
    return `${API_BASE}${url}`;
  }
  return url;
}

export default function OrganizerVendorPublicProfilePage() {
  const { vendorId } = useParams();

  const [resolvedVendorId, setResolvedVendorId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function resolveVendor() {
      try {
        // 🔥 STEP 1: Try direct (email or id)
        let res = await fetch(`${API_BASE}/vendors/public/${vendorId}`);

        if (res.ok) {
          const data = await res.json();
          setResolvedVendorId(data.vendor_id);
          return;
        }

        // 🔥 STEP 2: fallback (if numeric id like 18)
        // try to find vendor by scanning applications
        const appsRes = await fetch(`${API_BASE}/applications`);
        if (!appsRes.ok) return;

        const apps = await appsRes.json();

        const match = apps.find(
          (a: any) => String(a.vendor_id) === String(vendorId)
        );

        if (match?.vendor_email) {
          setResolvedVendorId(match.vendor_email);
        }
      } catch (err) {
        console.error("Vendor resolve failed", err);
      } finally {
        setLoading(false);
      }
    }

    resolveVendor();
  }, [vendorId]);

  if (loading) {
    return <div className="p-6">Loading vendor...</div>;
  }

  if (!resolvedVendorId) {
    return (
      <div className="p-6 text-red-600">
        Could not resolve vendor profile.
      </div>
    );
  }

  return (
    <iframe
      src={`/vendors/${encodeURIComponent(resolvedVendorId)}`}
      className="w-full h-screen border-0"
    />
  );
}