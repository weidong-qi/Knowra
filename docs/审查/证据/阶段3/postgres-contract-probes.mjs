// 纯契约复现：stub 仓储，无 PostgreSQL 连接，不声称实库集成通过。
import assert from 'node:assert/strict';
import { createEmptyLocalState, validateLocalSnapshot } from '../../../../apps/api/src/infrastructure/local-data-schema.js';
import { createPostgresSnapshotService } from '../../../../apps/api/src/infrastructure/postgres-snapshot-service.js';
import { buildJsonMigrationPlan } from '../../../../apps/api/src/infrastructure/migration/json-to-postgres.js';
import { isPostgresMutation } from '../../../../apps/api/src/infrastructure/postgres-advisory-lock.ts';
const data=createEmptyLocalState();
data.spaces=[{id:'space-review',userId:'review',name:'Review'}];
data.tagGroups=[{id:'custom-review',spaceId:'space-review',name:'Custom',selectionMode:'multiple'}];
data.tags=[{id:'tag-review',spaceId:'space-review',name:'Tag',groupId:'custom-review'}];
const mapping={knowledgeSpace:'spaces',folder:'folders',tag:'tags',tagGroup:'tagGroups',note:'notes',noteVersion:'noteVersions',contentAnnotation:'contentAnnotations',knowledgeItem:'knowledgeItems',knowledgeEvidence:'knowledgeEvidence',learningObjective:'learningObjectives',examProfile:'examProfiles',examFocus:'examFocuses',question:'questions',questionObjective:'questionObjectives',questionSource:'questionSources'};
const repositories=Object.fromEntries(Object.entries(mapping).map(([k,v])=>[k+'Repository',{list:async()=>data[v],listByQuestionIds:async()=>data[v]}]));
const service=createPostgresSnapshotService({client:{$transaction(){}},repositories,attachmentStore:{listAttachments:async()=>[],exportAttachmentsSnapshot:async()=>[]}});
const snapshot=await service.exportKnowledgeBase();
assert.equal(snapshot.data.tagGroups,undefined);
let error;try{validateLocalSnapshot(snapshot);}catch(e){error=e;}
assert.ok(error);
const migration=buildJsonMigrationPlan({input:{schemaVersion:4,data},ownerId:'review'});
assert.equal(migration.canApply,true);assert.equal(migration.plan.tagGroups,undefined);assert.equal(migration.plan.tags[0].groupId,'custom-review');
assert.equal(isPostgresMutation('mergeTags'),false);assert.equal(isPostgresMutation('reorderTags'),false);
console.log(JSON.stringify({kind:'stub repositories and pure migration plan; no real database',results:[{id:'S3-06',exportOmitsTagGroups:true,exportCannotValidate:error.message,migrationCanApply:migration.canApply,migrationOmitsTagGroups:true},{id:'S3-07',mergeTagsClassifiedAsMutation:false,reorderTagsClassifiedAsMutation:false,concurrencyOutcome:'not exercised'}]},null,2));
