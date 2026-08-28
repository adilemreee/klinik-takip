import { Role } from '@prisma/client';

/**
 * The permission catalogue and the default role matrix.
 *
 * Spec section 2 requires that authorisation is data, not code: the doctor can
 * adjust who may do what without a deploy. This file is the *seed* for that
 * data — the source of truth at runtime is the `permissions`, `role_permissions`
 * and `user_permissions` tables.
 */

export interface PermissionDefinition {
  code: string;
  category: string;
  description: string;
}

export const PERMISSIONS: PermissionDefinition[] = [
  // --- Patient file ---
  { code: 'patients.read', category: 'patients', description: 'View patient files' },
  { code: 'patients.read.all', category: 'patients', description: 'View every patient, not only assigned ones' },
  { code: 'patients.write', category: 'patients', description: 'Create and edit patient files' },
  { code: 'patients.delete', category: 'patients', description: 'Deactivate or anonymise a patient' },
  { code: 'patients.assign', category: 'patients', description: 'Assign staff to patients' },

  // --- Clinical ---
  { code: 'medical.read', category: 'medical', description: 'View clinical data' },
  { code: 'medical.write', category: 'medical', description: 'Record measurements and clinical notes' },
  { code: 'medical.decide', category: 'medical', description: 'Make clinical decisions, verify lab results' },
  { code: 'labs.verify', category: 'medical', description: 'Approve OCR-extracted lab results' },
  { code: 'surgeries.write', category: 'medical', description: 'Record surgeries' },

  // --- Messaging ---
  { code: 'messages.read', category: 'messages', description: 'Read conversations' },
  { code: 'messages.write', category: 'messages', description: 'Reply to patients' },
  { code: 'messages.clinical', category: 'messages', description: 'Give clinical answers in messages' },
  { code: 'messages.window.manage', category: 'messages', description: 'Configure access windows' },

  // --- Documents and photos ---
  { code: 'documents.read', category: 'documents', description: 'View documents' },
  { code: 'documents.write', category: 'documents', description: 'Upload and classify documents' },
  { code: 'photos.read', category: 'documents', description: 'View clinical photos' },
  { code: 'photos.write', category: 'documents', description: 'Upload clinical photos' },

  // --- Scheduling and medication ---
  { code: 'appointments.read', category: 'scheduling', description: 'View the calendar' },
  { code: 'appointments.write', category: 'scheduling', description: 'Create and change appointments' },
  { code: 'medications.read', category: 'medication', description: 'View medication plans' },
  { code: 'medications.prescribe', category: 'medication', description: 'Create and change prescriptions' },
  { code: 'medications.approve', category: 'medication', description: 'Approve patient-reported medication' },

  // --- Emergency ---
  { code: 'emergency.receive', category: 'emergency', description: 'Receive emergency alerts' },
  { code: 'emergency.resolve', category: 'emergency', description: 'Acknowledge and close emergencies' },

  // --- Finance (never available to clinical-only roles, spec section 2) ---
  { code: 'finance.read', category: 'finance', description: 'View financial records' },
  { code: 'finance.write', category: 'finance', description: 'Create and edit financial records' },
  { code: 'finance.report', category: 'finance', description: 'View revenue and payment reports' },

  // --- Analytics, export, administration ---
  { code: 'analytics.read', category: 'analytics', description: 'View clinical analytics' },
  { code: 'export.create', category: 'export', description: 'Export data (always audited)' },
  { code: 'staff.read', category: 'admin', description: 'View staff accounts' },
  { code: 'staff.manage', category: 'admin', description: 'Invite staff and change roles' },
  { code: 'permissions.manage', category: 'admin', description: 'Change the permission matrix' },
  { code: 'audit.read', category: 'admin', description: 'Read the audit log' },

  // --- AI ---
  { code: 'ai.review', category: 'ai', description: 'Review AI output and release it to patients' },
  { code: 'ai.protocols.manage', category: 'ai', description: 'Manage the assistant knowledge base' },

  // --- Consent ---
  { code: 'consents.read', category: 'consent', description: 'View consent records' },
  { code: 'consents.collect', category: 'consent', description: 'Collect consent' },

  // --- Patient-facing (own file only; scoping is enforced separately) ---
  { code: 'self.read', category: 'self', description: 'View own file' },
  { code: 'self.write', category: 'self', description: 'Add own measurements, documents and photos' },
  { code: 'self.message', category: 'self', description: 'Message the clinic' },
  { code: 'self.emergency', category: 'self', description: 'Trigger the emergency button' },
];

const ALL = PERMISSIONS.map((p) => p.code);

/**
 * Default matrix. Two rules from spec section 2 are load-bearing here:
 *   - NURSE has no finance permission of any kind.
 *   - FINANCE has no clinical permission of any kind.
 * Both are covered by negative tests.
 */
export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  SUPER_ADMIN: ALL,

  // Everything clinical and operational. The permission matrix itself stays
  // with SUPER_ADMIN, and self.* belongs to patients.
  DOCTOR: ALL.filter((c) => c !== 'permissions.manage' && !c.startsWith('self.')),

  NURSE: [
    'patients.read',
    'medical.read',
    'medical.write',
    'messages.read',
    'messages.write',
    'documents.read',
    'documents.write',
    'photos.read',
    'photos.write',
    'appointments.read',
    'medications.read',
    'emergency.receive',
    'emergency.resolve',
    'consents.read',
  ],

  COORDINATOR: [
    'patients.read',
    'patients.write',
    'appointments.read',
    'appointments.write',
    'messages.read',
    'messages.write',
    'documents.read',
    'documents.write',
    'consents.read',
    'consents.collect',
  ],

  FINANCE: ['finance.read', 'finance.write', 'finance.report', 'export.create'],

  PATIENT: ['self.read', 'self.write', 'self.message', 'self.emergency'],

  CAREGIVER: ['self.read', 'self.message'],
};
