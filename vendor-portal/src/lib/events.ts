type Event = {
  id: string;
  organizerId: string;
  name?: string;
  status?: "draft" | "published" | string;
  boothLayout?: any;
  [k: string]: any;
};

type Application = {
  id: string;
  eventId: string;
  vendorId: string;
  businessName?: string;
  category?: string;
  status?: "pending" | "approved" | "rejected" | string;
  submittedAt?: string;
  appliedAt?: string;
  boothId?: string;
  [k: string]: any;
};

const orgEventsKey = (organizerId: string) => `organizer-events:${organizerId}`;
const eventKey = (eventId: string) => `event_${eventId}`;
const appsKey = (eventId: string) => `event_applications_${eventId}`;
const appKey = (eventId: string, appId: string) => `application_${eventId}_${appId}`;

export function getOrganizerEvents(organizerId: string): Event[] {
  const raw = localStorage.getItem(orgEventsKey(organizerId));
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveOrganizerEvents(organizerId: string, events: Event[]) {
  localStorage.setItem(orgEventsKey(organizerId), JSON.stringify(events));
}

export function getEvent(eventId: string): Event | null {
  const raw = localStorage.getItem(eventKey(eventId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveEvent(event: Event) {
  localStorage.setItem(eventKey(event.id), JSON.stringify(event));
  return event;
}

export function getEventApplications(eventId: string): Application[] {
  const raw = localStorage.getItem(appsKey(eventId));
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveApplication(app: Application) {
  // Persist single application record
  localStorage.setItem(appKey(app.eventId, app.id), JSON.stringify(app));

  // Maintain event applications list
  const list = getEventApplications(app.eventId);
  const idx = list.findIndex((a) => a.id === app.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...app };
  else list.push(app);

  localStorage.setItem(appsKey(app.eventId), JSON.stringify(list));
  return app;
}



