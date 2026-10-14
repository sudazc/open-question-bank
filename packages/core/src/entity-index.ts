import type {
  Bank,
  EntityId,
  Exam,
  Knowledge,
  Question,
  QuestionGroup,
  Topic,
} from '@openquestionbank/schema';
import type { QuestionBankData } from './types.js';

export interface EntityIndex {
  bank?: Bank;
  topicsById: ReadonlyMap<EntityId, Topic>;
  knowledgeById: ReadonlyMap<EntityId, Knowledge>;
  questionsById: ReadonlyMap<EntityId, Question>;
  groupsById: ReadonlyMap<EntityId, QuestionGroup>;
  examsById: ReadonlyMap<EntityId, Exam>;
  topicChildren: ReadonlyMap<EntityId, readonly Topic[]>;
  knowledgeByTopic: ReadonlyMap<EntityId, readonly Knowledge[]>;
  questionsByTopic: ReadonlyMap<EntityId, readonly Question[]>;
  questionsByKnowledge: ReadonlyMap<EntityId, readonly Question[]>;
  knowledgeByQuestion: ReadonlyMap<EntityId, readonly Knowledge[]>;
  dependentsByPrerequisite: ReadonlyMap<EntityId, readonly Knowledge[]>;
  groupByQuestion: ReadonlyMap<EntityId, QuestionGroup>;
  questionsByGroup: ReadonlyMap<EntityId, readonly Question[]>;
  examsByQuestion: ReadonlyMap<EntityId, readonly Exam[]>;
  examsByGroup: ReadonlyMap<EntityId, readonly Exam[]>;
}

/** 从结构有效的实体创建按 ID 和双向关联查询的索引 */
export function buildEntityIndex(data: QuestionBankData): EntityIndex {
  const topics = uniqueById(data.topics);
  const knowledge = uniqueById(data.knowledge);
  const questions = uniqueById(data.questions);
  const groups = uniqueById(data.groups);
  const exams = uniqueById(data.exams);
  const topicsById = toMap(topics);
  const knowledgeById = toMap(knowledge);
  const questionsById = toMap(questions);
  const groupsById = toMap(groups);
  const examsById = toMap(exams);
  const topicChildren = new Map<EntityId, Topic[]>();
  const knowledgeByTopic = new Map<EntityId, Knowledge[]>();
  const questionsByTopic = new Map<EntityId, Question[]>();
  const questionsByKnowledge = new Map<EntityId, Question[]>();
  const knowledgeByQuestion = new Map<EntityId, Knowledge[]>();
  const dependentsByPrerequisite = new Map<EntityId, Knowledge[]>();
  const groupByQuestion = new Map<EntityId, QuestionGroup>();
  const questionsByGroup = new Map<EntityId, Question[]>();
  const examsByQuestion = new Map<EntityId, Exam[]>();
  const examsByGroup = new Map<EntityId, Exam[]>();

  for (const topic of topics) {
    if (topic.parentId && topicsById.has(topic.parentId)) {
      addToBucket(topicChildren, topic.parentId, topic);
    }
  }
  for (const note of knowledge) {
    for (const topicId of note.topicIds) {
      if (topicsById.has(topicId)) {
        addToBucket(knowledgeByTopic, topicId, note);
      }
    }
    for (const prerequisiteId of note.prerequisiteIds) {
      if (knowledgeById.has(prerequisiteId)) {
        addToBucket(dependentsByPrerequisite, prerequisiteId, note);
      }
    }
  }
  for (const question of questions) {
    for (const topicId of question.topicIds) {
      if (topicsById.has(topicId)) {
        addToBucket(questionsByTopic, topicId, question);
      }
    }
    for (const knowledgeId of question.knowledgeIds) {
      const note = knowledgeById.get(knowledgeId);
      if (note) {
        addToBucket(questionsByKnowledge, knowledgeId, question);
        addToBucket(knowledgeByQuestion, question.id, note);
      }
    }
  }
  for (const group of groups) {
    const members: Question[] = [];
    for (const questionId of group.questionIds) {
      const question = questionsById.get(questionId);
      if (question) {
        members.push(question);
        if (!groupByQuestion.has(questionId)) {
          groupByQuestion.set(questionId, group);
        }
      }
    }
    questionsByGroup.set(group.id, members);
  }
  for (const exam of exams) {
    if (!('items' in exam)) {
      continue;
    }
    for (const item of exam.items) {
      if (item.kind === 'question') {
        if (questionsById.has(item.questionId)) {
          addToBucket(examsByQuestion, item.questionId, exam);
        }
        continue;
      }
      if (groupsById.has(item.groupId)) {
        addToBucket(examsByGroup, item.groupId, exam);
      }
      for (const question of item.questions) {
        if (questionsById.has(question.questionId)) {
          addToBucket(examsByQuestion, question.questionId, exam);
        }
      }
    }
  }

  return {
    ...(data.bank === undefined ? {} : { bank: data.bank }),
    topicsById,
    knowledgeById,
    questionsById,
    groupsById,
    examsById,
    topicChildren,
    knowledgeByTopic,
    questionsByTopic,
    questionsByKnowledge,
    knowledgeByQuestion,
    dependentsByPrerequisite,
    groupByQuestion,
    questionsByGroup,
    examsByQuestion,
    examsByGroup,
  };
}

function toMap<T extends { id: EntityId }>(values: readonly T[]): Map<EntityId, T> {
  return new Map(values.map((value) => [value.id, value]));
}

function uniqueById<T extends { id: EntityId }>(values: readonly T[]): T[] {
  const seen = new Set<EntityId>();
  return values.filter((value) => {
    if (seen.has(value.id)) {
      return false;
    }
    seen.add(value.id);
    return true;
  });
}

function addToBucket<T>(map: Map<EntityId, T[]>, id: EntityId, value: T): void {
  const bucket = map.get(id);
  if (bucket) {
    bucket.push(value);
  } else {
    map.set(id, [value]);
  }
}
