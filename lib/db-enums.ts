export const Role = {
  ADMIN: "ADMIN",
  LEADER: "LEADER",
  MEMBER: "MEMBER",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const AttendanceStatus = {
  PRESENT: "PRESENT",
  LATE: "LATE",
  ABSENT: "ABSENT",
  EXCUSED: "EXCUSED",
} as const;
export type AttendanceStatus = (typeof AttendanceStatus)[keyof typeof AttendanceStatus];

export const AttendanceAttemptStatus = {
  REJECTED: "REJECTED",
  SUSPICIOUS: "SUSPICIOUS",
} as const;
export type AttendanceAttemptStatus = (typeof AttendanceAttemptStatus)[keyof typeof AttendanceAttemptStatus];

export const NotificationType = {
  ANNOUNCEMENT: "ANNOUNCEMENT",
  NEW_EVENT: "NEW_EVENT",
  EVENT_REMINDER: "EVENT_REMINDER",
  SESSION_OPENED: "SESSION_OPENED",
  ATTENDANCE_CONFIRMED: "ATTENDANCE_CONFIRMED",
  ATTENDANCE_REJECTED: "ATTENDANCE_REJECTED",
  ABSENCE_WARNING: "ABSENCE_WARNING",
  ACCOUNT_CREATED: "ACCOUNT_CREATED",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  ROLE_CHANGED: "ROLE_CHANGED",
  EXCUSE_DECISION: "EXCUSE_DECISION",
  POINTS_ADDED: "POINTS_ADDED",
  POINTS_DEDUCTED: "POINTS_DEDUCTED",
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
