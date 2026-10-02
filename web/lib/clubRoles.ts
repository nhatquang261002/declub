/**
 * Who may do what inside a Club (ADR 0016, docs/09-clubs.md). Pure rules over user ids, so the
 * permission matrix is tested without a server. Roles are kept per Club; the app admin is not
 * stored there but comes from the CLUB_ADMIN_USER_IDS setting.
 */
export type ClubRole = "admin" | "owner" | "moderator" | "member";

/** What a Club stores: at most one Owner, and up to `MAX_MODERATORS` Moderators (user ids). */
export type Roles = { owner?: string; moderators: string[] };

export const MAX_MODERATORS = 10;
export const NO_ROLES: Roles = { moderators: [] };

export function roleOf(roles: Roles, userId: string, admin: boolean): ClubRole {
  if (admin) return "admin";
  if (roles.owner === userId) return "owner";
  return roles.moderators.includes(userId) ? "moderator" : "member";
}

/** Can hide, restore, delete and ban at all. */
export const isStaff = (role: ClubRole) => role !== "member";

/**
 * Whether `actor` may moderate an account holding `target`. A Moderator acts on members only; the
 * Owner on members and Moderators; an app admin on everyone. Nobody acts on themselves here.
 */
export function mayActOn(actor: ClubRole, target: ClubRole): boolean {
  if (actor === "admin") return true;
  if (actor === "owner") return target === "member" || target === "moderator";
  if (actor === "moderator") return target === "member";
  return false;
}

/** Pinning, appointing Moderators and editing the Club's profile. */
export const isOwnerOrAdmin = (role: ClubRole) => role === "owner" || role === "admin";

export type RoleChange = { userId: string; role: "owner" | "moderator" | null };
export type RoleResult =
  | { ok: true; roles: Roles; action: "appoint_moderator" | "remove_moderator" | "assign_owner" | "remove_owner" }
  | { ok: false; reason: "forbidden" | "too_many_moderators" | "already_owner" | "no_change" };

/**
 * Applies one role change. The Owner appoints and removes Moderators and may hand ownership to
 * another member; an admin may also set or remove the Owner. The target is a member of the Club
 * (the caller checks), and `targetIsAdmin` users hold no Club role, since they already outrank it.
 */
export function applyRole(roles: Roles, actor: ClubRole, change: RoleChange, targetIsAdmin = false): RoleResult {
  if (!isOwnerOrAdmin(actor) || targetIsAdmin) return { ok: false, reason: "forbidden" };
  const { userId, role } = change;
  const moderators = roles.moderators.filter((id) => id !== userId);

  if (role === "moderator") {
    if (roles.owner === userId) return { ok: false, reason: "forbidden" };
    if (roles.moderators.includes(userId)) return { ok: false, reason: "no_change" };
    if (roles.moderators.length >= MAX_MODERATORS) return { ok: false, reason: "too_many_moderators" };
    return { ok: true, roles: { ...roles, moderators: [...moderators, userId] }, action: "appoint_moderator" };
  }

  if (role === "owner") {
    if (roles.owner === userId) return { ok: false, reason: "already_owner" };
    // The old Owner becomes a plain member: handing over is giving the Club away.
    return { ok: true, roles: { owner: userId, moderators }, action: "assign_owner" };
  }

  // role === null
  if (roles.owner === userId) {
    if (actor !== "admin") return { ok: false, reason: "forbidden" };
    return { ok: true, roles: { moderators: roles.moderators }, action: "remove_owner" };
  }
  if (!roles.moderators.includes(userId)) return { ok: false, reason: "no_change" };
  return { ok: true, roles: { ...roles, moderators }, action: "remove_moderator" };
}

/** The roles after `userId` left the Club or was banned from it: they lose any role they held. */
export function withoutUser(roles: Roles, userId: string): Roles {
  return {
    ...(roles.owner && roles.owner !== userId ? { owner: roles.owner } : {}),
    moderators: roles.moderators.filter((id) => id !== userId),
  };
}
