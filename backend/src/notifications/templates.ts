import { NotificationChannel } from '@prisma/client';

/**
 * The notifications this system sends, and what they say.
 *
 * The text is rendered on the server, in the recipient's language, before it is
 * stored (spec M6: localised notification text). Rendering later would mean the
 * stored row and the delivered message could disagree — and an SMS has no
 * client to localise it at all.
 */
export const NOTIFICATION_TYPES = {
  labReady: 'lab.ready',
  labCritical: 'lab.critical',
  newMessage: 'message.new',
  medicationDue: 'medication.due',
  appointmentReminder: 'appointment.reminder',
  documentMissing: 'document.missing',
  complicationAnswered: 'complication.answered',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export interface NotificationAction {
  /** Matched by the clients to a screen; never a raw URL from the server. */
  id: string;
  labelKey: string;
}

interface Template {
  title: Record<string, string>;
  body: Record<string, string>;
  /** Rich-notification buttons (spec M6). */
  actions: NotificationAction[];
  /**
   * Sent even during quiet hours.
   *
   * Only where the delay could matter clinically. Everything else waits: a
   * clinic that wakes a patient for a routine reminder teaches them to turn
   * notifications off, and then the one that matters does not arrive either.
   */
  urgent: boolean;
  /** Where the fallback chain may go when push fails. */
  fallback: NotificationChannel[];
}

const TEMPLATES: Record<NotificationType, Template> = {
  'lab.ready': {
    title: { tr: 'Tahlil sonucunuz hazır', en: 'Your lab result is ready' },
    body: {
      tr: 'Sonuçlarınız dosyanıza işlendi. Doktorunuz inceleyecek.',
      en: 'Your results are on file. Your doctor will review them.',
    },
    actions: [
      { id: 'open-lab', labelKey: 'notification.action.openLab' },
      { id: 'ask-doctor', labelKey: 'notification.action.askDoctor' },
    ],
    urgent: false,
    fallback: [NotificationChannel.EMAIL],
  },
  'lab.critical': {
    title: { tr: 'Kritik tahlil değeri', en: 'Critical lab value' },
    body: {
      tr: 'Bir tahlil değeri acil inceleme gerektiriyor.',
      en: 'A lab value needs immediate review.',
    },
    actions: [
      { id: 'call-patient', labelKey: 'notification.action.callPatient' },
      { id: 'open-file', labelKey: 'notification.action.openFile' },
    ],
    // A value nobody looks at until morning is the case this exists for.
    urgent: true,
    fallback: [NotificationChannel.SMS, NotificationChannel.EMAIL],
  },
  'message.new': {
    title: { tr: 'Yeni mesaj', en: 'New message' },
    body: { tr: 'Kliniğinizden bir mesaj var.', en: 'You have a message from your clinic.' },
    actions: [{ id: 'open-chat', labelKey: 'notification.action.openChat' }],
    urgent: false,
    fallback: [],
  },
  'medication.due': {
    title: { tr: 'İlaç saatiniz', en: 'Time for your medication' },
    body: { tr: 'İlacınızı almanız gereken saat geldi.', en: 'It is time to take your medication.' },
    actions: [
      { id: 'taken', labelKey: 'notification.action.taken' },
      { id: 'snooze', labelKey: 'notification.action.snooze' },
    ],
    urgent: false,
    fallback: [],
  },
  'appointment.reminder': {
    title: { tr: 'Kontrol randevunuz', en: 'Your follow-up appointment' },
    body: { tr: 'Yaklaşan bir kontrolünüz var.', en: 'You have an upcoming appointment.' },
    actions: [{ id: 'open-appointment', labelKey: 'notification.action.openAppointment' }],
    urgent: false,
    fallback: [NotificationChannel.SMS, NotificationChannel.EMAIL],
  },
  'document.missing': {
    title: { tr: 'Eksik belge', en: 'Missing document' },
    body: {
      tr: 'Ameliyat öncesi belgelerinizden biri eksik.',
      en: 'One of your pre-operative documents is missing.',
    },
    actions: [{ id: 'upload-document', labelKey: 'notification.action.uploadDocument' }],
    urgent: false,
    fallback: [NotificationChannel.EMAIL],
  },
  'complication.answered': {
    title: { tr: 'Bildiriminiz yanıtlandı', en: 'Your report has been answered' },
    body: { tr: 'Kliniğiniz bildiriminizi yanıtladı.', en: 'Your clinic has replied to your report.' },
    actions: [{ id: 'open-complication', labelKey: 'notification.action.openComplication' }],
    urgent: false,
    fallback: [],
  },
};

export interface RenderedNotification {
  title: string;
  body: string;
  actions: NotificationAction[];
  urgent: boolean;
  fallback: NotificationChannel[];
}

/**
 * Renders a notification in the recipient's language.
 *
 * Falls back to Turkish, which is the clinic's own language and the one every
 * template is guaranteed to have. Falling back to the key would put
 * "lab.critical" on a patient's lock screen.
 */
export function render(
  type: NotificationType,
  language: string | null | undefined,
): RenderedNotification | null {
  const template = TEMPLATES[type];
  if (!template) return null;

  const lang = (language ?? 'tr').slice(0, 2).toLowerCase();

  return {
    title: template.title[lang] ?? template.title.tr!,
    body: template.body[lang] ?? template.body.tr!,
    actions: template.actions,
    urgent: template.urgent,
    fallback: template.fallback,
  };
}

export function isKnownType(type: string): type is NotificationType {
  return type in TEMPLATES;
}
