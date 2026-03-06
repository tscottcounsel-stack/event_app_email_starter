// src/pages/OrganizerProfilePage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Contact as ContactIcon,
  MapPin,
  BadgeCheck,
  CalendarDays,
  CreditCard,
  User as UserIcon,
} from "lucide-react";

type Industry =
  | "Technology"
  | "Food & Beverage"
  | "Arts & Culture"
  | "Sports & Recreation"
  | "Business & Trade Shows"
  | "Education & Training"
  | "Health & Wellness"
  | "Entertainment"
  | "Fashion & Beauty"
  | "Automotive";

type OrganizerProfileDraft = {
  organizationName: string;
  organizationType: "Company" | "Nonprofit" | "Individual" | "Other";
  organizationDescription: string;
  yearsOperating: string;
  website: string;

  primaryContactName: string;
  businessEmail: string;
  phoneNumber: string;
  alternatePhoneNumber: string;

  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;

  businessLicenseNumber: string;
  taxIdEin: string;
  hasLiabilityInsurance: boolean;

  eventsHostedPerYear: string;
  typicalEventSize: "Select size range" | "Under 500" | "500–1,000" | "1,000–5,000" | "5,000+";
  industries: Industry[];

  accountHolderName: string;
  routingNumber: string;
  accountNumber: string;
};

const LS_KEY = "vc.organizerProfileDraft.v1";

const INDUSTRIES: Industry[] = [
  "Technology",
  "Food & Beverage",
  "Arts & Culture",
  "Sports & Recreation",
  "Business & Trade Shows",
  "Education & Training",
  "Health & Wellness",
  "Entertainment",
  "Fashion & Beauty",
  "Automotive",
];

function cx(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

function SectionCard(props: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-5">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-700">
          {props.icon}
        </div>
        <div className="text-lg font-extrabold text-slate-900">{props.title}</div>
      </div>
      <div className="px-6 py-6">{props.children}</div>
    </section>
  );
}

function Field(props: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-bold text-slate-800">
        {props.label} {props.required ? <span className="text-red-500">*</span> : null}
      </div>
      {props.children}
      {props.hint ? <div className="text-xs text-slate-500">{props.hint}</div> : null}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm",
        "placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100",
        props.className
      )}
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cx(
        "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm",
        "placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100",
        props.className
      )}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx(
        "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm",
        "focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100",
        props.className
      )}
    />
  );
}

