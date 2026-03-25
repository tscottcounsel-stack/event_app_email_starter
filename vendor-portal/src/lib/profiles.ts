type OrganizerProfile = {
  userId: string;
  organizationName?: string;
  organizationType?: string;
  description?: string;
  yearsOperating?: string;
  website?: string;
  primaryContactName?: string;
  email?: string;
  phone?: string;
  [k: string]: any;
};

const key = (userId: string) => `organizer_profile_${userId}`;

export function saveOrganizerProfile(userId: string, profile: Partial<OrganizerProfile>) {
  const current = loadOrganizerProfile(userId) || { userId };
  const merged = { ...current, ...profile, userId };
  localStorage.setItem(key(userId), JSON.stringify(merged));
  return merged;
}

export function loadOrganizerProfile(userId: string): OrganizerProfile | null {
  const raw = localStorage.getItem(key(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}





