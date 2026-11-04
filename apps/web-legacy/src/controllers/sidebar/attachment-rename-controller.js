import {
  buildAttachmentFileName,
  splitAttachmentFileName
} from '../../../lib/sidebar/attachment-file-name.js';
import { guardWorkspaceWrite } from '../../../lib/workspace-write-guard.js';

export function createAttachmentRenameController({
  state,
  knowledgeApi,
  getCurrentNote,
  renderSidebar,
  flashStatus
}) {
  function startAttachmentRename(attachmentId) {
    const attachment = state.attachments.find((item) => item?.id === attachmentId) ?? null;
    if (!attachment) {
      flashStatus('当前附件不存在或已失效');
      return false;
    }

    const { stem, extension } = splitAttachmentFileName(attachment.fileName);
    state.attachmentRenaming = {
      id: attachment.id,
      draft: stem,
      extension
    };
    renderSidebar(getCurrentNote(), {
      selector: `[data-attachment-rename-input="${escapeAttachmentSelector(attachment.id)}"]`,
      select: true
    });
    return true;
  }

  function updateAttachmentRenameDraft(value) {
    if (!state.attachmentRenaming) {
      return;
    }

    state.attachmentRenaming = {
      ...state.attachmentRenaming,
      draft: String(value ?? '')
    };
  }

  function cancelAttachmentRename() {
    if (!state.attachmentRenaming) {
      return false;
    }

    const attachmentId = state.attachmentRenaming.id;
    state.attachmentRenaming = null;
    renderSidebar(getCurrentNote(), attachmentFocusRequest(attachmentId));
    return true;
  }

  async function submitAttachmentRename(attachmentId, fileName) {
    if (!guardWorkspaceWrite({ dataMode: state.dataMode, flashStatus })) {
      return false;
    }
    const normalizedAttachmentId = String(attachmentId ?? '').trim();
    const renamingState = state.attachmentRenaming?.id === normalizedAttachmentId
      ? state.attachmentRenaming
      : null;
    const normalizedFileName = String(fileName ?? '').trim();
    if (!normalizedAttachmentId) {
      flashStatus('缺少要重命名的附件');
      return false;
    }
    try {
      const updatedAttachment = await knowledgeApi.renameAttachment(normalizedAttachmentId, {
        fileName: buildAttachmentFileName({
          draft: normalizedFileName,
          extension: renamingState?.extension
        })
      });

      state.attachments = state.attachments.map((attachment) => (
        attachment?.id === normalizedAttachmentId
          ? { ...attachment, ...updatedAttachment }
          : attachment
      ));
      state.attachmentRenaming = null;
      renderSidebar(getCurrentNote(), attachmentFocusRequest(normalizedAttachmentId));
      flashStatus('附件名已更新');
      return true;
    } catch (error) {
      const message = String(error?.message ?? '重命名失败');
      if (/route not found/i.test(message)) {
        flashStatus('附件重命名失败：当前后端未加载该接口，请重启或同步后端服务');
      } else {
        flashStatus(`附件重命名失败：${message}`);
      }
      return false;
    }
  }

  return {
    startAttachmentRename,
    updateAttachmentRenameDraft,
    cancelAttachmentRename,
    submitAttachmentRename
  };
}

function attachmentFocusRequest(attachmentId) {
  return {
    selector: `[data-attachment-open="${escapeAttachmentSelector(attachmentId)}"]`
  };
}

function escapeAttachmentSelector(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return String(value).replace(/"/g, '\\"');
}
