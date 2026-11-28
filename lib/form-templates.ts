export type TemplateField = {
  type: "SHORT_ANSWER"|"PARAGRAPH"|"MULTIPLE_CHOICE"|"CHECKBOXES"|"DROPDOWN"|"NUMBER"|"DATE"|"TIME"|"EMAIL"|"PHONE"|"FILE_UPLOAD";
  label: string; labelAr?: string; description?: string; descriptionAr?: string; required?: boolean; options?: string[]; validation?: Record<string, unknown>;
};

export type FormTemplateDef = {
  key: string;
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  category: string;
  fields: TemplateField[];
};

export const SYSTEM_FORM_TEMPLATES: FormTemplateDef[] = [
  {
    key: "event-registration",
    title: "Event Registration",
    titleAr: "تسجيل فعالية",
    description: "Collect attendee registration details for an event.",
    descriptionAr: "اجمع بيانات تسجيل الحضور لفعالية.",
    category: "events",
    fields: [
      { type: "SHORT_ANSWER", label: "Full Name", labelAr: "الاسم الكامل", required: true },
      { type: "EMAIL", label: "Email Address", labelAr: "البريد الإلكتروني", required: true },
      { type: "PHONE", label: "Phone Number", labelAr: "رقم الهاتف", required: true },
      { type: "SHORT_ANSWER", label: "Academic Number / ID", labelAr: "الرقم الأكاديمي / الهوية" },
      { type: "MULTIPLE_CHOICE", label: "Will you attend?", labelAr: "هل ستحضر؟", required: true, options: ["Yes", "No", "Maybe"] },
      { type: "PARAGRAPH", label: "Notes", labelAr: "ملاحظات" },
    ],
  },
  {
    key: "member-application",
    title: "Member Application",
    titleAr: "طلب عضوية",
    description: "Collect applications from prospective MT Club members.",
    descriptionAr: "اجمع طلبات الانضمام من أعضاء MT Club المحتملين.",
    category: "membership",
    fields: [
      { type: "SHORT_ANSWER", label: "Full Name", labelAr: "الاسم الكامل", required: true },
      { type: "EMAIL", label: "Email Address", labelAr: "البريد الإلكتروني", required: true },
      { type: "PHONE", label: "Phone Number", labelAr: "رقم الهاتف", required: true },
      { type: "SHORT_ANSWER", label: "Academic Number", labelAr: "الرقم الأكاديمي", required: true },
      { type: "DROPDOWN", label: "Preferred Committee", labelAr: "اللجنة المفضلة", required: true, options: ["Technical", "Media", "PR", "HR", "Events", "Logistics"] },
      { type: "PARAGRAPH", label: "Why do you want to join?", labelAr: "لماذا تريد الانضمام؟", required: true },
    ],
  },
  {
    key: "event-feedback",
    title: "Event Feedback",
    titleAr: "تقييم فعالية",
    description: "Gather feedback after an event.",
    descriptionAr: "اجمع التقييمات بعد الفعالية.",
    category: "events",
    fields: [
      { type: "MULTIPLE_CHOICE", label: "Overall rating", labelAr: "التقييم العام", required: true, options: ["Excellent", "Good", "Average", "Poor"] },
      { type: "MULTIPLE_CHOICE", label: "Would you attend again?", labelAr: "هل ستحضر مرة أخرى؟", required: true, options: ["Yes", "No"] },
      { type: "PARAGRAPH", label: "What did you like most?", labelAr: "ما أكثر ما أعجبك؟" },
      { type: "PARAGRAPH", label: "What can we improve?", labelAr: "ما الذي يمكننا تحسينه؟" },
    ],
  },
  {
    key: "attendance-confirmation",
    title: "Attendance Confirmation",
    titleAr: "تأكيد الحضور",
    description: "Confirm attendance for an upcoming activity.",
    descriptionAr: "أكد الحضور لنشاط قادم.",
    category: "attendance",
    fields: [
      { type: "SHORT_ANSWER", label: "Full Name", labelAr: "الاسم الكامل", required: true },
      { type: "EMAIL", label: "Email Address", labelAr: "البريد الإلكتروني", required: true },
      { type: "MULTIPLE_CHOICE", label: "Attendance status", labelAr: "حالة الحضور", required: true, options: ["I will attend", "I cannot attend"] },
      { type: "PARAGRAPH", label: "Comment", labelAr: "تعليق" },
    ],
  },
  {
    key: "committee-application",
    title: "Committee Application",
    titleAr: "طلب انضمام للجنة",
    description: "Collect applications for a specific committee.",
    descriptionAr: "اجمع طلبات الانضمام للجنة محددة.",
    category: "committee",
    fields: [
      { type: "SHORT_ANSWER", label: "Full Name", labelAr: "الاسم الكامل", required: true },
      { type: "EMAIL", label: "Email Address", labelAr: "البريد الإلكتروني", required: true },
      { type: "PHONE", label: "Phone Number", labelAr: "رقم الهاتف", required: true },
      { type: "DROPDOWN", label: "Committee", labelAr: "اللجنة", required: true, options: ["Technical", "Media", "PR", "HR", "Events", "Logistics"] },
      { type: "PARAGRAPH", label: "Relevant experience", labelAr: "الخبرة ذات الصلة", required: true },
      { type: "FILE_UPLOAD", label: "CV / Portfolio (optional)", labelAr: "السيرة الذاتية / الأعمال (اختياري)" },
    ],
  },
];
