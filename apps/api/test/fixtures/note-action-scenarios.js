import assert from 'node:assert/strict';
import { calculateContentHash } from '../../src/modules/knowledge/domain/note-version.ts';
import { randomUUID } from 'node:crypto';
import { hashRecord } from '../../src/modules/ai/record-contract.ts';
import { finalizePlan } from '../../src/modules/ai/action-plan.ts';
import { validateActionState } from '../../src/modules/ai/action-state.ts';

export function noteActionScenarios(withFixture) {
  return [
    {
      name: '记录助手个人回答绑定完整消息来源、独立请求及发送清单，私密化后前向隔离',
      run: () =>
        withFixture(async f => {
          const source = await f.create({ title: '消息来源', rawMarkdown: '合成个人来源原文' });
          const conversation = await f.conversations.createConversation({
            ownerId: f.ownerId,
            actorId: f.ownerId,
            spaceId: f.space.id
          });
          const policy = await f.access.createPolicy({
            spaceId: f.space.id,
            scope: { kind: 'library' },
            excludedNoteIds: [],
            includeAttachments: false,
            read: true,
            egress: true,
            recipients: ['deepseek'],
            expiresAt: new Date(Date.now() + 86400000).toISOString()
          });
          const submitted = await f.conversations.submitTurn({
            ownerId: f.ownerId,
            conversationId: conversation.conversationId,
            content: '个人资料问答',
            idempotencyKey: randomUUID(),
            requestedPolicyId: policy.policyId
          });
          const turn = await f.conversations.claimTurn(submitted.turnId);
          const grant = await f.access.createRunGrant({
            policyId: policy.policyId,
            conversationId: conversation.conversationId
          });
          const { manifest } = await f.access.prepareRequest({
            grantId: grant.grantId,
            recipient: 'deepseek',
            modelId: 'synthetic',
            credentialRef: 'synthetic',
            userMessage: '合成问题',
            sourceRanges: [{ noteId: source.id, start: 0, end: source.rawMarkdown.length }]
          });
          const { message } = await f.conversations.completeTurn(turn.turnId, turn.leaseGeneration, {
            content: '个人问答合成回答',
            sourceRefs: manifest.sources,
            provenanceManifestId: manifest.manifestId
          });
          const input = {
            spaceId: f.space.id,
            requestId: randomUUID(),
            toolName: 'notes_create',
            arguments: { title: '记录助手回答', rawMarkdown: message.content },
            sourceMessageId: message.messageId,
            conversationId: conversation.conversationId
          };
          const action = await f.actions.plan(input),
            binding = action.plan.provenance;
          assert.equal(action.requestId, input.requestId);
          assert.notEqual(action.requestId, turn.turnId);
          assert.equal(action.grant.originTurnId, undefined);
          assert.equal(binding.sourceKind, 'assistantMessage');
          assert.equal(binding.policyId, policy.policyId);
          assert.equal(binding.policyRevision, policy.revision);
          assert.deepEqual(binding.sourceRefs, manifest.sources);
          assert.equal(binding.provenanceManifestId, manifest.manifestId);
          assert.equal(binding.manifestHash, hashRecord(manifest));
          assert.deepEqual(await f.actions.plan(input), action);
          await f.restart();
          await f.update(source.id, { aiVisibility: 'private' });
          await assert.rejects(f.actions.plan(input), { code: 'AI_SCOPE_FORBIDDEN' });
          await assert.rejects(f.actions.plan({ ...input, requestId: randomUUID() }), { code: 'AI_SCOPE_FORBIDDEN' });
          await assert.rejects(
            f.actions.repreview(action.actionId, { planHash: action.plan.planHash, requestId: randomUUID() }),
            { code: 'AI_SCOPE_FORBIDDEN' }
          );
          await assert.rejects(
            f.actions.revise(action.actionId, {
              planHash: action.plan.planHash,
              requestId: randomUUID(),
              arguments: { title: '记录助手回答', rawMarkdown: '持续修订' }
            }),
            { code: 'AI_SCOPE_FORBIDDEN' }
          );
          await f.actions.approve(action.actionId, { planHash: action.plan.planHash });
          await assert.rejects(f.actions.apply(action.actionId), { code: 'AI_SCOPE_FORBIDDEN' });
          assert.equal((await f.actions.listInbox(f.space.id))[0].plan.items[0].after.rawMarkdown, message.content);
          assert.equal((await f.notes()).length, 1);
        })
    },
    {
      name: '助手消息另存复核撤权和过期，缺失来源旧稿拒绝；纯手工与无来源回答可采纳',
      run: () =>
        withFixture(async f => {
          const source = await f.create({ title: '政策来源', rawMarkdown: '合成来源' });
          const conversation = await f.conversations.createConversation({
            ownerId: f.ownerId,
            actorId: f.ownerId,
            spaceId: f.space.id
          });
          const policy = await f.access.createPolicy({
            spaceId: f.space.id,
            scope: { kind: 'library' },
            excludedNoteIds: [],
            includeAttachments: false,
            read: true,
            egress: true,
            recipients: ['deepseek'],
            expiresAt: new Date(Date.now() + 86400000).toISOString()
          });
          const submitted = await f.conversations.submitTurn({
            ownerId: f.ownerId,
            conversationId: conversation.conversationId,
            content: '资料问答',
            idempotencyKey: randomUUID(),
            requestedPolicyId: policy.policyId
          });
          const turn = await f.conversations.claimTurn(submitted.turnId),
            grant = await f.access.createRunGrant({
              policyId: policy.policyId,
              conversationId: conversation.conversationId
            });
          const { manifest } = await f.access.prepareRequest({
            grantId: grant.grantId,
            recipient: 'deepseek',
            modelId: 'synthetic',
            credentialRef: 'synthetic',
            userMessage: '合成问题',
            sourceRanges: [{ noteId: source.id, start: 0, end: source.rawMarkdown.length }]
          });
          const { message } = await f.conversations.completeTurn(turn.turnId, turn.leaseGeneration, {
            content: '有来源回答',
            sourceRefs: manifest.sources,
            provenanceManifestId: manifest.manifestId
          });
          const input = {
            spaceId: f.space.id,
            requestId: randomUUID(),
            toolName: 'notes_create',
            arguments: { title: '另存来源答案', rawMarkdown: message.content },
            sourceMessageId: message.messageId,
            conversationId: conversation.conversationId
          };
          const action = await f.actions.plan(input),
            old = await f.actions.plan({ ...input, requestId: randomUUID() });
          await f.actionStore.write(state => {
            const row = state.actions.find(row => row.actionId === old.actionId);
            const { planHash: _hash, ...content } = row.plan;
            content.provenance = {
              conversationId: conversation.conversationId,
              messageId: message.messageId,
              turnId: message.turnId,
              contentHash: hashRecord(message.content)
            };
            row.plan = finalizePlan(content);
          });
          const legacy = await f.actions.get(old.actionId);
          await f.actions.approve(old.actionId, { planHash: legacy.plan.planHash });
          await assert.rejects(f.actions.apply(old.actionId), { code: 'AI_ACTION_GRANT_REVOKED' });
          f.advance(2 * 86400000);
          await assert.rejects(
            f.actions.repreview(action.actionId, { planHash: action.plan.planHash, requestId: randomUUID() }),
            { code: 'AI_ACTION_GRANT_REVOKED' }
          );
          f.advance(-2 * 86400000);
          await f.access.narrowPolicy(policy.policyId, { revision: policy.revision, revoke: true });
          await assert.rejects(
            f.actions.repreview(action.actionId, { planHash: action.plan.planHash, requestId: randomUUID() }),
            { code: 'AI_ACTION_GRANT_REVOKED' }
          );
          await assert.rejects(f.actions.plan({ ...input, requestId: randomUUID() }), {
            code: 'AI_ACTION_GRANT_REVOKED'
          });
          const plainInput = await f.conversations.submitTurn({
              ownerId: f.ownerId,
              conversationId: conversation.conversationId,
              content: '纯写作',
              idempotencyKey: randomUUID()
            }),
            plainTurn = await f.conversations.claimTurn(plainInput.turnId);
          const { message: plain } = await f.conversations.completeTurn(plainTurn.turnId, plainTurn.leaseGeneration, {
            content: '无个人来源的写作回答',
            sourceFree: true
          });
          const plainAction = await f.actions.plan({
            spaceId: f.space.id,
            requestId: randomUUID(),
            toolName: 'notes_create',
            arguments: { title: '无来源回答', rawMarkdown: plain.content },
            sourceMessageId: plain.messageId,
            conversationId: conversation.conversationId
          });
          const manual = await f.actions.plan({
            spaceId: f.space.id,
            requestId: randomUUID(),
            toolName: 'notes_create',
            arguments: { title: '手工稿', rawMarkdown: '用户独立输入' }
          });
          await f.restart();
          for (const row of [plainAction, manual]) {
            await f.actions.approve(row.actionId, { planHash: row.plan.planHash });
            await f.actions.apply(row.actionId);
          }
          assert.equal((await f.notes()).length, 3);
        })
    },
    {
      name: '成果已落盘而工具结果未落盘：新稿和修订重启精确重放、不刷新预览并可唯一采纳',
      run: () =>
        withFixture(async f => {
          const conversation = await f.conversations.createConversation({
            ownerId: f.ownerId,
            actorId: f.ownerId,
            spaceId: f.space.id
          });
          const stage = async (content, args) => {
            const submitted = await f.conversations.submitTurn({
              ownerId: f.ownerId,
              conversationId: conversation.conversationId,
              content,
              idempotencyKey: randomUUID()
            });
            const turn = await f.conversations.claimTurn(submitted.turnId),
              callId = randomUUID();
            const call = await f.conversations.appendToolCall(turn.turnId, turn.leaseGeneration, {
              callId,
              toolName: 'notes_create',
              argumentsJson: args
            });
            const action = await f.actions.planForAssistantTurn(turn, {
              name: call.toolName,
              arguments: call.argumentsJson
            });
            const settle = f.conversations.settleToolCall;
            f.conversations.settleToolCall = async () => {
              throw new Error('工具结果写盘失败');
            };
            await assert.rejects(
              f.conversations.settleToolCall(turn.turnId, turn.leaseGeneration, callId, {
                resultJson: { actionId: action.actionId }
              }),
              /工具结果写盘失败/
            );
            f.conversations.settleToolCall = settle;
            assert.equal((await f.conversations.listToolCalls(turn.turnId))[0].status, 'requested');
            await f.conversations.failTurn(turn.turnId, turn.leaseGeneration, 'AI_SYNTHETIC_INTERRUPTED');
            await f.restart();
            const resumed = await f.conversations.claimTurn(turn.turnId),
              persisted = (await f.conversations.listToolCalls(turn.turnId))[0];
            await assert.rejects(
              f.actions.planForAssistantTurn(resumed, {
                name: persisted.toolName,
                arguments: { ...persisted.argumentsJson, rawMarkdown: '篡改重试' }
              }),
              { code: 'AI_IDEMPOTENCY_CONFLICT' }
            );
            const replayed = await f.actions.planForAssistantTurn(resumed, {
              name: persisted.toolName,
              arguments: persisted.argumentsJson
            });
            assert.equal(replayed.actionId, action.actionId);
            assert.deepEqual(replayed.plan, action.plan);
            assert.equal(replayed.expiresAt, action.expiresAt);
            assert.equal(replayed.inboxEvents?.length ?? 0, action.inboxEvents?.length ?? 0);
            await f.conversations.settleToolCall(resumed.turnId, resumed.leaseGeneration, callId, {
              resultJson: { actionId: replayed.actionId, planHash: replayed.plan.planHash }
            });
            await f.conversations.completeTurn(resumed.turnId, resumed.leaseGeneration, {
              content: '成果可审阅',
              sourceFree: true
            });
            return { action: replayed, turn: resumed };
          };
          const first = await stage('生成笔记新稿', { title: '落盘间隙草稿', rawMarkdown: '第一稿' });
          assert.equal(first.action.grant.originGeneration, first.turn.leaseGeneration);
          const second = await stage('短一点', {
            actionId: first.action.actionId,
            title: '落盘间隙草稿',
            rawMarkdown: '第二稿'
          });
          assert.equal(second.action.inboxEvents[0].originGeneration, second.turn.leaseGeneration);
          assert.equal((await f.actions.listInbox(f.space.id)).length, 1);
          await f.actions.approve(second.action.actionId, { planHash: second.action.plan.planHash });
          const result = await f.actions.apply(second.action.actionId);
          await f.restart();
          assert.deepEqual((await f.actions.apply(second.action.actionId)).receipt, result.receipt);
          assert.equal((await f.notes()).length, 1);
          assert.equal((await f.getNote(second.action.plan.items[0].after.id)).rawMarkdown, '第二稿');
        })
    },
    {
      name: '明确写入意图同样绑定个人来源；私密转换和旧模型无来源记录拒绝采纳',
      run: () =>
        withFixture(async f => {
          const source = await f.create({ title: '合成来源', rawMarkdown: '仅普通笔记允许读取' });
          const conversation = await f.conversations.createConversation({
            ownerId: f.ownerId,
            actorId: f.ownerId,
            spaceId: f.space.id
          });
          const policy = await f.access.createPolicy({
            spaceId: f.space.id,
            scope: { kind: 'library' },
            excludedNoteIds: [],
            includeAttachments: false,
            read: true,
            egress: true,
            recipients: ['deepseek'],
            expiresAt: new Date(Date.now() + 86400000).toISOString()
          });
          const grant = await f.access.createRunGrant({
            policyId: policy.policyId,
            conversationId: conversation.conversationId
          });
          const verified = await f.access.verifyRead({ grantId: grant.grantId, noteId: source.id });
          const refs = [
            {
              noteId: source.id,
              noteVersionId: verified.version.id,
              contentHash: verified.contentHash,
              start: 0,
              end: source.rawMarkdown.length,
              quoteHash: calculateContentHash(source.rawMarkdown)
            }
          ];
          const create = async () => {
            const submitted = await f.conversations.submitTurn({
              ownerId: f.ownerId,
              conversationId: conversation.conversationId,
              content: '根据笔记生成总结',
              idempotencyKey: randomUUID(),
              requestedPolicyId: policy.policyId,
              writeIntent: { toolName: 'notes_create' }
            });
            const turn = await f.conversations.claimTurn(submitted.turnId);
            const action = await f.actions.planForTurn(
              turn,
              turn.writeIntent,
              { name: 'notes_create', arguments: { title: '来源派生草稿', rawMarkdown: source.rawMarkdown } },
              { sourceRefs: refs, grantId: grant.grantId }
            );
            await f.conversations.completeTurn(turn.turnId, turn.leaseGeneration, {
              content: '已生成草稿',
              sourceFree: true
            });
            return action;
          };
          const action = await create(),
            legacy = await create();
          assert.deepEqual(action.grant.sourceRefs, refs);
          await f.actionStore.write(state => {
            delete state.actions.find(row => row.actionId === legacy.actionId).grant.sourceRefs;
          });
          await f.restart();
          await f.actions.approve(legacy.actionId, { planHash: legacy.plan.planHash });
          await assert.rejects(f.actions.apply(legacy.actionId), { code: 'AI_ACTION_GRANT_REVOKED' });
          await f.update(source.id, { aiVisibility: 'private' });
          await f.actions.approve(action.actionId, { planHash: action.plan.planHash });
          await assert.rejects(f.actions.apply(action.actionId), { code: 'AI_SCOPE_FORBIDDEN' });
          await assert.rejects(
            f.actions.repreview(action.actionId, { planHash: action.plan.planHash, requestId: randomUUID() }),
            { code: 'AI_SCOPE_FORBIDDEN' }
          );
          await assert.rejects(
            f.actions.revise(action.actionId, {
              planHash: action.plan.planHash,
              requestId: randomUUID(),
              arguments: { title: '来源派生草稿', rawMarkdown: '修改派生稿' }
            }),
            { code: 'AI_SCOPE_FORBIDDEN' }
          );
          assert.equal((await f.actions.listInbox(f.space.id)).length, 2);
          assert.equal((await f.notes()).length, 1);
        })
    },
    {
      name: '自主成果与对话修订在恢复后重绑 generation，取消修订拒绝采纳',
      run: () =>
        withFixture(async f => {
          const conversation = await f.conversations.createConversation({
            ownerId: f.ownerId,
            actorId: f.ownerId,
            spaceId: f.space.id
          });
          const submitted = await f.conversations.submitTurn({
            ownerId: f.ownerId,
            conversationId: conversation.conversationId,
            content: '生成周总结',
            idempotencyKey: randomUUID()
          });
          const turn = await f.conversations.claimTurn(submitted.turnId);
          const action = await f.actions.planForAssistantTurn(turn, {
            name: 'notes_create',
            arguments: { title: '自主草稿', rawMarkdown: '第一版' }
          });
          assert.equal(action.grant.autonomousOrigin, true);
          assert.deepEqual(action.grant.sourceRefs, []);
          await f.conversations.failTurn(turn.turnId, turn.leaseGeneration, 'AI_SYNTHETIC_INTERRUPTED');
          await f.restart();
          const resumed = await f.conversations.claimTurn(turn.turnId);
          const rebound = await f.actions.resumeForTurn(action.actionId, resumed);
          assert.equal(rebound.grant.originGeneration, resumed.leaseGeneration);
          await f.conversations.completeTurn(turn.turnId, resumed.leaseGeneration, {
            content: '已生成草稿',
            sourceFree: true
          });
          const revisionInput = await f.conversations.submitTurn({
            ownerId: f.ownerId,
            conversationId: conversation.conversationId,
            content: '简短一点',
            idempotencyKey: randomUUID()
          });
          const revisionTurn = await f.conversations.claimTurn(revisionInput.turnId);
          const revised = await f.actions.planForAssistantTurn(revisionTurn, {
            name: 'notes_create',
            arguments: { actionId: action.actionId, title: '自主草稿', rawMarkdown: '短稿' }
          });
          assert.equal(revised.actionId, action.actionId);
          assert.equal(revised.inboxEvents[0].originTurnId, revisionTurn.turnId);
          await f.conversations.failTurn(revisionTurn.turnId, revisionTurn.leaseGeneration, 'AI_SYNTHETIC_INTERRUPTED');
          await f.restart();
          const revisionResume = await f.conversations.claimTurn(revisionTurn.turnId);
          await f.actions.resumeForTurn(action.actionId, revisionResume);
          await f.conversations.completeTurn(revisionResume.turnId, revisionResume.leaseGeneration, {
            content: '已缩短草稿',
            sourceFree: true
          });
          await f.actions.approve(action.actionId, { planHash: revised.plan.planHash });
          await f.actions.apply(action.actionId);
          assert.equal((await f.getNote(action.plan.items[0].after.id)).rawMarkdown, '短稿');
          const otherInput = await f.conversations.submitTurn({
            ownerId: f.ownerId,
            conversationId: conversation.conversationId,
            content: '另一草稿',
            idempotencyKey: randomUUID()
          });
          const otherTurn = await f.conversations.claimTurn(otherInput.turnId);
          const other = await f.actions.planForAssistantTurn(otherTurn, {
            name: 'notes_create',
            arguments: { title: '取消结果', rawMarkdown: '不采纳' }
          });
          await f.conversations.cancelTurn(otherTurn.turnId);
          await f.actions.approve(other.actionId, { planHash: other.plan.planHash });
          await assert.rejects(f.actions.apply(other.actionId), { code: 'AI_ACTION_GRANT_REVOKED' });
        })
    },
    {
      name: '成果收件箱跨重启保留新稿、修订同目标，明确采纳与重复响应唯一提交',
      run: () =>
        withFixture(async f => {
          assert.deepEqual(await f.actions.listInbox(f.space.id), []);
          const row = await f.actions.plan({
            spaceId: f.space.id,
            requestId: randomUUID(),
            toolName: 'notes_create',
            arguments: { title: '周总结草稿', rawMarkdown: '第一版' }
          });
          assert.equal((await f.notes()).length, 0);
          await f.actions.approve(row.actionId, { planHash: row.plan.planHash });
          const input = {
            planHash: row.plan.planHash,
            requestId: randomUUID(),
            arguments: { title: '周总结草稿', rawMarkdown: '对话修订第二版' }
          };
          const revised = await f.actions.revise(row.actionId, input);
          assert.equal(revised.actionId, row.actionId);
          assert.equal(revised.plan.items[0].after.id, row.plan.items[0].after.id);
          assert.equal(revised.operationId, row.operationId);
          assert.equal(revised.approval, null);
          assert.deepEqual(await f.actions.revise(row.actionId, input), revised);
          await assert.rejects(
            f.actions.revise(row.actionId, { ...input, arguments: { ...input.arguments, rawMarkdown: '不同重试' } }),
            { code: 'AI_IDEMPOTENCY_CONFLICT' }
          );
          await assert.rejects(f.actions.apply(row.actionId), { code: 'AI_ACTION_APPROVAL_REQUIRED' });
          await f.restart();
          const [restored] = await f.actions.listInbox(f.space.id);
          assert.equal(restored.plan.items[0].after.rawMarkdown, '对话修订第二版');
          assert.equal(restored.revision, 2);
          assert.equal(restored.draftRetrieval, 'excluded');
          await f.actions.approve(row.actionId, { planHash: revised.plan.planHash });
          const result = await f.actions.apply(row.actionId);
          await f.restart();
          assert.deepEqual((await f.actions.apply(row.actionId)).receipt, result.receipt);
          assert.equal((await f.notes()).length, 1);
          assert.equal((await f.getNote(row.plan.items[0].after.id)).rawMarkdown, '对话修订第二版');
        })
    },
    {
      name: '长期待审显式重新授权保留原 ID 和 CAS，旧批准与重复延期不能生效',
      run: () =>
        withFixture(async f => {
          const row = await f.actions.plan({
            spaceId: f.space.id,
            requestId: randomUUID(),
            toolName: 'notes_create',
            arguments: { title: '长期草稿', rawMarkdown: '等待审阅' }
          });
          await f.actions.approve(row.actionId, { planHash: row.plan.planHash });
          f.advance(7 * 86400000);
          await f.restart();
          assert.equal((await f.actions.listInbox(f.space.id))[0].reauthorizationRequired, true);
          await assert.rejects(f.actions.apply(row.actionId), { code: 'AI_ACTION_EXPIRED' });
          const input = { planHash: row.plan.planHash, requestId: randomUUID() },
            renewed = await f.actions.repreview(row.actionId, input);
          assert.equal(renewed.actionId, row.actionId);
          assert.deepEqual(renewed.plan, row.plan);
          assert.equal(renewed.approval, null);
          f.advance(60000);
          const retry = await f.actions.repreview(row.actionId, input);
          assert.equal(retry.expiresAt, renewed.expiresAt);
          await assert.rejects(f.actions.apply(row.actionId), { code: 'AI_ACTION_APPROVAL_REQUIRED' });
          await f.actions.approve(row.actionId, { planHash: row.plan.planHash });
          assert.equal((await f.actions.apply(row.actionId)).status, 'applied');
        })
    },
    {
      name: '差异稿修订保留 before 与版本基线；并发变化/私密转换拒绝重新预览和覆盖',
      run: () =>
        withFixture(async f => {
          const note = await f.create({ title: '差异稿目标', rawMarkdown: '原文' });
          const row = await f.actions.plan({
            spaceId: f.space.id,
            requestId: randomUUID(),
            toolName: 'notes_append',
            arguments: { noteId: note.id, rawMarkdown: '第一稿' }
          });
          const revised = await f.actions.revise(row.actionId, {
            planHash: row.plan.planHash,
            requestId: randomUUID(),
            arguments: { noteId: note.id, rawMarkdown: '第二稿' }
          });
          assert.deepEqual(revised.plan.items[0].before, row.plan.items[0].before);
          assert.deepEqual(revised.plan.items[0].baseline, row.plan.items[0].baseline);
          assert.equal(revised.plan.items[0].after.rawMarkdown, '原文第二稿');
          assert.equal((await f.getNote(note.id)).rawMarkdown, '原文');
          await f.update(note.id, { rawMarkdown: '用户后续编辑' });
          await assert.rejects(
            f.actions.repreview(row.actionId, { planHash: revised.plan.planHash, requestId: randomUUID() }),
            { code: 'AI_ACTION_CONFLICT' }
          );
          await f.update(note.id, { aiVisibility: 'private' });
          await assert.rejects(
            f.actions.repreview(row.actionId, { planHash: revised.plan.planHash, requestId: randomUUID() }),
            { code: 'AI_SCOPE_FORBIDDEN' }
          );
          await assert.rejects(
            f.actions.plan({
              spaceId: f.space.id,
              requestId: randomUUID(),
              toolName: 'notes_append',
              arguments: { noteId: note.id, rawMarkdown: '不能读取' }
            }),
            { code: 'AI_SCOPE_FORBIDDEN' }
          );
          assert.equal((await f.actions.listInbox(f.space.id))[0].plan.items[0].after.rawMarkdown, '原文第二稿');
        })
    },
    {
      name: '恢复切换 epoch 后保留同资料集待审成果只读，禁止重新授权修订采纳',
      run: () =>
        withFixture(async f => {
          const action = await f.actions.plan({
            spaceId: f.space.id,
            requestId: randomUUID(),
            toolName: 'notes_create',
            arguments: { title: '恢复前草稿', rawMarkdown: '保留待审' }
          });
          await f.actions.approve(action.actionId, { planHash: action.plan.planHash });
          await f.rotate();
          await f.restart();
          const [restored] = await f.actions.listInbox(f.space.id);
          assert.equal(restored.actionId, action.actionId);
          assert.equal(restored.datasetStale, true);
          assert.equal(restored.plan.items[0].after.rawMarkdown, '保留待审');
          const input = { planHash: action.plan.planHash, requestId: randomUUID() };
          await assert.rejects(f.actions.repreview(action.actionId, input), { code: 'AI_DATASET_STALE' });
          await assert.rejects(
            f.actions.revise(action.actionId, {
              ...input,
              arguments: { title: '恢复前草稿', rawMarkdown: '无权改写' }
            }),
            { code: 'AI_DATASET_STALE' }
          );
          await assert.rejects(f.actions.apply(action.actionId), { code: 'AI_DATASET_STALE' });
          assert.equal((await f.notes()).length, 0);
        })
    },
    {
      name: '旧动作快照兼容普通笔记，修订保持旧 CAS 且私密不能绕过',
      run: () =>
        withFixture(async f => {
          const note = await f.create({ title: '旧动作目标', rawMarkdown: '基线' });
          const action = await f.actions.plan({
            spaceId: f.space.id,
            requestId: randomUUID(),
            toolName: 'notes_append',
            arguments: { noteId: note.id, rawMarkdown: '旧稿' }
          });
          const legacy = await f.actionStore.write(state => {
            const row = state.actions.find(row => row.actionId === action.actionId),
              { planHash: _hash, ...plan } = structuredClone(row.plan);
            for (const item of plan.items) {
              delete item.before.aiVisibility;
              delete item.after.aiVisibility;
              item.baseline.metadataHash = hashRecord({
                title: item.before.title,
                folderId: item.before.folderId,
                tagIds: [...item.before.tagIds].sort(),
                spaceId: item.before.spaceId
              });
            }
            row.plan = finalizePlan(plan);
            return row;
          });
          await f.restart();
          const revised = await f.actions.revise(action.actionId, {
            planHash: legacy.plan.planHash,
            requestId: randomUUID(),
            arguments: { noteId: note.id, rawMarkdown: '新稿' }
          });
          assert.deepEqual(revised.plan.items[0].before, legacy.plan.items[0].before);
          assert.deepEqual(revised.plan.items[0].baseline, legacy.plan.items[0].baseline);
          await f.actions.approve(action.actionId, { planHash: revised.plan.planHash });
          await f.actions.apply(action.actionId);
          assert.equal((await f.getNote(note.id)).rawMarkdown, '基线新稿');
        })
    },
    {
      name: '成果修订历史损坏 fail closed，恢复不允许偷偷改原始基线',
      run: () =>
        withFixture(async f => {
          const note = await f.create({ title: '历史恢复目标', rawMarkdown: '原文' });
          const row = await f.actions.plan({
            spaceId: f.space.id,
            requestId: randomUUID(),
            toolName: 'notes_append',
            arguments: { noteId: note.id, rawMarkdown: 'A' }
          });
          await f.actions.revise(row.actionId, {
            planHash: row.plan.planHash,
            requestId: randomUUID(),
            arguments: { noteId: note.id, rawMarkdown: 'B' }
          });
          const state = await f.actionStore.read();
          state.actions[0].inboxEvents[0].resultPlanHash = 'a'.repeat(64);
          assert.throws(() => validateActionState(state), { code: 'AI_ACTION_STORAGE_INVALID' });
        })
    },
    {
      name: 'P2 固定新建、明确确认、首次输入接纳与重复提交/重启唯一结果',
      run: () =>
        withFixture(async f => {
          const input = {
            spaceId: f.space.id,
            requestId: randomUUID(),
            toolName: 'notes_create',
            arguments: { title: '合成记录', rawMarkdown: '一次记录' }
          };
          const first = await f.actions.plan(input),
            again = await f.actions.plan(input);
          assert.deepEqual(again, first);
          await assert.rejects(
            f.actions.plan({ ...input, arguments: { ...input.arguments, rawMarkdown: '迟到另输出' } }),
            { code: 'AI_IDEMPOTENCY_CONFLICT' }
          );
          await assert.rejects(f.actions.apply(first.actionId), { code: 'AI_ACTION_APPROVAL_REQUIRED' });
          await assert.rejects(f.actions.approve(first.actionId, { planHash: 'a'.repeat(64) }), {
            code: 'AI_ACTION_PLAN_CHANGED'
          });
          await f.actions.approve(first.actionId, { planHash: first.plan.planHash });
          const [a, b] = await Promise.all([f.actions.apply(first.actionId), f.actions.apply(first.actionId)]);
          assert.equal(a.status, 'applied');
          assert.deepEqual(a.receipt, b.receipt);
          await f.restart();
          assert.deepEqual((await f.actions.apply(first.actionId)).receipt, a.receipt);
          assert.equal((await f.notes()).length, 1);
          assert.equal((await f.actions.cancel(first.actionId)).cancellation, 'alreadyCommitted');
        })
    },
    {
      name: 'P2 正文/元数据/草稿/取消/过期与恢复 epoch 均阻止迟到写入',
      run: () =>
        withFixture(async f => {
          const note = await f.create({ title: '并发目标', rawMarkdown: '原文😀' });
          const make = async () => {
            const row = await f.actions.plan({
              spaceId: f.space.id,
              requestId: randomUUID(),
              toolName: 'notes_append',
              arguments: { noteId: note.id, rawMarkdown: '\n追加' }
            });
            await f.actions.approve(row.actionId, { planHash: row.plan.planHash });
            return row;
          };
          const row = await make();
          await f.update(note.id, { title: '并发改名' });
          await assert.rejects(f.actions.apply(row.actionId), { code: 'AI_ACTION_CONFLICT' });
          const draft = await make();
          await f.actions.draft({ noteId: note.id, clientId: 'other-tab', dirty: true });
          await assert.rejects(f.actions.apply(draft.actionId), { code: 'AI_ACTION_DRAFT_CONFLICT' });
          assert.equal((await f.getNote(note.id)).rawMarkdown, '原文😀');
          await f.actions.draft({ noteId: note.id, clientId: 'other-tab', dirty: false });
          const cancelled = await make();
          await f.actions.cancel(cancelled.actionId);
          await assert.rejects(f.actions.apply(cancelled.actionId), { code: 'AI_ACTION_GRANT_REVOKED' });
          const expired = await make();
          f.advance(31 * 60000);
          await assert.rejects(f.actions.apply(expired.actionId), { code: 'AI_ACTION_EXPIRED' });
          f.advance(-31 * 60000);
          const stale = await make();
          await f.rotate();
          await assert.rejects(f.actions.apply(stale.actionId), { code: 'AI_DATASET_STALE' });
        })
    },
    {
      name: 'P2 精确局部正文、撤销预览与二次确认，后续编辑不被撤销覆盖',
      run: () =>
        withFixture(async f => {
          const note = await f.create({ title: '局部修改', rawMarkdown: '重复\n重复😀\n保留' });
          const row = await f.actions.plan({
            spaceId: f.space.id,
            requestId: randomUUID(),
            toolName: 'notes_propose_patch',
            arguments: { noteId: note.id, replacements: [{ start: 3, end: 5, quote: '重复', replacement: '第二处' }] }
          });
          await f.actions.approve(row.actionId, { planHash: row.plan.planHash });
          await f.actions.apply(row.actionId);
          assert.equal((await f.getNote(note.id)).rawMarkdown, '重复\n第二处😀\n保留');
          const requestId = randomUUID(),
            undo = await f.actions.undoPreview(row.actionId, { requestId });
          await assert.rejects(f.actions.apply(undo.actionId), { code: 'AI_ACTION_APPROVAL_REQUIRED' });
          await f.actions.approve(undo.actionId, { planHash: undo.plan.planHash });
          await f.actions.apply(undo.actionId);
          assert.equal((await f.getNote(note.id)).rawMarkdown, '重复\n重复😀\n保留');
          assert.equal((await f.actions.undoPreview(row.actionId, { requestId })).status, 'applied');
          await f.update(note.id, { rawMarkdown: '后续自己的正文' });
          await assert.rejects(f.actions.undoPreview(row.actionId, { requestId: randomUUID() }), {
            code: 'AI_ACTION_CONFLICT'
          });
        })
    },
    {
      name: 'P2 新建撤销只软删除；小批量后项冲突整体回滚',
      run: () =>
        withFixture(async f => {
          const row = await f.actions.plan({
            spaceId: f.space.id,
            requestId: randomUUID(),
            toolName: 'notes_create',
            arguments: { title: '撤销新建', rawMarkdown: '保留版本' }
          });
          await f.actions.approve(row.actionId, { planHash: row.plan.planHash });
          await f.actions.apply(row.actionId);
          const undo = await f.actions.undoPreview(row.actionId, { requestId: randomUUID() });
          await f.actions.approve(undo.actionId, { planHash: undo.plan.planHash });
          await f.actions.apply(undo.actionId);
          assert.equal((await f.getNote(row.plan.items[0].after.id, true)).deleted, true);
          const a = await f.create({ title: '原 A', rawMarkdown: 'A' }),
            b = await f.create({ title: '原 B', rawMarkdown: 'B' });
          const batch = await f.actions.plan({
            spaceId: f.space.id,
            requestId: randomUUID(),
            toolName: 'notes_propose_organize',
            arguments: {
              changes: [
                { noteId: a.id, title: '批次重名' },
                { noteId: b.id, title: '批次重名' }
              ]
            }
          });
          await f.actions.approve(batch.actionId, { planHash: batch.plan.planHash });
          await assert.rejects(f.actions.apply(batch.actionId));
          assert.equal((await f.getNote(a.id)).title, '原 A');
          assert.equal((await f.getNote(b.id)).title, '原 B');
          const receipt = await f.core.get({
            ownerId: f.ownerId,
            datasetId: batch.datasetId,
            operationId: batch.operationId
          });
          assert.equal(receipt, null);
        })
    },
    {
      name: 'P2 响应丢失与私有账本失败通过核心回执对账，不重复追加',
      run: () =>
        withFixture(async f => {
          const note = await f.create({ title: '对账目标', rawMarkdown: '基线' });
          const row = await f.actions.plan({
            spaceId: f.space.id,
            requestId: randomUUID(),
            toolName: 'notes_append',
            arguments: { noteId: note.id, rawMarkdown: '\n一次' }
          });
          await f.actions.approve(row.actionId, { planHash: row.plan.planHash });
          const originalCommit = f.core.commit,
            originalWrite = f.actionStore.write;
          let failFinalize = false;
          f.core.commit = async (...args) => {
            const receipt = await originalCommit(...args);
            failFinalize = true;
            throw Object.assign(new Error('lost response'), { code: 'DELIVERY_LOST' });
          };
          f.actionStore.write = operation => {
            if (failFinalize) throw new Error('private ledger failed');
            return originalWrite(operation);
          };
          const applied = await f.actions.apply(row.actionId);
          assert.equal(applied.status, 'applied');
          assert.equal(applied.reconciliationPending, true);
          f.core.commit = originalCommit;
          f.actionStore.write = originalWrite;
          assert.equal((await f.actions.get(row.actionId)).status, 'applied');
          assert.equal((await f.actions.apply(row.actionId)).status, 'applied');
          assert.equal((await f.getNote(note.id)).rawMarkdown, '基线\n一次');
        })
    },
    {
      name: 'P2 改名移动标签批量提交及撤销，批准后引用变化阻止提交',
      run: () =>
        withFixture(async f => {
          const folder = await f.createFolder({ name: '合成目录' }),
            tag = await f.createTag({ name: '合成标签' });
          const a = await f.create({ title: '元数据 A', rawMarkdown: '正文 A' }),
            b = await f.create({ title: '元数据 B', rawMarkdown: '正文 B' });
          const batch = await f.actions.plan({
            spaceId: f.space.id,
            requestId: randomUUID(),
            toolName: 'notes_propose_organize',
            arguments: {
              changes: [
                { noteId: a.id, title: '新 A', folderId: folder.id, tagIds: [tag.id] },
                { noteId: b.id, folderId: folder.id, tagIds: [tag.id] }
              ]
            }
          });
          await f.actions.approve(batch.actionId, { planHash: batch.plan.planHash });
          await f.actions.apply(batch.actionId);
          assert.equal((await f.getNote(a.id)).title, '新 A');
          assert.equal((await f.getNote(b.id)).folderId, folder.id);
          assert.deepEqual((await f.getNote(a.id)).tagIds, [tag.id]);
          assert.equal((await f.getNote(a.id)).rawMarkdown, '正文 A');
          const undo = await f.actions.undoPreview(batch.actionId, { requestId: randomUUID() });
          await f.actions.approve(undo.actionId, { planHash: undo.plan.planHash });
          await f.actions.apply(undo.actionId);
          assert.equal((await f.getNote(a.id)).title, '元数据 A');
          assert.equal((await f.getNote(b.id)).folderId, null);
          assert.deepEqual((await f.getNote(a.id)).tagIds, []);
          const changed = await f.actions.plan({
            spaceId: f.space.id,
            requestId: randomUUID(),
            toolName: 'notes_propose_organize',
            arguments: { changes: [{ noteId: a.id, tagIds: [tag.id] }] }
          });
          await f.actions.approve(changed.actionId, { planHash: changed.plan.planHash });
          await f.updateTag(tag.id, { name: '引用被修改' });
          await assert.rejects(f.actions.apply(changed.actionId), { code: 'AI_ACTION_CONFLICT' });
          assert.deepEqual((await f.getNote(a.id)).tagIds, []);
        })
    },
    {
      name: 'P2 取消与提交交错以核心事务回执为准，无半写入',
      run: () =>
        withFixture(async f => {
          const make = async title => {
            const row = await f.actions.plan({
              spaceId: f.space.id,
              requestId: randomUUID(),
              toolName: 'notes_create',
              arguments: { title, rawMarkdown: '合成' }
            });
            await f.actions.approve(row.actionId, { planHash: row.plan.planHash });
            return row;
          };
          const cancelled = await make('提交前取消'),
            original = f.core.commit;
          f.core.commit = async (...args) => {
            await f.actions.cancel(cancelled.actionId);
            return original(...args);
          };
          await assert.rejects(f.actions.apply(cancelled.actionId), { code: 'AI_ACTION_GRANT_REVOKED' });
          assert.equal((await f.notes()).length, 0);
          const committed = await make('提交后取消');
          let cancelResult;
          f.core.commit = async (...args) => {
            const receipt = await original(...args);
            cancelResult = await f.actions.cancel(committed.actionId);
            return receipt;
          };
          assert.equal((await f.actions.apply(committed.actionId)).status, 'applied');
          assert.equal(cancelResult.cancellation, 'alreadyCommitted');
          assert.equal((await f.notes()).length, 1);
          f.core.commit = original;
        })
    },
    {
      name: 'P2 死亡草稿租约释放、活跃窗口续租、重启及迟到保存 CAS',
      run: () =>
        withFixture(async f => {
          const note = await f.create({ title: '租约目标', rawMarkdown: '原文' });
          const apply = async () => {
            const row = await f.actions.plan({
              spaceId: f.space.id,
              requestId: randomUUID(),
              toolName: 'notes_append',
              arguments: { noteId: note.id, rawMarkdown: '一次追加' }
            });
            await f.actions.approve(row.actionId, { planHash: row.plan.planHash });
            return f.actions.apply(row.actionId);
          };
          await assert.rejects(
            f.actions.draft({ noteId: note.id, clientId: 'old', dirty: true, leaseExpiresAt: '1900-01-01' }),
            { code: 'AI_REQUEST_INVALID' }
          );
          await f.actions.draft({ noteId: note.id, clientId: 'old', dirty: true });
          await f.actions.draft({ noteId: note.id, clientId: 'new', dirty: false });
          await assert.rejects(apply(), { code: 'AI_ACTION_DRAFT_CONFLICT' });
          f.advance(90000);
          await f.actions.draft({ noteId: note.id, clientId: 'old', dirty: true });
          f.advance(90000);
          await assert.rejects(apply(), { code: 'AI_ACTION_DRAFT_CONFLICT' });
          await f.restart();
          f.advance(120001);
          assert.equal((await apply()).status, 'applied');
          await assert.rejects(
            Promise.resolve().then(() =>
              f.update(note.id, {
                rawMarkdown: '迟到旧草稿',
                expectedUpdatedAt: new Date(note.updatedAt).toISOString()
              })
            )
          );
          assert.equal((await f.getNote(note.id)).rawMarkdown, '原文一次追加');
        })
    },
    {
      name: 'P2 无期限草稿旧状态一次性迁移，重启不得延长宽限期',
      run: () =>
        withFixture(async f => {
          const note = await f.create({ title: '迁移草稿', rawMarkdown: '正文' });
          await f.actions.draft({ noteId: note.id, clientId: 'legacy', dirty: true });
          const old = await f.actionStore.read();
          old.version = 1;
          old.drafts.forEach(row => {
            delete row.leaseExpiresAt;
          });
          await f.legacy(old);
          await f.restart();
          const migrated = await f.actionStore.read();
          assert.equal(migrated.version, 2);
          assert.equal((await f.rawActionState()).version, 2);
          assert(Number.isFinite(Date.parse(migrated.drafts[0].leaseExpiresAt)));
          const expiry = migrated.drafts[0].leaseExpiresAt;
          f.advance(60000);
          await f.restart();
          assert.equal((await f.actionStore.read()).drafts[0].leaseExpiresAt, expiry);
          assert.equal((await f.rawActionState()).drafts[0].leaseExpiresAt, expiry);
        })
    },
    {
      name: 'P2 损坏恢复计划和回执 fail closed，不能改变精确正文工具语义',
      run: () =>
        withFixture(async f => {
          const note = await f.create({ title: '恢复校验', rawMarkdown: '原文' });
          const row = await f.actions.plan({
            spaceId: f.space.id,
            requestId: randomUUID(),
            toolName: 'notes_append',
            arguments: { noteId: note.id, rawMarkdown: '追加' }
          });
          for (const mutate of [
            plan => {
              plan.items[0].softDelete = true;
            },
            plan => {
              plan.items[0].after.title = '恶意改名';
            },
            plan => {
              plan.items[0].after.rawMarkdown = '无关';
            },
            plan => {
              plan.items[0].baseline = { exists: false };
            },
            plan => {
              plan.items[0] = null;
            }
          ]) {
            const state = await f.actionStore.read(),
              plan = structuredClone(row.plan);
            mutate(plan);
            const { planHash, ...content } = plan;
            state.actions[0].plan = finalizePlan(content);
            assert.throws(() => validateActionState(state), { code: 'AI_ACTION_STORAGE_INVALID' });
          }
          assert.equal((await f.getNote(note.id)).rawMarkdown, '原文');
          assert.equal(hashRecord(row.plan), hashRecord((await f.actions.get(row.actionId)).plan));
        })
    }
  ];
}
