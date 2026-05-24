import { internalQuery } from "./_generated/server";

/**
 * Storage authorization scope for the calling user.
 *
 * Returns the set of bucket key prefixes the user is entitled to. This
 * is the authoritative allow-list that `storageCredentials` turns into a
 * scoped, short-lived credential (R2 temp creds / STS session policy).
 * Because the minted credential physically cannot read outside these
 * prefixes, this is the server-side ACL — it does not depend on the
 * client honoring the rclone `--filter-from` rules.
 *
 * Per team the user belongs to:
 *   - If the user has explicit per-user grants (folderPermissions rows
 *     naming their Clerk subject — created from an invite's folder scope,
 *     or by an admin) → the credential is scoped to exactly those
 *     prefixes. This makes within-team restrictions storage-enforced.
 *   - Otherwise → the whole team root `projects/<teamSlug>/` (full
 *     member; cross-team isolation still holds).
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
      if (!team?.slug) continue;

      const grants = await ctx.db
        .query("folderPermissions")
        .withIndex("by_team", (q) => q.eq("teamId", m.teamId))
        .collect();
      const userGrants = grants.filter((g) =>
        g.allowedClerkIds.includes(identity.subject),
      );

      if (userGrants.length > 0) {
        for (const g of userGrants) prefixes.push(g.pathPrefix);
      } else {
        prefixes.push(`projects/${team.slug}/`);
      }
    }
    return { isMember: true, prefixes };
  },
});
