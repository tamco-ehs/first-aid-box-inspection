'use client';

// Large Yes / No control for the quick-inspection questions. `good` indicates
// which answer is the healthy one, so the chosen answer is tinted green or red.
export function YesNo({
  value,
  onChange,
  goodAnswer = true,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
  goodAnswer?: boolean;
}) {
  return (
    <div className="flex gap-2">
      {[true, false].map((opt) => {
        const selected = value === opt;
        const isGood = opt === goodAnswer;
        const cls = selected ? (isGood ? 'choice-on-ok' : 'choice-on-bad') : '';
        return (
          <button
            key={String(opt)}
            type="button"
            onClick={() => onChange(opt)}
            aria-pressed={selected}
            className={`choice ${cls}`}
          >
            {opt ? 'Yes' : 'No'}
          </button>
        );
      })}
    </div>
  );
}
