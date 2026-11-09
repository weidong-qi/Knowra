-- 个人待办首版：整条记录以 JSONB 保存，字段与结构规则由应用层（web-core personal-todos）校验。
-- 记录参与原子实体同步（personal-todos-v1）；删除为软删除，记录保留 deletedAt。
CREATE TABLE IF NOT EXISTS "PersonalTodo" (
    "id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PersonalTodo_pkey" PRIMARY KEY ("id")
);
