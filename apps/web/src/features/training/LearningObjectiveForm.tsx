import { Select, TextAreaField } from '../../components/ui';
import { OBJECTIVE_ACTIONS, OBJECTIVE_LEVELS, objectiveFieldsValid, objectiveConfirmable } from './learningObjectiveModel';

export interface LearningObjectiveFormValue { objective: string; actionVerb: string; cognitiveLevel: string }
export function LearningObjectiveForm({ value, disabled, onChange }: { value: LearningObjectiveFormValue; disabled: boolean; onChange(value: LearningObjectiveFormValue): void }) {
  return <>
    <TextAreaField label="可观察的学习目标" value={value.objective} onChange={objective => onChange({ ...value, objective })} isRequired isDisabled={disabled} />
    <Select label="动作" selectedKey={value.actionVerb || null} options={Object.entries(OBJECTIVE_ACTIONS).map(([id, label]) => ({ id, label }))} onSelectionChange={key => onChange({ ...value, actionVerb: String(key) })} isRequired isDisabled={disabled} />
    <Select label="认知层级" selectedKey={value.cognitiveLevel || null} options={Object.entries(OBJECTIVE_LEVELS).map(([id, label]) => ({ id, label }))} onSelectionChange={key => onChange({ ...value, cognitiveLevel: String(key) })} isRequired isDisabled={disabled} />
    {!objectiveFieldsValid(value) ? <p>请填写可观察的目标，并选择匹配的动作与认知层级：识别／记忆，解释／理解，应用或计算／应用，比较、分析、设计或评价／分析。</p> : null}
    {objectiveFieldsValid(value) && !objectiveConfirmable(value) ? <p>“了解、熟悉、掌握”不能直接确认；请改写为可观察的具体行为。</p> : null}
  </>;
}
