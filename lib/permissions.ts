import { Role } from "@/lib/db-enums";

export const permissions = {
  ADMIN: [
    "dashboard.view",
    "users.read", "users.create", "users.update", "users.deactivate", "users.delete", "users.resetPassword",
    "applications.read",
    "team.read", "team.manage",
    "events.read", "events.create", "events.update", "events.delete",
    "forms.read", "forms.create", "forms.update", "forms.delete", "forms.responses.read", "forms.responses.export",
    "certificates.read.all", "certificates.issue", "certificates.read.own",
    "zones.manage",
    "attendance.sessions.create", "attendance.sessions.manage", "attendance.qr.generate",
    "attendance.read.all", "attendance.export", "attendance.manualMark",
    "excuses.read.all", "excuses.review",
    "points.view", "points.manage",
    "notifications.read", "notifications.send", "notifications.send.anyAudience", "notifications.manage",
    "audit.read", "permissions.read",
    "profile.read.own", "profile.update.own", "attendance.read.own", "attendance.scan.own",
    "notifications.manage.own", "excuses.create.own",
  ],
  LEADER: [
    "dashboard.view",
    "team.read",
    "events.read", "events.create", "events.update",
    "forms.read", "forms.create", "forms.update", "forms.responses.read", "forms.responses.export",
    "attendance.read.committee", "attendance.export.committee",
    "excuses.read.committee", "excuses.review",
    "notifications.read", "notifications.send",
    "profile.read.own", "profile.update.own", "attendance.read.own", "attendance.scan.own",
    "notifications.manage.own", "excuses.create.own",
    "certificates.read.own",
  ],
  MEMBER: [
    "dashboard.view", "team.read", "events.read",
    "profile.read.own", "profile.update.own", "attendance.read.own", "attendance.scan.own",
    "notifications.read", "notifications.manage.own", "excuses.create.own",
    "certificates.read.own",
  ],
} as const satisfies Record<Role, readonly string[]>;

export type Permission = (typeof permissions)[Role][number];
export type Actor = {
  id: string;
  role: Role;
  committeeId: string | null;
  isActive: boolean;
};

export function hasPermission(actor: Actor, permission: Permission): boolean {
  return actor.isActive && (permissions[actor.role] as readonly string[]).includes(permission);
}

export function canAccessCommittee(actor: Actor, committeeId: string | null): boolean {
  return actor.role === "ADMIN" || (
    actor.role === "LEADER" && !!actor.committeeId && actor.committeeId === committeeId
  );
}

export function permissionRows() {
  return (Object.keys(permissions) as Role[]).map((role) => ({
    role,
    permissions: permissions[role],
  }));
}
