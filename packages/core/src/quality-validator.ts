import type { Diagnostic } from './diagnostics.js';
import type { LocatedEntity, LocatedQuestionBank } from './types.js';

interface QualityTextField {
  value: string;
  file: string;
  entityId: string;
  fieldPath: string;
}

/** 检查空白内容和完全重复的题干 */
export function validateContentQuality(bank: LocatedQuestionBank, diagnostics: Diagnostic[]): void {
  const requiredTextFields = collectRequiredTextFields(bank);
  for (const field of requiredTextFields) {
    if (field.value.trim().length === 0) {
      diagnostics.push({
        code: 'OQB-QUALITY-001',
        severity: 'error',
        message: '必填内容不能只包含空白字符',
        file: field.file,
        entityId: field.entityId,
        fieldPath: field.fieldPath,
        suggestion: '补充可读的题干、正文、标题或选项内容',
      });
    }
  }

  const firstQuestionByStem = new Map<string, LocatedEntity<{ id: string }>>();
  for (const question of bank.questions) {
    const stem = normalizeText(question.value.stem);
    if (!stem) {
      continue;
    }
    const first = firstQuestionByStem.get(stem);
    if (first) {
      diagnostics.push({
        code: 'OQB-QUALITY-002',
        severity: 'warning',
        message: `题干与题目 ${first.value.id} 完全重复`,
        file: question.file,
        entityId: question.value.id,
        fieldPath: 'stem',
        suggestion: '确认重复题目是否有意保留，并补充区分场景或合并重复内容',
      });
    } else {
      firstQuestionByStem.set(stem, question);
    }
  }
}

function collectRequiredTextFields(bank: LocatedQuestionBank): QualityTextField[] {
  const fields: QualityTextField[] = [];
  if (bank.bank) {
    addField(fields, bank.bank, 'name', bank.bank.value.name);
  }
  for (const topic of bank.topics) {
    addField(fields, topic, 'name', topic.value.name);
  }
  for (const note of bank.knowledge) {
    addField(fields, note, 'title', note.value.title);
    addField(fields, note, 'body', note.value.body);
  }
  for (const question of bank.questions) {
    addField(fields, question, 'stem', question.value.stem);
    if ('choices' in question.value) {
      question.value.choices.forEach((choice, index) => {
        addField(fields, question, `choices[${index}].text`, choice.text);
      });
    }
    if (question.value.type === 'short_answer') {
      addField(fields, question, 'answer.referenceAnswer', question.value.answer.referenceAnswer);
    }
  }
  for (const group of bank.groups) {
    addField(fields, group, 'title', group.value.title);
    addField(fields, group, 'passage', group.value.passage);
  }
  for (const exam of bank.exams) {
    addField(fields, exam, 'title', exam.value.title);
  }
  return fields;
}

function addField<T extends { id: string }>(
  fields: QualityTextField[],
  entity: LocatedEntity<T>,
  fieldPath: string,
  value: string,
): void {
  fields.push({ value, file: entity.file, entityId: entity.value.id, fieldPath });
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
