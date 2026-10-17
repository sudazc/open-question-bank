import type { Diagnostic } from './diagnostics.js';
import { extractMarkdownDestinations, maskMarkdownCode } from './asset-validator.js';
import type { LocatedQuestionBank } from './types.js';

interface ContentField {
  value: string;
  file: string;
  entityId: string;
  fieldPath: string;
}

const safeHtmlTags = new Set(['br', 'hr', 'sub', 'sup', 'kbd', 'mark', 'details', 'summary']);
const htmlTagPattern = /<\/?([A-Za-z][A-Za-z0-9:-]*)\b[^<>]*>/g;

/** 拒绝 Markdown 内容中的活动 HTML 与脚本协议链接 */
export function validateContentSecurity(
  bank: LocatedQuestionBank,
  diagnostics: Diagnostic[],
): void {
  for (const field of collectContentFields(bank)) {
    const searchable = maskMarkdownCode(field.value)
      .replace(/(\]\s*\(\s*)<([^>\n]+)>/g, '$1 ')
      .replace(/^([ \t]{0,3}\[[^\]\n]+\]:[ \t]*)<([^>\n]+)>/gm, '$1 ')
      .replace(/<(?:https?:\/\/[^>\s]+|mailto:[^>\s]+|[^<>\s@]+@[^<>\s@]+)>/gi, ' ');
    const tags = [...searchable.matchAll(htmlTagPattern)].map((match) => match[0]);
    const unsafeTags = tags.filter((tag) => !isSafeHtmlTag(tag));
    if (
      unsafeTags.length > 0 ||
      /<!\s*(?:doctype|entity)\b|<\?xml-stylesheet\b/i.test(searchable)
    ) {
      diagnostics.push({
        code: 'OQB-SECURITY-001',
        severity: 'error',
        message: '内容包含不允许的 HTML 标签或文档声明',
        file: field.file,
        entityId: field.entityId,
        fieldPath: field.fieldPath,
        suggestion:
          '移除脚本、嵌入式对象和自定义 HTML；可使用 Markdown 或安全标签 br、hr、sub、sup、kbd、mark、details、summary',
      });
    }

    const destinations = extractMarkdownDestinations(field.value);
    if (
      destinations.some(isUnsafeDestination) ||
      /<\s*(?:javascript|vbscript|data)\s*:/i.test(searchable)
    ) {
      diagnostics.push({
        code: 'OQB-SECURITY-002',
        severity: 'error',
        message: '内容包含不安全的脚本或数据链接协议',
        file: field.file,
        entityId: field.entityId,
        fieldPath: field.fieldPath,
        suggestion: '移除 javascript、vbscript 和 data 链接，改用题库资源或 HTTPS 地址',
      });
    }
  }
}

function collectContentFields(bank: LocatedQuestionBank): ContentField[] {
  const fields: ContentField[] = [];
  if (bank.bank) {
    addField(fields, bank.bank.file, bank.bank.value.id, 'name', bank.bank.value.name);
    if (bank.bank.value.description !== undefined) {
      addField(
        fields,
        bank.bank.file,
        bank.bank.value.id,
        'description',
        bank.bank.value.description,
      );
    }
  }
  for (const topic of bank.topics) {
    addField(fields, topic.file, topic.value.id, 'name', topic.value.name);
    if (topic.value.description !== undefined) {
      addField(fields, topic.file, topic.value.id, 'description', topic.value.description);
    }
  }
  for (const note of bank.knowledge) {
    addField(fields, note.file, note.value.id, 'title', note.value.title);
    addField(fields, note.file, note.value.id, 'body', note.value.body);
    if (note.value.summary !== undefined) {
      addField(fields, note.file, note.value.id, 'summary', note.value.summary);
    }
  }
  for (const question of bank.questions) {
    addField(fields, question.file, question.value.id, 'stem', question.value.stem);
    if (question.value.explanation !== undefined) {
      addField(fields, question.file, question.value.id, 'explanation', question.value.explanation);
    }
    if ('choices' in question.value) {
      question.value.choices.forEach((choice, index) => {
        addField(fields, question.file, question.value.id, `choices[${index}].text`, choice.text);
      });
    }
    if (question.value.type === 'fill_blank') {
      question.value.answer.blanks.forEach((blank, blankIndex) => {
        blank.acceptedAnswers.forEach((answer, answerIndex) => {
          addField(
            fields,
            question.file,
            question.value.id,
            `answer.blanks[${blankIndex}].acceptedAnswers[${answerIndex}]`,
            answer,
          );
        });
      });
    } else if (question.value.type === 'numeric') {
      addField(
        fields,
        question.file,
        question.value.id,
        'answer.value',
        question.value.answer.value,
      );
      if (question.value.answer.unit !== undefined) {
        addField(
          fields,
          question.file,
          question.value.id,
          'answer.unit',
          question.value.answer.unit,
        );
      }
    } else if (question.value.type === 'short_answer') {
      addField(
        fields,
        question.file,
        question.value.id,
        'answer.referenceAnswer',
        question.value.answer.referenceAnswer,
      );
      question.value.answer.rubric?.forEach((criterion, index) => {
        addField(
          fields,
          question.file,
          question.value.id,
          `answer.rubric[${index}].description`,
          criterion.description,
        );
      });
    }
  }
  for (const group of bank.groups) {
    addField(fields, group.file, group.value.id, 'title', group.value.title);
    addField(fields, group.file, group.value.id, 'passage', group.value.passage);
  }
  for (const exam of bank.exams) {
    addField(fields, exam.file, exam.value.id, 'title', exam.value.title);
    if (exam.value.description !== undefined) {
      addField(fields, exam.file, exam.value.id, 'description', exam.value.description);
    }
  }
  return fields;
}

function addField(
  fields: ContentField[],
  file: string,
  entityId: string,
  fieldPath: string,
  value: string,
): void {
  fields.push({ value, file, entityId, fieldPath });
}

function isSafeHtmlTag(tag: string): boolean {
  const body = tag.slice(1, -1).trim();
  const closing = body.startsWith('/');
  const content = closing ? body.slice(1).trim() : body;
  const match = /^([A-Za-z][A-Za-z0-9:-]*)(.*)$/.exec(content);
  const name = match?.[1]?.toLowerCase();
  const attributes = match?.[2]?.trim() ?? '';
  if (!name || !safeHtmlTags.has(name)) {
    return false;
  }
  if (closing) {
    return attributes.length === 0;
  }
  if (name === 'details') {
    return attributes === '' || attributes === 'open' || attributes === '/';
  }
  return attributes === '' || (['br', 'hr'].includes(name) && attributes === '/');
}

function isUnsafeDestination(destination: string): boolean {
  const decoded = decodeRelevantHtmlEntities(decodeMarkdownBackslashEscapes(destination));
  let compact = '';
  for (const character of decoded) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint > 0x20 && codePoint !== 0x7f) {
      compact += character;
    }
  }
  const normalized = compact.toLowerCase();
  return /^(?:javascript|vbscript|data):/.test(normalized);
}

function decodeMarkdownBackslashEscapes(value: string): string {
  return value.replace(/\\([\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e])/g, '$1');
}

function decodeRelevantHtmlEntities(value: string): string {
  return value
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n')
    .replace(
      /&#(?:x([0-9a-f]+)|(\d+));?/gi,
      (entity, hex: string | undefined, decimal: string | undefined) => {
        const codePoint = Number.parseInt(hex ?? decimal ?? '', hex ? 16 : 10);
        return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      },
    );
}
