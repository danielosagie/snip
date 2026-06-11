export function dashboardHomePath() {
  return "/dashboard";
}

export function teamHomePath(teamSlug: string) {
  return `/dashboard/${teamSlug}`;
}

export function teamSettingsPath(teamSlug: string) {
  return `/dashboard/${teamSlug}/settings`;
}

export function projectPath(teamSlug: string, projectId: string) {
  return `/dashboard/${teamSlug}/${projectId}`;
}

export function videoPath(teamSlug: string, projectId: string, videoId: string) {
  return `/dashboard/${teamSlug}/${projectId}/${videoId}`;
}

export function contractPath(teamSlug: string, projectId: string, contractId: string) {
  return `/dashboard/${teamSlug}/${projectId}/contract/${contractId}`;
}

// Plain documents share the contracts table (docType: "document") but get
// their own URL space so nothing about them is contract-branded.
export function documentPath(teamSlug: string, projectId: string, documentId: string) {
  return `/dashboard/${teamSlug}/${projectId}/doc/${documentId}`;
}

export function signPath(token: string) {
  return `/sign/${token}`;
}
