const WORK_DOMAIN_LABELS = Object.freeze({
  materials: '资料库',
  knowledge: '知识库',
  training: '训练场',
  learning: '学习档案'
});

export function getWorkDomainStatusMessage(domain) {
  return `当前工作域：${WORK_DOMAIN_LABELS[domain] ?? '工作区'}`;
}

export function getHomeStatusMessage() {
  return '当前工作台：主页概览';
}
