import { internalQuery } from "./_generated/server";

/**
 * Storage authorization scope for the calling user.
 *
 * Returns the set of bucket key prefixes the user is entitled to —
 * one `projects/<teamSlug>/` root per team they belong to. This is the
 * authoritative allow-list that `storageCredentials` turns into a
 * scoped, short-lived credential (R2 temp creds / STS session policy).
 * Because the minted credential physically cannot read outside these
 * prefixes, this is the server-side ACL — it does not depend on the
 * client honoring the rclone `--filter-from` rules.
 */
export const getUserStorageScope = internalQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ isMember: boolean; prefixes: string[] }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { isMember: false, prefixes: [] };

    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userClerkId", identity.subject))
      .collect();
    if (memberships.length === 0) return { isMember: false, prefixes: [] };

    const prefixes: string[] = [];
    for (const m of memberships) {
      const team = await ctx.db.get(m.teamId);
      if (team?.slug) prefixes.push(`projects/${team.slug}/`);
    }
    return { isMember: true, prefixes };
  },
});
