// src/api/diagramTypes.ts

export type BoothStatus =
  | "available"
  | "assigned"
  | "pending"
  | "reserved"
  | "blocked"
  | "hidden"
  | "street"; // 👈 NEW
  | string;

export interface Booth {
  id?: string;            // booth code (B1, A2, etc.)
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status?: BoothStatus;
}

export interface DiagramJson {
  width?: number;
  height?: number;
  boothMap?: Record<string, Booth>;
}

export interface DiagramEnvelope {
  diagram: DiagramJson;
  // Eventually we can wire slots in, for now this stays generic.
  slots: unknown[];
}
