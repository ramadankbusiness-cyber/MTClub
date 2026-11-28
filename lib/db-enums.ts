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

export const AttendanceRecordSource = {
  UNKNOWN: "UNKNOWN",
  QR: "QR",
  MANUAL: "MANUAL",
  EXCUSE: "EXCUSE",
} as const;
export type AttendanceRecordSource = (typeof AttendanceRecordSource)[keyof typeof AttendanceRecordSource];

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
  BIRTHDAY: "BIRTHDAY",
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const FormAccessMode = {
  MEMBERS_ONLY: "MEMBERS_ONLY",
  AUTHENTICATED_USERS: "AUTHENTICATED_USERS",
  PUBLIC: "PUBLIC",
} as const;
export type FormAccessMode = (typeof FormAccessMode)[keyof typeof FormAccessMode];

export const FormStatus = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  CLOSED: "CLOSED",
  ARCHIVED: "ARCHIVED",
} as const;
export type FormStatus = (typeof FormStatus)[keyof typeof FormStatus];

export const FormFieldType = {
  SHORT_ANSWER: "SHORT_ANSWER",
  PARAGRAPH: "PARAGRAPH",
  MULTIPLE_CHOICE: "MULTIPLE_CHOICE",
  CHECKBOXES: "CHECKBOXES",
  DROPDOWN: "DROPDOWN",
  NUMBER: "NUMBER",
  DATE: "DATE",
  TIME: "TIME",
  EMAIL: "EMAIL",
  PHONE: "PHONE",
  FILE_UPLOAD: "FILE_UPLOAD",
} as const;
export type FormFieldType = (typeof FormFieldType)[keyof typeof FormFieldType];

export const FormDuplicatePolicy = {
  ALLOW: "ALLOW",
  ONE_PER_USER: "ONE_PER_USER",
  ONE_PER_EMAIL: "ONE_PER_EMAIL",
  ONE_PER_IP: "ONE_PER_IP",
} as const;
export type FormDuplicatePolicy = (typeof FormDuplicatePolicy)[keyof typeof FormDuplicatePolicy];

export const FormEventKind = {
  REGISTRATION: "REGISTRATION",
  FEEDBACK: "FEEDBACK",
  GENERAL: "GENERAL",
} as const;
export type FormEventKind = (typeof FormEventKind)[keyof typeof FormEventKind];

export const FormUploadStatus = {
  PENDING: "PENDING",
  ATTACHED: "ATTACHED",
  EXPIRED: "EXPIRED",
  DELETED: "DELETED",
  DELETE_FAILED: "DELETE_FAILED",
} as const;
export type FormUploadStatus = (typeof FormUploadStatus)[keyof typeof FormUploadStatus];
