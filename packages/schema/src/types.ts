/** 命名空间扩展字段允许的 JSON 值 */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type EntityId = string;
export type SemVer = string;
export type RelativePath = string;
export type QuestionType =
  'single_choice' | 'multiple_choice' | 'true_false' | 'fill_blank' | 'numeric' | 'short_answer';

export type ReviewStatus = 'draft' | 'pending' | 'approved' | 'deprecated';
export type SourceType = 'original' | 'official_public' | 'licensed' | 'adapted' | 'unknown';

export interface SourceInfo {
  type: SourceType;
  title?: string;
  author?: string;
  url?: string;
  license?: string;
  attribution?: string;
}

export interface ReviewInfo {
  status: ReviewStatus;
  reviewer?: string;
  reviewedAt?: string;
  notes?: string;
}

export type Extensions = Record<string, JsonValue>;

export interface BankPaths {
  topics: RelativePath;
  knowledge: RelativePath;
  questions: RelativePath;
  groups: RelativePath;
  exams: RelativePath;
  assets: RelativePath;
}

export interface BankMaintainer {
  name: string;
  email?: string;
  url?: string;
}

export interface Bank {
  schemaVersion: '1.0.0';
  id: EntityId;
  name: string;
  description?: string;
  version: SemVer;
  language: string;
  license: string;
  maintainers: BankMaintainer[];
  examSystem?: string;
  paths: BankPaths;
  extensions?: Extensions;
}

export interface Topic {
  id: EntityId;
  name: string;
  parentId?: EntityId;
  order: number;
  description?: string;
  aliases?: string[];
  extensions?: Extensions;
}

export interface Knowledge {
  id: EntityId;
  title: string;
  body: string;
  topicIds: EntityId[];
  summary?: string;
  prerequisiteIds: EntityId[];
  relatedIds: EntityId[];
  tags: string[];
  assets?: RelativePath[];
  source: SourceInfo;
  review: ReviewInfo;
  extensions?: Extensions;
}

export interface QuestionBase {
  id: EntityId;
  stem: string;
  explanation?: string;
  topicIds: EntityId[];
  knowledgeIds: EntityId[];
  difficulty: string;
  tags: string[];
  score: number;
  source: SourceInfo;
  review: ReviewInfo;
  assets?: RelativePath[];
  extensions?: Extensions;
}

export interface Choice {
  id: EntityId;
  text: string;
}

export interface SingleChoiceQuestion extends QuestionBase {
  type: 'single_choice';
  choices: Choice[];
  answer: { choiceId: EntityId };
}

export interface MultipleChoiceQuestion extends QuestionBase {
  type: 'multiple_choice';
  choices: Choice[];
  answer: { choiceIds: EntityId[] };
}

export interface TrueFalseQuestion extends QuestionBase {
  type: 'true_false';
  answer: boolean;
}

export interface FillBlankQuestion extends QuestionBase {
  type: 'fill_blank';
  answer: {
    blanks: Array<{
      id: EntityId;
      acceptedAnswers: string[];
      caseSensitive?: boolean;
      whitespace?: 'exact' | 'trim' | 'collapse';
    }>;
  };
}

export type DecimalString = string;

export interface NumericQuestion extends QuestionBase {
  type: 'numeric';
  answer: { value: DecimalString; unit?: string };
  tolerance?: { absolute?: DecimalString; relative?: DecimalString };
  unitRule?: {
    mode: 'required' | 'optional' | 'ignored';
    acceptedUnits?: string[];
  };
}

export interface ShortAnswerQuestion extends QuestionBase {
  type: 'short_answer';
  answer: {
    referenceAnswer: string;
    rubric?: Array<{ id: EntityId; description: string; score: number }>;
  };
}

export type Question =
  | SingleChoiceQuestion
  | MultipleChoiceQuestion
  | TrueFalseQuestion
  | FillBlankQuestion
  | NumericQuestion
  | ShortAnswerQuestion;

export interface QuestionGroup {
  id: EntityId;
  title: string;
  passage: string;
  questionIds: EntityId[];
  topicIds: EntityId[];
  tags?: string[];
  assets?: RelativePath[];
  source: SourceInfo;
  review: ReviewInfo;
  extensions?: Extensions;
}

export interface ExamQuestionItem {
  kind: 'question';
  questionId: EntityId;
  score: number;
}

export interface ExamGroupItem {
  kind: 'group';
  groupId: EntityId;
  questions: ExamQuestionItem[];
}

export type ExamItem = ExamQuestionItem | ExamGroupItem;

export interface ExamBase {
  id: EntityId;
  title: string;
  description?: string;
  durationMinutes?: number;
  extensions?: Extensions;
}

export interface FixedExam extends ExamBase {
  mode: 'fixed';
  items: ExamItem[];
}

export interface SelectionRule {
  unit: 'question' | 'group';
  count: number;
  scorePerQuestion: number;
  filters?: {
    topicIds?: EntityId[];
    questionTypes?: QuestionType[];
    difficulty?: string;
  };
}

export interface GeneratedExamTemplate extends ExamBase {
  mode: 'generated';
  kind: 'template';
  rules: SelectionRule[];
}

export interface GeneratedExamResult extends ExamBase {
  mode: 'generated';
  kind: 'result';
  items: ExamItem[];
  randomSeed: string;
  bankVersion: SemVer;
  algorithmVersion: SemVer;
}

export type Exam = FixedExam | GeneratedExamTemplate | GeneratedExamResult;

export type BankEntity = Bank | Topic | Knowledge | Question | QuestionGroup | Exam;
