import { useState } from 'react';
import { zonedDateTimeToIso, type ReminderInput, type Todo } from '@study-accelerator/web-core';
import { BellIcon } from '../../components/icons/knowra';
import {
  Button,
  DatePicker,
  Popover,
  PopoverDialog,
  PopoverTrigger,
  SegmentedButton,
  SegmentedControl,
  Select,
  TextField
} from '../../components/ui';
import { formatDateLabel } from './todoPresentation';
import styles from './PersonalTodos.module.css';

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAYS = [0, 1, 2, 3, 7].map(day => ({ id: String(day), label: day === 0 ? '截止当天' : `截止前 ${day} 天` }));

const pad = (value: number) => String(value).padStart(2, '0');
const localTime = (iso: string) => {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const localDate = (iso: string) => {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** 「11月12日 周三 09:00」「截止前 1 天 09:00」，并附上已提醒／已错过状态。 */
export function reminderLabel(todo: Todo, today: string) {
  const reminder = todo.reminder;
  if (!reminder || reminder.state === 'cancelled') return null;
  const when =
    reminder.kind === 'fixed'
      ? `${formatDateLabel(localDate(reminder.at), today)} ${localTime(reminder.at)}`
      : `${reminder.daysBefore === 0 ? '截止当天' : `截止前 ${reminder.daysBefore} 天`} ${reminder.time}`;
  if (reminder.state === 'fired') return `${when} · 已提醒`;
  if (reminder.state === 'missed') return `${when} · 已错过，请重新设置`;
  return when;
}

/** 每项一个提醒：指定时间，或相对截止日期（截止日期变化时跟随）。 */
export function ReminderEditor({
  todo,
  today,
  isDisabled,
  onSave
}: {
  todo: Todo;
  today: string;
  isDisabled?: boolean;
  onSave(reminder: ReminderInput | null): void;
}) {
  const current = todo.reminder && todo.reminder.state !== 'cancelled' ? todo.reminder : null;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'fixed' | 'beforeDue'>(current?.kind ?? (todo.dueDate ? 'beforeDue' : 'fixed'));
  const [date, setDate] = useState<string | null>(
    current?.kind === 'fixed' ? localDate(current.at) : (todo.plannedDate ?? today)
  );
  const [time, setTime] = useState(
    current?.kind === 'fixed' ? localTime(current.at) : current?.kind === 'beforeDue' ? current.time : '09:00'
  );
  const [days, setDays] = useState(current?.kind === 'beforeDue' ? String(current.daysBefore) : '1');
  const timeValid = TIME.test(time);
  const offset = -new Date().getTimezoneOffset();
  const fixedInPast =
    mode === 'fixed' && date && timeValid && Date.parse(zonedDateTimeToIso(date, time, offset)) <= Date.now();
  const canSave = timeValid && (mode === 'fixed' ? Boolean(date) && !fixedInPast : Boolean(todo.dueDate));
  const save = () => {
    if (!canSave) return;
    onSave(
      mode === 'fixed'
        ? { kind: 'fixed', at: zonedDateTimeToIso(date!, time, offset) }
        : { kind: 'beforeDue', daysBefore: Number(days), time, utcOffsetMinutes: offset }
    );
    setOpen(false);
  };
  const label = reminderLabel(todo, today);
  return (
    <PopoverTrigger isOpen={open} onOpenChange={setOpen}>
      <Button
        size="compact"
        variant="ghost"
        isDisabled={isDisabled}
        className={styles.reminderTrigger}
        data-state={current?.state}
        aria-label={label ? `提醒：${label}` : '设置提醒'}
      >
        <BellIcon size={13} />
        {label ?? '不提醒'}
      </Button>
      <Popover placement="bottom start">
        <PopoverDialog aria-label="设置提醒" className={styles.reminderDialog}>
          <SegmentedControl density="compact" aria-label="提醒方式">
            <SegmentedButton aria-pressed={mode === 'fixed'} onPress={() => setMode('fixed')}>
              指定时间
            </SegmentedButton>
            <SegmentedButton aria-pressed={mode === 'beforeDue'} onPress={() => setMode('beforeDue')}>
              相对截止
            </SegmentedButton>
          </SegmentedControl>
          {mode === 'fixed' ? (
            <div className={styles.reminderRow}>
              <span className={styles.reminderLabel}>日期</span>
              <DatePicker label="提醒日期" value={date} today={today} onChange={setDate} />
            </div>
          ) : todo.dueDate ? (
            <Select label="提前" options={DAYS} selectedKey={days} onSelectionChange={key => setDays(String(key))} />
          ) : (
            <p className={styles.dialogHint}>先设置截止日期，才能按截止日期提醒。</p>
          )}
          <TextField
            label="时间（24 小时制）"
            placeholder="09:00"
            value={time}
            onChange={setTime}
            maxLength={5}
            isInvalid={!timeValid}
            errorMessage={timeValid ? undefined : '请按 09:00 的格式填写'}
          />
          {fixedInPast ? <p className={styles.dialogHint}>这个时间已经过去了。</p> : null}
          <p className={styles.dialogHint}>到时间只提醒一次；应用关闭时不会提醒，下次打开会提示已错过。</p>
          <div className={styles.reminderActions}>
            {current ? (
              <Button
                size="compact"
                variant="ghost"
                onPress={() => {
                  onSave(null);
                  setOpen(false);
                }}
              >
                移除提醒
              </Button>
            ) : null}
            <Button size="compact" variant="primary" isDisabled={!canSave} onPress={save}>
              保存
            </Button>
          </div>
        </PopoverDialog>
      </Popover>
    </PopoverTrigger>
  );
}
