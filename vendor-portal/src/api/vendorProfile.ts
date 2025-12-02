// src/api/vendorProfile.ts
import { apiGet } from "../api";

export type VendorProfile = {
  id: number;
  business_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  // add any other fields you’ve defined on the backend
};

export async function getVendorProfile(): Promise<VendorProfile> {
  return apiGet<VendorProfile>("/vendor/profile");
}
