export interface BadgeOptions {
  score:  number;
  grade:  string;
  label?: string;
}

export interface BadgeResult {
  svg:    string;
  labelW: number;
  valueW: number;
  totalW: number;
}

export function generateBadgeSvg(opts: BadgeOptions): BadgeResult {
  const rawLabel = opts.label ?? "AIQA Readiness";

  if (/[^\x20-\x7E]/.test(rawLabel)) {
    throw new Error("Badge label must contain only printable ASCII characters (no emoji or CJK)");
  }

  const label  = rawLabel.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const value  = `${opts.score}/100 ${opts.grade}`;
  const colour = opts.score >= 80 ? "#4c1" : opts.score >= 60 ? "#dfb317" : "#e05d44";

  const labelW = rawLabel.length * 6.5 + 10;
  const valueW = value.length  * 6.5 + 10;
  const totalW = labelW + valueW;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0"  stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1"  stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalW}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="20" fill="#555"/>
    <rect x="${labelW}" width="${valueW}" height="20" fill="${colour}"/>
    <rect width="${totalW}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelW / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelW / 2}" y="14">${label}</text>
    <text x="${labelW + valueW / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${labelW + valueW / 2}" y="14">${value}</text>
  </g>
</svg>`;

  return { svg, labelW, valueW, totalW };
}
