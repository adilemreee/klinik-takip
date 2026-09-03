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

  /**
   * A patient message the triage put above routine (spec M4). Not the panic
   * button — nobody pressed anything — but it must not wait for the access
   * window to open.
   */
  messageUrgent: 'message.urgent',

  /** Two days of medicine left; time to renew the prescription (spec M9). */
  medicationRenewal: 'medication.renewal',

  /** The clinic, told that a patient is not keeping to a course (spec M9). */
  medicationAdherenceLow: 'medication.adherence.low',

  /** The doctor's morning briefing is worth opening today (spec M5). */
  briefingReady: 'briefing.ready',

  /** The panic button, on its way to whoever is meant to answer it (spec M8). */
  emergencyTriggered: 'emergency.triggered',
  /** The same alarm, one rung further up, because nobody answered the last. */
  emergencyEscalated: 'emergency.escalated',
  /** Back to the patient: somebody has picked this up. */
  emergencyAcknowledged: 'emergency.acknowledged',
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
  /**
   * Not silenceable by a preference.
   *
   * Only the emergency alerts. Everything else a person may switch off, and
   * should be able to — but an alarm you can turn off is an alarm that will be
   * off on the night it matters, and the person who turned it off will not
   * remember doing so.
   */
  mandatory: boolean;
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
    mandatory: false,
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
    mandatory: false,
    fallback: [NotificationChannel.SMS, NotificationChannel.EMAIL],
  },
  'message.new': {
    title: { tr: 'Yeni mesaj', en: 'New message' },
    body: { tr: 'Kliniğinizden bir mesaj var.', en: 'You have a message from your clinic.' },
    actions: [{ id: 'open-chat', labelKey: 'notification.action.openChat' }],
    urgent: false,
    mandatory: false,
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
    mandatory: false,
    fallback: [],
  },
  'appointment.reminder': {
    title: { tr: 'Kontrol randevunuz', en: 'Your follow-up appointment' },
    body: { tr: 'Yaklaşan bir kontrolünüz var.', en: 'You have an upcoming appointment.' },
    actions: [{ id: 'open-appointment', labelKey: 'notification.action.openAppointment' }],
    urgent: false,
    mandatory: false,
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
    mandatory: false,
    fallback: [NotificationChannel.EMAIL],
  },
  'complication.answered': {
    title: { tr: 'Bildiriminiz yanıtlandı', en: 'Your report has been answered' },
    body: { tr: 'Kliniğiniz bildiriminizi yanıtladı.', en: 'Your clinic has replied to your report.' },
    actions: [{ id: 'open-complication', labelKey: 'notification.action.openComplication' }],
    urgent: false,
    mandatory: false,
    fallback: [],
  },
  'message.urgent': {
    title: { tr: 'Acil olabilecek mesaj', en: 'Message that may be urgent' },
    body: {
      tr: 'Bir hasta mesajı acil olarak değerlendirildi. Açıp okuyun.',
      en: 'A patient message was triaged as urgent. Open and read it.',
    },
    actions: [
      { id: 'open-chat', labelKey: 'notification.action.openChat' },
      { id: 'call-patient', labelKey: 'notification.action.callPatient' },
    ],
    urgent: true,
    // Not silenceable, for the same reason the emergency alerts are not: the
    // whole value of triaging a message upward is that somebody is told now.
    mandatory: true,
    fallback: [NotificationChannel.SMS, NotificationChannel.EMAIL],
  },
  'medication.renewal': {
    title: { tr: 'İlacınız bitmek üzere', en: 'Your medication is running out' },
    body: {
      tr: 'İki günlük ilacınız kaldı. Reçete yenileme için kliniğinize yazın.',
      en: 'You have about two days left. Message your clinic about a renewal.',
    },
    actions: [
      { id: 'open-medication', labelKey: 'notification.action.openMedication' },
      { id: 'open-chat', labelKey: 'notification.action.openChat' },
    ],
    urgent: false,
    mandatory: false,
    fallback: [NotificationChannel.SMS, NotificationChannel.EMAIL],
  },
  'medication.adherence.low': {
    title: { tr: 'İlaç uyumu düşük', en: 'Low medication adherence' },
    body: {
      tr: 'Bir hastanın ilaç uyumu beklenenin altında. Dosyayı açın.',
      en: "A patient's medication adherence is below the threshold. Open their file.",
    },
    actions: [
      { id: 'open-file', labelKey: 'notification.action.openFile' },
      { id: 'call-patient', labelKey: 'notification.action.callPatient' },
    ],
    // Not urgent and not mandatory: this is a pattern over days, and waking
    // somebody at night about it would be the wrong lesson to teach them about
    // what a night-time alert means.
    urgent: false,
    mandatory: false,
    fallback: [NotificationChannel.EMAIL],
  },
  'briefing.ready': {
    title: { tr: 'Günlük özet hazır', en: 'Your morning briefing is ready' },
    body: {
      tr: 'Dün ne oldu, bugün ne var, kim bekliyor.',
      en: 'What happened yesterday, what is on today, who is waiting.',
    },
    actions: [{ id: 'open-briefing', labelKey: 'notification.action.openBriefing' }],
    // A morning summary is not worth waking anybody for, and it is only sent
    // when there is something in it.
    urgent: false,
    mandatory: false,
    fallback: [],
  },
  'emergency.triggered': {
    title: { tr: 'ACİL DURUM', en: 'EMERGENCY' },
    body: {
      tr: 'Bir hasta acil durum butonuna bastı. Hemen açın.',
      en: 'A patient pressed the emergency button. Open this now.',
    },
    actions: [
      { id: 'open-emergency', labelKey: 'notification.action.openEmergency' },
      { id: 'acknowledge-emergency', labelKey: 'notification.action.acknowledgeEmergency' },
    ],
    urgent: true,
    mandatory: true,
    // Both, and in this order: a phone with no signal for push often still
    // takes an SMS, and the mail is the one that survives a dead battery.
    fallback: [NotificationChannel.SMS, NotificationChannel.EMAIL],
  },
  'emergency.escalated': {
    title: { tr: 'ACİL DURUM — yanıtlanmadı', en: 'EMERGENCY — unanswered' },
    body: {
      tr: 'Bir acil durum çağrısı yanıtlanmadı ve size iletildi.',
      en: 'An emergency call went unanswered and has been passed to you.',
    },
    actions: [
      { id: 'open-emergency', labelKey: 'notification.action.openEmergency' },
      { id: 'acknowledge-emergency', labelKey: 'notification.action.acknowledgeEmergency' },
    ],
    urgent: true,
    mandatory: true,
    fallback: [NotificationChannel.SMS, NotificationChannel.EMAIL],
  },
  'emergency.acknowledged': {
    title: { tr: 'Çağrınız alındı', en: 'We have your call' },
    body: {
      tr: 'Kliniğinizden biri acil çağrınızı aldı ve size ulaşıyor.',
      en: 'Someone at your clinic has your emergency call and is reaching you.',
    },
    actions: [{ id: 'open-emergency', labelKey: 'notification.action.openEmergency' }],
    // The patient is waiting and has no way of knowing anyone saw it. Quiet
    // hours holding *this* would be absurd.
    urgent: true,
    mandatory: true,
    fallback: [NotificationChannel.SMS],
  },
};

export interface RenderedNotification {
  title: string;
  body: string;
  actions: NotificationAction[];
  urgent: boolean;
  mandatory: boolean;
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
    mandatory: template.mandatory,
    fallback: template.fallback,
  };
}

export function isKnownType(type: string): type is NotificationType {
  return type in TEMPLATES;
}
