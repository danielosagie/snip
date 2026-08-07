export type LazyEncodingMode = "never" | "free" | "always";

export function normalizeLazyEncodingMode(raw: string | undefined): LazyEncodingMode {
  const mode = (raw ?? "free").trim().toLowerCase();
  if (mode === "never" || mode === "off" || mode === "false") return "never";
  if (mode === "always" || mode === "all" || mode === "true") return "always";
  return "free";
}

export function shouldDeferEncodingForPolicy(args: {
  configuredMode?: string;
  tier: string;
  driveFirst: boolean;
}): boolean {
  if (args.driveFirst) return true;
  const mode = normalizeLazyEncodingMode(args.configuredMode);
  if (mode === "never") return false;
  if (mode === "always") return true;
  return args.tier.trim().toLowerCase() === "free";
}
