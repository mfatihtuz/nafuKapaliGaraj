import type { AttributeDef, PartAttributes } from '../db/types'

interface Props {
  schema: AttributeDef[]
  values: PartAttributes
  onChange: (key: string, value: string) => void
}

/** Kategori attribute_schema'sından dinamik form (SPRINT_PLAN 1.9). */
export function AttributeForm({ schema, values, onChange }: Props) {
  const ordered = [...schema].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return (
    <div className="flex flex-col gap-3">
      {ordered.map((def) => {
        const val = values[def.key]
        const strVal = val === null || val === undefined ? '' : String(val)
        return (
          <div key={def.key}>
            <label className="field-label" htmlFor={`attr-${def.key}`}>
              {def.label_tr}
              {def.unit ? <span className="text-brand-300"> ({def.unit})</span> : null}
              {def.required ? <span className="text-red-500"> *</span> : null}
            </label>

            {def.type === 'enum' && def.options ? (
              <div className="flex flex-wrap gap-1.5">
                {def.options.map((opt) => {
                  const active = strVal === opt
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => onChange(def.key, active ? '' : opt)}
                      className={`chip min-h-[40px] px-3 ${
                        active ? 'bg-brand text-white' : 'bg-brand-50 text-brand-600'
                      }`}
                    >
                      {opt}
                    </button>
                  )
                })}
              </div>
            ) : (
              <input
                id={`attr-${def.key}`}
                type={def.type === 'number' ? 'number' : 'text'}
                inputMode={def.type === 'number' ? 'decimal' : 'text'}
                value={strVal}
                onChange={(e) => onChange(def.key, e.target.value)}
                className="input"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
