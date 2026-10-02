import { rolesHandler } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/** PUT /api/clubs/[token]/roles  { wallet, role: "owner" | "moderator" | null }: the Owner (or an admin) sets roles. */
export const PUT = rolesHandler(registry);
