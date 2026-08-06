export type ShoppingGlanceRow = {
  id: string;
  item: string;
  checked: boolean;
  aisle: string | null;
  quantity: number | null;
  unit: string | null;
};

export type GlanceTone = "success" | "warning" | "default";

export function buildShoppingGlance(rows: ShoppingGlanceRow[]) {
  const open = rows.filter((r) => !r.checked);
  const items = open.slice(0, 3).map((r) => {
    const qty =
      r.quantity != null
        ? r.unit
          ? `${r.quantity} ${r.unit}`
          : String(r.quantity)
        : null;
    const metaParts = [r.aisle, qty].filter(Boolean);
    return {
      id: r.id,
      item: r.item,
      meta: metaParts.length > 0 ? metaParts.join(" · ") : undefined,
    };
  });
  const overflow = Math.max(0, open.length - 3);

  let headline: string;
  let tone: GlanceTone = "default";
  if (open.length === 0) {
    headline = "List clear";
    tone = "success";
  } else {
    headline = `${open.length} to buy`;
  }

  return {
    summary: {
      open: open.length,
      tone,
      headline,
    },
    items,
    overflow,
  };
}
