import { normalizeText, type NormalizedDecisionTable } from './decision-ocr-table-normalizer';

export type DecisionColumnMapping = {
  studentCode: string;
  studentName?: string;
  className?: string;
  faculty?: string;
  criterion?: string;
  convertedValue?: string;
  convertedUnit?: string;
  participationStatus?: string;
};

const candidates: Record<keyof DecisionColumnMapping, RegExp[]> = {
  studentCode: [/mssv/, /ma sinh vien/, /student code/, /^ms$/],
  studentName: [/ho va ten/, /ho ten/, /full name/, /student name/],
  className: [/lop/, /class/],
  faculty: [/khoa/, /faculty/, /don vi/],
  criterion: [/tieu chi/, /criterion/, /noi dung/],
  convertedValue: [/so ngay/, /diem/, /gia tri/, /quy doi/, /converted value/],
  convertedUnit: [/don vi tinh/, /unit/],
  participationStatus: [/trang thai/, /ket qua/, /status/, /ghi chu/],
};

export function suggestRosterColumnMapping(table: NormalizedDecisionTable): DecisionColumnMapping {
  const mapping: Partial<DecisionColumnMapping> = {};
  for (const column of table.header) {
    const normalized = normalizeText(column);
    for (const [field, patterns] of Object.entries(candidates) as Array<[keyof DecisionColumnMapping, RegExp[]]>) {
      if (!mapping[field] && patterns.some((pattern) => pattern.test(normalized))) {
        mapping[field] = column;
      }
    }
  }
  return {
    studentCode: mapping.studentCode ?? table.header[0] ?? 'MSSV',
    studentName: mapping.studentName,
    className: mapping.className,
    faculty: mapping.faculty,
    criterion: mapping.criterion,
    convertedValue: mapping.convertedValue,
    convertedUnit: mapping.convertedUnit,
    participationStatus: mapping.participationStatus,
  };
}
