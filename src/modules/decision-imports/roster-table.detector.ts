import { DecisionTableType } from '@prisma/client';
import { normalizeText, type NormalizedDecisionTable } from './decision-ocr-table-normalizer';

export function detectDecisionTableType(table: NormalizedDecisionTable): {
  type: DecisionTableType;
  confidence: number;
} {
  const text = [...table.header, ...table.rows.slice(0, 3).flatMap((row) => Object.values(row).map(String))]
    .map(normalizeText)
    .join(' ');
  let score = 0;
  if (/(mssv|ma sinh vien|student code)/.test(text)) score += 0.4;
  if (/(ho ten|ho va ten|student name|full name)/.test(text)) score += 0.3;
  if (/(lop|class|khoa|faculty)/.test(text)) score += 0.15;
  if (/(danh sach|tham gia|cong nhan|dat danh hieu)/.test(text)) score += 0.15;

  if (score >= 0.55) return { type: DecisionTableType.roster, confidence: Math.min(score, 0.95) };
  if (/(tieu chi|dieu kien|quy doi)/.test(text)) return { type: DecisionTableType.criteria, confidence: 0.65 };
  if (/(chu ky|nguoi ky|noi nhan)/.test(text)) return { type: DecisionTableType.signature, confidence: 0.6 };
  return { type: DecisionTableType.unknown, confidence: Math.max(score, 0.2) };
}
