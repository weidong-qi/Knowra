-- 概念三类记录整条同步；引用与唯一性在同一事务内由共享规则校验。
CREATE TABLE "KnowledgeConcept" ("id" TEXT NOT NULL PRIMARY KEY, "data" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "KnowledgeConceptLink" ("id" TEXT NOT NULL PRIMARY KEY, "data" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "KnowledgeConceptRelation" ("id" TEXT NOT NULL PRIMARY KEY, "data" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL);
