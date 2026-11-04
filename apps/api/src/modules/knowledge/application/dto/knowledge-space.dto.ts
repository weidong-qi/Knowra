import { requireText } from './_shared.ts';

export interface DefaultKnowledgeSpaceDto {
  id: string;
  userId: string;
  name: string;
  description: string;
}

// 只描述原参数实际读取的字段；不是 DTO 验证后的对象类型守卫。
export interface DefaultKnowledgeSpaceInput {
  userId?: unknown;
}

export function buildDefaultKnowledgeSpaceDto({ userId }: DefaultKnowledgeSpaceInput = {}): DefaultKnowledgeSpaceDto {
  const normalizedUserId = requireText(userId, 'KNOWLEDGE_SPACE_USER_REQUIRED', 'Knowledge space userId is required');

  return {
    id: `space-${normalizedUserId}`,
    userId: normalizedUserId,
    name: 'Default Space',
    description: 'Primary knowledge space'
  };
}
