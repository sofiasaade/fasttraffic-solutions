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
  zone: string;
}

export interface MyJob extends DispatchJob {
  myPhases: string[];
}
