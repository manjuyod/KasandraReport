export interface ReportRow {
  centerName: string;
  accountNumber: string;
  studentName: string;
  parentName: string;
  phoneNumber: string;
  email: string;
}

export const REPORT_COLUMNS = [
  { key: 'centerName', label: 'Center Name' },
  { key: 'accountNumber', label: 'Account Number' },
  { key: 'studentName', label: 'Student Name' },
  { key: 'parentName', label: 'Parent Name' },
  { key: 'phoneNumber', label: 'Phone Number' },
  { key: 'email', label: 'Email' },
] as const;

export type ReportColumnKey = (typeof REPORT_COLUMNS)[number]['key'];
