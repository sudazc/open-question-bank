import type { Diagnostic } from './diagnostics.js';
import type { ValidationMode } from './publication-validator.js';
import type { LocatedEntity, LocatedQuestionBank } from './types.js';

interface QualityTextField {
  value: string;
  file: string;
  entityId: string;
  fieldPath: string;
}

/** 检查空白内容和完全重复的题干 */
export function validateContentQuality(
  bank: LocatedQuestionBank,
  diagnostics: Diagnostic[],
  mode: ValidationMode,
): void {
  const requiredTextFields = collectRequiredTextFields(bank, mode);
  for (const field of requiredTextFields) {
    if (field.value.trim().length === 0) {
      diagnostics.push({
        code: 'OQB-QUALITY-001',
        severity: 'error',
        message: '必填内容不能只包含空白字符',
        file: field.file,
        entityId: field.entityId,
        fieldPath: field.fieldPath,
        suggestion: '补充有效内容，不能只包含空白字符',
      });
    }
  }

  const firstQuestionByStem = new Map<string, LocatedEntity<{ id: string }>>();
  for (const question of bank.questions) {
    const stem = normalizeText(question.value.stem);
    if (stem) {
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

    if ('choices' in question.value) {
      const firstChoiceByText = new Map<string, string>();
      for (const [index, choice] of question.value.choices.entries()) {
        const text = normalizeText(choice.text);
        if (!text) {
          continue;
        }
        const firstChoiceId = firstChoiceByText.get(text);
        if (firstChoiceId) {
          diagnostics.push({
            code: 'OQB-QUALITY-003',
            severity: 'warning',
            message: `选项文本与选项 ${firstChoiceId} 规范化后重复`,
            file: question.file,
            entityId: question.value.id,
            fieldPath: `choices[${index}].text`,
            suggestion: '检查选项是否重复；如含义相同请合并或改写成可区分的选项',
          });
        } else {
          firstChoiceByText.set(text, choice.id);
        }
      }
    }
  }
}

function collectRequiredTextFields(
  bank: LocatedQuestionBank,
  mode: ValidationMode,
): QualityTextField[] {
  const fields: QualityTextField[] = [];
  const bankEntity = bank.bank;
  if (bankEntity) {
    addField(fields, bankEntity, 'name', bankEntity.value.name);
    // 发布模式会由授权校验报告许可证问题，避免同一空值产生重复诊断
    if (mode === 'draft') {
      addField(fields, bankEntity, 'license', bankEntity.value.license);
    }
    bankEntity.value.maintainers.forEach((maintainer, index) => {
      addField(fields, bankEntity, `maintainers[${index}].name`, maintainer.name);
    });
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
    addField(fields, question, 'difficulty', question.value.difficulty);
    if ('choices' in question.value) {
      question.value.choices.forEach((choice, index) => {
        addField(fields, question, `choices[${index}].text`, choice.text);
      });
    }
    if (question.value.type === 'fill_blank') {
      question.value.answer.blanks.forEach((blank, blankIndex) => {
        blank.acceptedAnswers.forEach((answer, answerIndex) => {
          addField(
            fields,
            question,
            `answer.blanks[${blankIndex}].acceptedAnswers[${answerIndex}]`,
            answer,
          );
        });
      });
    }
    if (question.value.type === 'short_answer') {
      addField(fields, question, 'answer.referenceAnswer', question.value.answer.referenceAnswer);
      question.value.answer.rubric?.forEach((criterion, index) => {
        addField(fields, question, `answer.rubric[${index}].description`, criterion.description);
      });
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
