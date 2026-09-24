type Reading = { metric: string; value: number | null; unit: string };

const SHORT_LABELS: Record<string, string> = {
  heart_rate: "HR",
  temperature: "Temp",
  weight: "Wt",
  height: "Ht",
  blood_glucose: "Glucose",
  respiratory_rate: "RR",
};

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** "Vitals · 135/90 · HR 65 · SpO₂ 98%" — null when there are no usable readings. */
export function summarizeVitals(readings: Reading[]): string | null {
  const byMetric = new Map<string, Reading & { value: number }>();
  for (const r of readings) {
    if (r.value != null && !byMetric.has(r.metric)) byMetric.set(r.metric, r as Reading & { value: number });
  }
  const parts: string[] = [];
  const sys = byMetric.get("blood_pressure_systolic");
  const dia = byMetric.get("blood_pressure_diastolic");
  if (sys && dia) parts.push(`${num(sys.value)}/${num(dia.value)}`);
  else if (sys) parts.push(`Sys ${num(sys.value)}`);
  else if (dia) parts.push(`Dia ${num(dia.value)}`);
  for (const [metric, r] of byMetric) {
    if (metric === "blood_oxygen") {
      parts.push(`SpO₂ ${num(r.value)}%`);
      continue;
    }
    const label = SHORT_LABELS[metric];
    if (!label) continue;
    if (metric === "heart_rate" || metric === "respiratory_rate") {
      parts.push(`${label} ${num(r.value)}`);
    } else {
      const unit = r.unit.trim();
      parts.push(`${label} ${num(r.value)}${unit.startsWith("°") ? unit : unit ? ` ${unit}` : ""}`);
    }
  }
  return parts.length > 0 ? `Vitals · ${parts.join(" · ")}` : null;
}
