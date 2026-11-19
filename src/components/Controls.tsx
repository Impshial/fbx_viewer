import { useEffect, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function IconButton({ icon: Icon, label, active, onClick, disabled, className = '' }: { icon: LucideIcon; label: string; active?: boolean; onClick(): void; disabled?: boolean; className?: string }) {
  return <button type="button" className={`icon-button ${active ? 'active' : ''} ${className}`} title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}><Icon size={16} strokeWidth={1.65} /></button>;
}
export function Section({ title, children, extra, defaultOpen = true }: { title: string; children: ReactNode; extra?: ReactNode; defaultOpen?: boolean }) {
  return <details className="inspector-section" open={defaultOpen}><summary><span>{title}</span>{extra}</summary><div className="section-body">{children}</div></details>;
}
export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return <label className="toggle-field"><span>{label}</span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><span className="switch" /></label>;
}
export function NumberField({ label, value, onChange, min, max, step = 0.1, suffix }: { label: string; value: number; onChange(value: number): void; min?: number; max?: number; step?: number; suffix?: string }) {
  return <label className="field"><span>{label}</span><div className="number-wrap"><input type="number" aria-label={label} value={Number(value.toFixed(3))} step={step} min={min} max={max} onChange={event => { const n = event.target.valueAsNumber; if (Number.isFinite(n)) onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n))); }} />{suffix && <small>{suffix}</small>}</div></label>;
}
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <label className="field"><span>{label}</span><div className="color-field"><input type="color" aria-label={`${label} picker`} value={value} onChange={event => onChange(event.target.value)} /><input aria-label={`${label} hex`} value={text} maxLength={7} spellCheck={false} onChange={event => { setText(event.target.value); if (/^#[0-9a-f]{6}$/i.test(event.target.value)) onChange(event.target.value); }} onBlur={() => setText(value)} /></div></label>;
}
export function VectorField({ label, value, onChange, suffix = '' }: { label: string; value: [number, number, number]; onChange(value: [number, number, number]): void; suffix?: string }) {
  return <div className="vector-field"><span className="field-label">{label}{suffix && <small>{suffix}</small>}</span><div>{value.map((v, i) => <label key={i} className={`axis-field axis-${i}`}><span>{['X', 'Y', 'Z'][i]}</span><input type="number" aria-label={`${label} ${['X', 'Y', 'Z'][i]}`} step={suffix === '°' ? 1 : 0.1} value={Number(v.toFixed(3))} onChange={event => { if (Number.isFinite(event.target.valueAsNumber)) { const next = [...value] as [number, number, number]; next[i] = event.target.valueAsNumber; onChange(next); } }} /></label>)}</div></div>;
}
