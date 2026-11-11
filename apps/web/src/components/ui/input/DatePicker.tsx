// 日期选择：触发按钮 + 浮层月历与快捷日期。值为本地日期字符串 YYYY-MM-DD，不涉及时区。
// 不引入额外日期库；业务代码通过 `components/ui` 使用。

import { useMemo, useState, type ReactNode } from 'react';
import { Button as RAButton, DialogTrigger } from 'react-aria-components';
import { cx } from '../classnames';
import { Popover, PopoverDialog } from '../overlay/Popover';
import styles from './DatePicker.module.css';

export interface DatePickerProps {
  /** 读屏与浮层标题使用的名称，例如「计划日期」。 */
  label: string;
  value: string | null;
  onChange(value: string | null): void;
  /** 设备本地的今天（YYYY-MM-DD），用于快捷项与高亮。 */
  today: string;
  /** 触发按钮内显示的内容；缺省显示格式化后的日期或占位文字。 */
  children?: ReactNode;
  placeholder?: string;
  icon?: ReactNode;
  isDisabled?: boolean;
  /** 触发按钮的语义色：普通、提醒（如今日截止）、警示（如逾期）。 */
  tone?: 'default' | 'attention' | 'danger';
  className?: string;
  /** 额外快捷项，例如「下周一」。 */
  shortcuts?: { label: string; value: string }[];
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const pad = (value: number) => String(value).padStart(2, '0');
const toKey = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;
const parts = (value: string) => value.split('-').map(Number) as [number, number, number];

export function addDaysToDate(date: string, days: number) {
  const [year, month, day] = parts(date);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return toKey(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate());
}

/** 「11月12日 周三」；跨年时带年份。 */
export function formatDateLabel(value: string, today: string) {
  const [year, month, day] = parts(value);
  const weekday = WEEKDAYS[(new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7];
  const prefix = year === parts(today)[0] ? '' : `${year}年`;
  return `${prefix}${month}月${day}日 周${weekday}`;
}

function monthMatrix(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month, 1 - offset + index));
    return {
      key: toKey(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
      day: date.getUTCDate(),
      outside: date.getUTCMonth() !== month
    };
  });
}

export function DatePicker({
  label,
  value,
  onChange,
  today,
  children,
  placeholder = '设置日期',
  icon,
  isDisabled,
  tone = 'default',
  className,
  shortcuts = []
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const anchor = parts(value ?? today);
  const [view, setView] = useState<[number, number]>([anchor[0], anchor[1] - 1]);
  const cells = useMemo(() => monthMatrix(view[0], view[1]), [view]);
  const pick = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };
  const shift = (delta: number) =>
    setView(([year, month]) => {
      const date = new Date(Date.UTC(year, month + delta, 1));
      return [date.getUTCFullYear(), date.getUTCMonth()];
    });
  const quick = [{ label: '今天', value: today }, { label: '明天', value: addDaysToDate(today, 1) }, ...shortcuts];
  return (
    <DialogTrigger
      isOpen={open}
      onOpenChange={next => {
        if (next) setView([anchor[0], anchor[1] - 1]);
        setOpen(next);
      }}
    >
      <RAButton
        className={cx(styles.trigger, className)}
        isDisabled={isDisabled}
        aria-label={value ? `${label}：${formatDateLabel(value, today)}` : `${label}：未设置`}
        data-empty={value ? undefined : true}
        data-tone={tone === 'default' ? undefined : tone}
      >
        {icon ? (
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span className={styles.value}>{children ?? (value ? formatDateLabel(value, today) : placeholder)}</span>
      </RAButton>
      <Popover placement="bottom start" className={styles.popover}>
        <PopoverDialog aria-label={label} className={styles.dialog}>
          <div className={styles.quick} role="group" aria-label="快捷日期">
            {quick.map(item => (
              <RAButton
                key={item.label}
                className={styles.quickButton}
                data-selected={item.value === value || undefined}
                onPress={() => pick(item.value)}
              >
                {item.label}
              </RAButton>
            ))}
            {value ? (
              <RAButton className={cx(styles.quickButton, styles.clear)} onPress={() => pick(null)}>
                清除
              </RAButton>
            ) : null}
          </div>
          <div className={styles.monthBar}>
            <RAButton className={styles.navButton} aria-label="上个月" onPress={() => shift(-1)}>
              ‹
            </RAButton>
            <strong aria-live="polite">
              {view[0]}年{view[1] + 1}月
            </strong>
            <RAButton className={styles.navButton} aria-label="下个月" onPress={() => shift(1)}>
              ›
            </RAButton>
          </div>
          <div className={styles.grid} role="grid" aria-label={`${view[0]}年${view[1] + 1}月`}>
            <div role="row" className={styles.weekRow}>
              {WEEKDAYS.map(day => (
                <span key={day} role="columnheader" className={styles.weekday}>
                  {day}
                </span>
              ))}
            </div>
            {Array.from({ length: 6 }, (_, row) => (
              <div role="row" key={row} className={styles.weekRow}>
                {cells.slice(row * 7, row * 7 + 7).map(cell => (
                  <span role="gridcell" key={cell.key}>
                    <RAButton
                      className={styles.day}
                      aria-label={formatDateLabel(cell.key, today)}
                      data-outside={cell.outside || undefined}
                      data-today={cell.key === today || undefined}
                      data-selected={cell.key === value || undefined}
                      onPress={() => pick(cell.key)}
                    >
                      {cell.day}
                    </RAButton>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </PopoverDialog>
      </Popover>
    </DialogTrigger>
  );
}
