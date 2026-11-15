import { sameEntity } from '../../api/src/modules/sync/entity-contract.ts';

/** 同一资料库内，远端仅推进 PDF 活动日期时，保留本地业务修改并采用较新的日期。 */
export function mergePdfNoteActivity(previous, remote, local, { sameEpoch }) {
  if (
    !sameEpoch ||
    previous?.contentKind !== 'pdf' ||
    remote?.contentKind !== 'pdf' ||
    local?.contentKind !== 'pdf' ||
    previous.id !== remote.id ||
    previous.id !== local.id ||
    !sameEntity('notes', previous, remote)
  )
    return null;
  const localTime = Date.parse(local.updatedAt);
  const remoteTime = Date.parse(remote.updatedAt);
  return {
    ...local,
    updatedAt:
      Number.isFinite(remoteTime) && (!Number.isFinite(localTime) || remoteTime > localTime)
        ? remote.updatedAt
        : local.updatedAt
  };
}
