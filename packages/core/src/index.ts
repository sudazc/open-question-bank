export { hasBlockingDiagnostics, type Diagnostic, type DiagnosticSeverity } from './diagnostics.js';
export {
  evaluateQuestionAnswer,
  type QuestionAnswerEvaluation,
  type QuestionAnswerResponse,
} from './answer-grader.js';
export {
  ExamGenerationError,
  examGenerationAlgorithmVersion,
  generateExam,
  type ExamGenerationErrorCode,
} from './exam-generator.js';
export { buildEntityIndex, type EntityIndex } from './entity-index.js';
export { decodeHtmlCharacterReferences } from './html-entities.js';
export {
  defaultMaxTotalAssetBytes,
  loadQuestionBank,
  type LoadOptions,
  type ParsedEntity,
  type ParsedQuestionBank,
} from './loader.js';
export {
  DocumentParseError,
  parseMarkdownDocument,
  parseYamlDocument,
  type ParsedMarkdownDocument,
} from './parser.js';
export {
  validateQuestionBank,
  validateQuestionBankDirectory,
  type DirectoryValidationOptions,
  type ValidationOptions,
  type ValidationResult,
  type ValidationMode,
} from './validation.js';
export type { QuestionBankData } from './types.js';
