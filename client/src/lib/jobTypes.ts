export interface DispatchJob {
  id: string;
  company: string | null;
  jobAddress: string | null;
  projectTitle: string | null;
  startDate: string | null;
  endDate: string | null;
  setupDuration: string | null;
  status: string | null;
  subStatus: string | null;
  requestId: string | null;
  municipality: string | null;
  lat: number | null;
  lon: number | null;
  siteContactPhone: string | null;
  requestorName: string | null;
  techPrep: string[];
  techSetup: string[];
  techPickup: string[];
  planFile: { url: string; filename?: string }[];
  fieldPhotos: { url: string; filename?: string; thumbnails?: any }[];
  fieldComments: string | null;
  closureType: string | null;
  impact: string | null;
  calendarInfo: string | null;
  emoji: string | null;
  clientMessage: string | null;
  zone: string;
  // Coordinator assignment workflow (optional; present on board/dispatch jobs).
  assignmentState?: "pending" | "tentative" | "confirmed" | "cancelled";
  assignmentSummary?: { total: number; confirmed: number; tentative: number };
  techStatus?: Record<string, "tentative" | "confirmed">;
}

export interface MyJob extends DispatchJob {
  myPhases: string[];
}
