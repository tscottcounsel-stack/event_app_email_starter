// vendor-portal/src/api/organizerDiagram.ts
import { apiGet, apiPut } from "./api";

export type SlotStatus =
  | "available"
  | "assigned"
  | "pending"
  | "reserved"
  | "hidden";

export interface BoothSlot {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  status?: SlotStatus;
}

export interface DiagramPayload {
  width: number;
  height: number;
  slots: BoothSlot[];
}

export interface OrganizerDiagram {
  width: number;
  height: number;
  slots: BoothSlot[];
  version: number;
}

// --- API calls ---

// GET /organizer/events/:eventId/diagram
export async function getOrganizerDiagram(
  eventId: number | string
): Promise<OrganizerDiagram> {
  const data = await apiGet(`/organizer/events/${eventId}/diagram`);

  // Handle a couple of common shapes:
  // 1) { diagram: { width, height, slots, version } }
  // 2) { width, height, slots, version }
  const diagram = (data.diagram ?? data) as {
    width?: number;
    height?: number;
    slots?: BoothSlot[];
    version?: number;
  };

  return {
    width: diagram.width ?? 32,
    height: diagram.height ?? 16,
    slots: diagram.slots ?? [],
    version: diagram.version ?? 0,
  };
}

// PUT /organizer/events/:eventId/diagram
// Body shape is commonly:
//   { expect_version, diagram: { width, height, slots } }
// Adjust if your backend expects a different shape.
export async function saveOrganizerDiagram(
  eventId: number | string,
  diagram: DiagramPayload,
  expectVersion: number
): Promise<OrganizerDiagram> {
  const body = {
    expect_version: expectVersion,
    diagram,
  };

  const data = await apiPut(`/organizer/events/${eventId}/diagram`, body);

  const returned = (data.diagram ?? data) as {
    width?: number;
    height?: number;
    slots?: BoothSlot[];
    version?: number;
  };

  return {
    width: returned.width ?? diagram.width,
    height: returned.height ?? diagram.height,
    slots: returned.slots ?? diagram.slots,
    version: returned.version ?? expectVersion,
  };
}
