import { redirect } from "next/navigation";

/** Medication editing merged into the /health Medications tab (WHO-302) — no separate page. */
export default function MedicationManagerPage() {
  redirect("/health");
}
