import type { Diagnostic } from './diagnostics.js';
import {
  decodeMarkdownBackslashEscapes,
  extractMarkdownDestinations,
  maskMarkdownCode,
} from './asset-validator.js';
import { decodeHtmlCharacterReferences } from './html-entities.js';
import type { LocatedQuestionBank, QuestionBankData } from './types.js';
import { hasUrlCredentials } from './url-security.js';

interface ContentField {
  value: string;
  file: string;
  entityId: string;
  fieldPath: string;
}

const safeHtmlTags = new Set(['br', 'hr', 'sub', 'sup', 'kbd', 'mark', 'details', 'summary']);
const safeLinkProtocols = new Set(['http', 'https', 'mailto', 'oqb', 'tel']);
const htmlTagPattern = /<\/?([A-Za-z][A-Za-z0-9:-]*)\b[^<>]*>/g;

/** 拒绝 Markdown 内容中的活动 HTML 与不受支持的链接协议 */
export function validateContentSecurity(
  bank: LocatedQuestionBank,
  diagnostics: Diagnostic[],
): void {
  for (const field of collectContentFields(bank)) {
    const searchable = maskMarkdownCode(field.value)
      .replace(/(\]\s*\(\s*)<([^>\n]+)>/g, '$1 ')
      .replace(/^((?:[ \t]{0,3}>[ \t]?)*[ \t]*\[[^\]\n]+\]:[ \t]*)<([^>\n]+)>/gm, '$1 ')
      .replace(
        /<(?:https?:\/\/[^>\s]+|mailto:[^>\s]+|tel:[^>\s]+|oqb:\/\/[^>\s]+|[^<>\s@]+@[^<>\s@]+)>/gi,
        ' ',
      );
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

    const destinations = extractAllMarkdownUrlDestinations(field.value);
    if (
      destinations.some(isUnsafeDestination) ||
      /<\s*(?:javascript|vbscript|data)\s*:/i.test(searchable)
    ) {
      diagnostics.push({
        code: 'OQB-SECURITY-002',
        severity: 'error',
        message: '内容包含不安全或不受支持的链接协议',
        file: field.file,
        entityId: field.entityId,
        fieldPath: field.fieldPath,
        suggestion: '外部链接使用 HTTP、HTTPS、mailto 或 tel；内部引用使用合法的 oqb:// 实体地址',
      });
    }
    if (destinations.some(hasDestinationCredentials)) {
      diagnostics.push({
        code: 'OQB-SECURITY-003',
        severity: 'error',
        message: 'Markdown 链接目标不得包含访问凭据',
        file: field.file,
        entityId: field.entityId,
        fieldPath: field.fieldPath,
        suggestion: '移除 URL authority 中的用户名和密码及常见凭据参数，改用不含访问凭据的链接',
      });
    }
  }
}

/** 检查题库数据中来源 URL 和 Markdown 链接目标是否包含访问凭据 */
export function hasCredentialedQuestionBankUrls(data: QuestionBankData): boolean {
  const located: LocatedQuestionBank = {
    ...(data.bank === undefined ? {} : { bank: { value: data.bank, file: 'bank.yaml' } }),
    topics: data.topics.map((value) => ({ value, file: 'topics' })),
    knowledge: data.knowledge.map((value) => ({ value, file: 'knowledge' })),
    questions: data.questions.map((value) => ({ value, file: 'questions' })),
    groups: data.groups.map((value) => ({ value, file: 'groups' })),
    exams: data.exams.map((value) => ({ value, file: 'exams' })),
  };
  const hasCredentialedSourceUrl = [...data.knowledge, ...data.questions, ...data.groups].some(
    ({ source }) => source.url !== undefined && hasUrlCredentials(source.url),
  );
  return (
    hasCredentialedSourceUrl ||
    collectContentFields(located).some(({ value }) =>
      extractAllMarkdownUrlDestinations(value).some(hasDestinationCredentials),
    )
  );
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
  const normalized = normalizeDestination(destination).toLowerCase();
  const protocol = /^([a-z][a-z0-9+.-]*):/.exec(normalized)?.[1];
  return protocol !== undefined && !safeLinkProtocols.has(protocol);
}

function hasDestinationCredentials(destination: string): boolean {
  return hasUrlCredentials(normalizeDestination(destination));
}

function extractAllMarkdownUrlDestinations(markdown: string): string[] {
  return [...extractMarkdownDestinations(markdown), ...extractHttpUrls(markdown)];
}

function normalizeDestination(destination: string): string {
  const decoded = decodeHtmlCharacterReferences(decodeMarkdownBackslashEscapes(destination));
  let compact = '';
  for (const character of decoded) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint > 0x20 && codePoint !== 0x7f) {
      compact += character;
    }
  }
  return compact;
}

function extractHttpUrls(markdown: string): string[] {
  const urls: string[] = [];
  for (const match of maskMarkdownCode(markdown).matchAll(/\bhttps?:\/\/[^\s<>"'`]+/gi)) {
    const url = trimUnmatchedClosingParentheses(match[0]);
    if (url) {
      urls.push(url);
    }
  }
  return urls;
}

function trimUnmatchedClosingParentheses(url: string): string {
  let openParentheses = 0;
  let unmatchedClosingParentheses = 0;
  for (const character of url) {
    if (character === '(') {
      openParentheses += 1;
    } else if (character === ')') {
      if (openParentheses > 0) {
        openParentheses -= 1;
      } else {
        unmatchedClosingParentheses += 1;
      }
    }
  }
  const trailingClosingParentheses = /\)+$/.exec(url)?.[0].length ?? 0;
  return url.slice(
    0,
    url.length - Math.min(unmatchedClosingParentheses, trailingClosingParentheses),
  );
}