export default function OrganizerProfilePage() {
  const navigate = useNavigate();

  const initial: OrganizerProfileDraft = useMemo(
    () => ({
      organizationName: "",
      organizationType: "Company",
      organizationDescription: "",
      yearsOperating: "",
      website: "",

      primaryContactName: "",
      businessEmail: "",
      phoneNumber: "",
      alternatePhoneNumber: "",

      streetAddress: "",
      city: "",
      state: "",
      zipCode: "",
      country: "United States",

      businessLicenseNumber: "",
      taxIdEin: "",
      hasLiabilityInsurance: false,

      eventsHostedPerYear: "",
      typicalEventSize: "Select size range",
      industries: [],

      accountHolderName: "",
      routingNumber: "",
      accountNumber: "",
    }),
    []
  );

  const [draft, setDraft] = useState<OrganizerProfileDraft>(initial);
  const [savedToast, setSavedToast] = useState<string>("");

  // Load from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setDraft((prev) => ({ ...prev, ...parsed }));
    } catch {
      // ignore
    }
  }, []);

  // Auto-save to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(draft));
    } catch {
      // ignore
    }
  }, [draft]);

  function update<K extends keyof OrganizerProfileDraft>(key: K, value: OrganizerProfileDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toggleIndustry(ind: Industry) {
    setDraft((d) => {
      const exists = d.industries.includes(ind);
      return {
        ...d,
        industries: exists ? d.industries.filter((x) => x !== ind) : [...d.industries, ind],
      };
    });
  }

  function validateBasic() {
    // Keep light validation for MVP
    const requiredMissing =
      !draft.organizationName.trim() ||
      !draft.organizationDescription.trim() ||
      !draft.primaryContactName.trim() ||
      !draft.businessEmail.trim() ||
      !draft.phoneNumber.trim() ||
      !draft.streetAddress.trim() ||
      !draft.city.trim() ||
      !draft.state.trim() ||
      !draft.zipCode.trim();
    return !requiredMissing;
  }

  function onComplete() {
    if (!validateBasic()) {
      setSavedToast("Please fill all required fields (*) before completing setup.");
      window.setTimeout(() => setSavedToast(""), 2500);
      return;
    }

    // MVP: just persist + show success, later wire to API
    setSavedToast("Organizer profile saved!");
    window.setTimeout(() => setSavedToast(""), 2000);

    // You can change this target later (dashboard, events, etc.)
    navigate("/organizer/dashboard");
  }

  return (
    <div className="min-h-0">
      {/* Top bar like screenshot: Back + centered title */}
      <div className="sticky top-0 z-10 bg-slate-50/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          <div className="text-center">
            <div className="text-xl font-extrabold text-slate-900">Organizer Profile Setup</div>
          </div>

          <div className="w-[84px]" />
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 pb-16">
        {/* Hero */}
        <div className="mt-6 rounded-3xl bg-gradient-to-b from-slate-50 to-indigo-50 px-6 py-10 text-center shadow-sm">
          <div className="mx-auto inline-flex items-center gap-3 rounded-full bg-white px-6 py-3 shadow-sm">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-indigo-50 text-indigo-700">
              <UserIcon className="h-5 w-5" />
            </div>
            <div className="text-sm font-extrabold">Complete Your Organizer Profile</div>
          </div>

          <div className="mx-auto mt-4 max-w-2xl text-sm font-semibold text-slate-600">
            Provide your organization details to start hosting events on VendorConnect
          </div>
        </div>

        {savedToast ? (
          <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-800">
            {savedToast}
          </div>
        ) : null}

        {/* Sections */}
        <div className="mt-8 space-y-6">
          {/* Organization Details */}
          <SectionCard icon={<Building2 className="h-5 w-5" />} title="Organization Details">
            <div className="grid grid-cols-1 gap-5">
              <Field label="Organization Name" required>
                <Input
                  value={draft.organizationName}
                  onChange={(e) => update("organizationName", e.target.value)}
                  placeholder="ABC Events Company"
                />
              </Field>

              <Field label="Organization Type" required>
                <Select
                  value={draft.organizationType}
                  onChange={(e) => update("organizationType", e.target.value as any)}
                >
                  <option value="Company">Company</option>
                  <option value="Nonprofit">Nonprofit</option>
                  <option value="Individual">Individual</option>
                  <option value="Other">Other</option>
                </Select>
              </Field>

              <Field label="Organization Description" required>
                <Textarea
                  rows={4}
                  value={draft.organizationDescription}
                  onChange={(e) => update("organizationDescription", e.target.value)}
                  placeholder="Tell vendors about your organization, event hosting experience, and what makes your events special..."
                />
              </Field>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field label="Years Operating">
                  <Input
                    value={draft.yearsOperating}
                    onChange={(e) => update("yearsOperating", e.target.value)}
                    placeholder="5"
                  />
                </Field>
                <Field label="Website">
                  <Input
                    value={draft.website}
                    onChange={(e) => update("website", e.target.value)}
                    placeholder="https://www.yourcompany.com"
                  />
                </Field>
              </div>
            </div>
          </SectionCard>

          {/* Contact Info */}
          <SectionCard icon={<ContactIcon className="h-5 w-5" />} title="Contact Information">
            <div className="grid grid-cols-1 gap-5">
              <Field label="Primary Contact Name" required>
                <Input
                  value={draft.primaryContactName}
                  onChange={(e) => update("primaryContactName", e.target.value)}
                  placeholder="John Smith"
                />
              </Field>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field label="Business Email" required>
                  <Input
                    value={draft.businessEmail}
                    onChange={(e) => update("businessEmail", e.target.value)}
                    placeholder="contact@company.com"
                  />
                </Field>

                <Field label="Phone Number" required>
                  <Input
                    value={draft.phoneNumber}
                    onChange={(e) => update("phoneNumber", e.target.value)}
                    placeholder="(555) 123-4567"
                  />
                </Field>
              </div>

              <Field label="Alternate Phone Number">
                <Input
                  value={draft.alternatePhoneNumber}
                  onChange={(e) => update("alternatePhoneNumber", e.target.value)}
                  placeholder="(555) 987-6543"
                />
              </Field>
            </div>
          </SectionCard>

          {/* Business Address */}
          <SectionCard icon={<MapPin className="h-5 w-5" />} title="Business Address">
            <div className="grid grid-cols-1 gap-5">
              <Field label="Street Address" required>
                <Input
                  value={draft.streetAddress}
                  onChange={(e) => update("streetAddress", e.target.value)}
                  placeholder="123 Business Blvd"
                />
              </Field>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                <Field label="City" required>
                  <Input
                    value={draft.city}
                    onChange={(e) => update("city", e.target.value)}
                    placeholder="San Francisco"
                  />
                </Field>
                <Field label="State" required>
                  <Input
                    value={draft.state}
                    onChange={(e) => update("state", e.target.value)}
                    placeholder="CA"
                  />
                </Field>
                <Field label="ZIP Code" required>
                  <Input
                    value={draft.zipCode}
                    onChange={(e) => update("zipCode", e.target.value)}
                    placeholder="94102"
                  />
                </Field>
              </div>

              <Field label="Country" required>
                <Input
                  value={draft.country}
                  onChange={(e) => update("country", e.target.value)}
                  placeholder="United States"
                />
              </Field>
            </div>
          </SectionCard>

          {/* Business / Tax */}
          <SectionCard icon={<BadgeCheck className="h-5 w-5" />} title="Business License & Tax">
            <div className="grid grid-cols-1 gap-5">
              <Field label="Business License Number" hint="Your state or local business license number">
                <Input
                  value={draft.businessLicenseNumber}
                  onChange={(e) => update("businessLicenseNumber", e.target.value)}
                  placeholder="BL-123456789"
                />
              </Field>

              <Field
                label="Tax ID / EIN"
                required
                hint="Federal Tax ID or Employer Identification Number"
              >
                <Input
                  value={draft.taxIdEin}
                  onChange={(e) => update("taxIdEin", e.target.value)}
                  placeholder="12-3456789"
                />
              </Field>

              <label className="inline-flex items-center gap-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.hasLiabilityInsurance}
                  onChange={(e) => update("hasLiabilityInsurance", e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                I have a valid general liability insurance certificate for event hosting
              </label>
            </div>
          </SectionCard>

          {/* Event Experience */}
          <SectionCard icon={<CalendarDays className="h-5 w-5" />} title="Event Experience">
            <div className="grid grid-cols-1 gap-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field label="Events Hosted Per Year">
                  <Input
                    value={draft.eventsHostedPerYear}
                    onChange={(e) => update("eventsHostedPerYear", e.target.value)}
                    placeholder="12"
                  />
                </Field>

                <Field label="Typical Event Size">
                  <Select
                    value={draft.typicalEventSize}
                    onChange={(e) => update("typicalEventSize", e.target.value as any)}
                  >
                    <option value="Select size range">Select size range</option>
                    <option value="Under 500">Under 500</option>
                    <option value="500–1,000">500–1,000</option>
                    <option value="1,000–5,000">1,000–5,000</option>
                    <option value="5,000+">5,000+</option>
                  </Select>
                </Field>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-bold text-slate-800">
                  Event Industries (Select all that apply)
                </div>

                <div className="flex flex-wrap gap-3">
                  {INDUSTRIES.map((ind) => {
                    const active = draft.industries.includes(ind);
                    return (
                      <button
                        key={ind}
                        type="button"
                        onClick={() => toggleIndustry(ind)}
                        className={cx(
                          "rounded-full border px-4 py-2 text-sm font-extrabold transition",
                          active
                            ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        )}
                      >
                        {ind}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Banking */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div className="text-lg font-extrabold text-slate-900">
                  Banking & Payment Information
                </div>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-extrabold text-slate-600">
                Optional
              </span>
            </div>

            <div className="px-6 py-6">
              <div className="text-sm font-semibold text-slate-600">
                Provide your banking details to receive payments from vendors booking booths at your
                events.
              </div>

              <div className="mt-5 grid grid-cols-1 gap-5">
                <Field label="Account Holder Name">
                  <Input
                    value={draft.accountHolderName}
                    onChange={(e) => update("accountHolderName", e.target.value)}
                    placeholder="ABC Events Company LLC"
                  />
                </Field>

                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <Field label="Routing Number">
                    <Input
                      value={draft.routingNumber}
                      onChange={(e) => update("routingNumber", e.target.value)}
                      placeholder="123456789"
                    />
                  </Field>

                  <Field label="Account Number">
                    <Input
                      value={draft.accountNumber}
                      onChange={(e) => update("accountNumber", e.target.value)}
                      placeholder="000123456789"
                    />
                  </Field>
                </div>

                <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-700">
                  Note: Your banking information is securely stored and encrypted. It will only be
                  used to process payments for vendor booth bookings.
                </div>
              </div>
            </div>
          </section>

          {/* Bottom actions */}
          <div className="mt-2 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => navigate("/organizer/dashboard")}
              className="rounded-full border border-slate-200 bg-white px-7 py-3 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onComplete}
              className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-7 py-3 text-sm font-extrabold text-white hover:bg-indigo-700"
            >
              <BadgeCheck className="h-4 w-4" />
              Complete Setup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
