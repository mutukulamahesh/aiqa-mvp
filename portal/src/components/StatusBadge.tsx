const COLORS: Record<string, { bg: string; color: string }> = {
  passed:    { bg: "#dcfce7", color: "#16a34a" },
  failed:    { bg: "#fee2e2", color: "#dc2626" },
  running:   { bg: "#dbeafe", color: "#2563eb" },
  queued:    { bg: "#f1f5f9", color: "#64748b" },
  error:     { bg: "#fef3c7", color: "#b45309" },
  cancelled: { bg: "#f1f5f9", color: "#94a3b8" },
};

export default function StatusBadge({ status }: { status: string }) {
  const c = COLORS[status] ?? { bg: "#f1f5f9", color: "#64748b" };
  return (
    <span style={{
      background: c.bg, color: c.color,
      padding: "2px 10px", borderRadius: 20,
      fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
    }}>
      {status}
    </span>
  );
}
