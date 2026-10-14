import type {
  Bank,
  Exam,
  Knowledge,
  Question,
  QuestionGroup,
  Topic,
} from '@openquestionbank/schema';

export interface LocatedEntity<T> {
  value: T;
  file: string;
}

export interface LocatedQuestionBank {
  bank?: LocatedEntity<Bank>;
  topics: LocatedEntity<Topic>[];
  knowledge: LocatedEntity<Knowledge>[];
  questions: LocatedEntity<Question>[];
  groups: LocatedEntity<QuestionGroup>[];
  exams: LocatedEntity<Exam>[];
}

export interface QuestionBankData {
  bank?: Bank;
  topics: Topic[];
  knowledge: Knowledge[];
  questions: Question[];
  groups: QuestionGroup[];
  exams: Exam[];
}
