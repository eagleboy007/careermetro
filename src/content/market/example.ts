import { EXAMPLE_SOURCE, MARKET_BANDS, type MarketRow, type MarketTable, type StateCode } from "@/lib/schemas";
import { marketStates } from "./places";

/*
 * EXAMPLE DATA for the Market screen (handoff C6, dev/market-plan.md). Every figure here is made up to show the design:
 * none comes from a salary site, a job portal or a report. The rows have the one shape real tables will use, so
 * Data research's licensed rows can replace `exampleMarketTable` without touching the screen.
 *
 * The rows are worked out by plain, deterministic code from a small hand-written seed per role and per state, so the
 * same build always shows the same numbers. State rows cover 12 months (for the trend); city rows cover the latest
 * month only.
 */

/** The last full month the example covers, and the 12 months of the trend. */
export const EXAMPLE_LATEST_MONTH = "2026-09";
export const exampleMonths = (latest = EXAMPLE_LATEST_MONTH): string[] => {
  const [y, m] = latest.split("-").map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (11 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
};

type Seniority = "entry" | "mid" | "senior";
/** How a role's openings split across the four experience bands. */
const BAND_SPLIT: Record<Seniority, [number, number, number, number]> = {
  entry: [0.4, 0.35, 0.18, 0.07],
  mid: [0.15, 0.45, 0.3, 0.1],
  senior: [0.03, 0.17, 0.45, 0.35],
};

/** Example seed per role: openings a month across India, median pay per band (lakh a year), change over 12 months. */
const ROLE_SEED: Record<string, { openings: number; pay: [number, number, number, number]; yearChange: number; seniority: Seniority }> = {
  "ai-engineer": { openings: 700, pay: [7, 14, 24, 36], yearChange: 0.35, seniority: "mid" },
  "analytics-engineer": { openings: 450, pay: [6, 11, 18, 27], yearChange: 0.15, seniority: "mid" },
  "android-developer": { openings: 900, pay: [4.5, 9, 15, 24], yearChange: -0.12, seniority: "entry" },
  "application-support-engineer": { openings: 1400, pay: [3.5, 6, 9.5, 14], yearChange: 0.02, seniority: "entry" },
  "appsec-engineer": { openings: 380, pay: [7, 12, 20, 30], yearChange: 0.18, seniority: "mid" },
  "ar-vr-developer": { openings: 200, pay: [4, 7.5, 13, 20], yearChange: 0.06, seniority: "entry" },
  "bi-developer": { openings: 650, pay: [4, 7.5, 12, 18], yearChange: 0.05, seniority: "entry" },
  "blockchain-developer": { openings: 250, pay: [5, 10, 17, 26], yearChange: 0.04, seniority: "entry" },
  "business-analyst": { openings: 1100, pay: [5, 8, 13, 19], yearChange: 0.04, seniority: "entry" },
  "cloud-architect": { openings: 300, pay: [15, 24, 35, 48], yearChange: 0.1, seniority: "senior" },
  "cloud-engineer": { openings: 1300, pay: [5, 10, 17, 27], yearChange: 0.14, seniority: "entry" },
  "cloud-finops-analyst": { openings: 180, pay: [7, 12, 19, 28], yearChange: 0.22, seniority: "mid" },
  "cloud-security-engineer": { openings: 420, pay: [7, 13, 22, 32], yearChange: 0.2, seniority: "mid" },
  "cloud-support-engineer": { openings: 900, pay: [3.5, 6, 9.5, 14], yearChange: 0.06, seniority: "entry" },
  "computer-vision-engineer": { openings: 400, pay: [6, 11, 18, 28], yearChange: 0.14, seniority: "entry" },
  "cross-platform-mobile-developer": { openings: 600, pay: [4.5, 9, 16, 24], yearChange: 0.02, seniority: "entry" },
  "cyber-security-analyst": { openings: 950, pay: [4, 7, 13, 20], yearChange: 0.16, seniority: "entry" },
  "data-analyst": { openings: 1500, pay: [4, 7, 11, 17], yearChange: 0.1, seniority: "entry" },
  "data-architect": { openings: 200, pay: [14, 22, 32, 45], yearChange: 0.08, seniority: "senior" },
  "data-engineer": { openings: 1150, pay: [6, 12, 19, 30], yearChange: 0.12, seniority: "entry" },
  "data-governance-analyst": { openings: 300, pay: [5, 9, 14, 21], yearChange: 0.11, seniority: "mid" },
  "data-scientist": { openings: 800, pay: [6.5, 12, 20, 30], yearChange: 0.15, seniority: "entry" },
  "database-administrator": { openings: 450, pay: [4, 7.5, 12, 18], yearChange: -0.03, seniority: "mid" },
  "database-architect": { openings: 160, pay: [6, 12, 22, 34], yearChange: -0.02, seniority: "senior" },
  "database-developer": { openings: 900, pay: [4, 7.5, 12, 18], yearChange: -0.02, seniority: "entry" },
  "devops-engineer": { openings: 1250, pay: [5.5, 11, 19, 30], yearChange: 0.06, seniority: "entry" },
  "devsecops-engineer": { openings: 500, pay: [7, 13, 21, 31], yearChange: 0.13, seniority: "mid" },
  "digital-marketing-executive": { openings: 1400, pay: [3, 5, 8, 12], yearChange: 0.03, seniority: "entry" },
  "dotnet-developer": { openings: 1100, pay: [4, 8, 13, 20], yearChange: -0.05, seniority: "entry" },
  "dynamics-365-developer": { openings: 450, pay: [5, 9, 15, 22], yearChange: 0.04, seniority: "mid" },
  "embedded-software-engineer": { openings: 900, pay: [4, 7.5, 12, 18], yearChange: 0.06, seniority: "entry" },
  "engineering-manager": { openings: 260, pay: [12, 20, 32, 45], yearChange: -0.05, seniority: "senior" },
  "etl-developer": { openings: 850, pay: [4, 7.5, 12, 18], yearChange: -0.06, seniority: "mid" },
  "frontend-architect": { openings: 220, pay: [16, 26, 38, 52], yearChange: 0.03, seniority: "senior" },
  "frontend-developer": { openings: 1350, pay: [4.5, 9, 16, 26], yearChange: -0.1, seniority: "entry" },
  "full-stack-developer": { openings: 1600, pay: [5, 10, 17, 26], yearChange: -0.04, seniority: "entry" },
  "game-developer": { openings: 350, pay: [3.5, 6.5, 11, 17], yearChange: 0.03, seniority: "entry" },
  "golang-developer": { openings: 550, pay: [6, 12, 20, 30], yearChange: 0.09, seniority: "entry" },
  "grc-manager": { openings: 140, pay: [8, 14, 24, 36], yearChange: 0.08, seniority: "senior" },
  "iam-engineer": { openings: 320, pay: [5, 9.5, 15, 23], yearChange: 0.12, seniority: "mid" },
  "incident-response-analyst": { openings: 220, pay: [6, 10, 16, 24], yearChange: 0.1, seniority: "mid" },
  "information-security-analyst": { openings: 450, pay: [4.5, 8.5, 14, 21], yearChange: 0.11, seniority: "entry" },
  "ios-developer": { openings: 420, pay: [5, 10, 17, 26], yearChange: -0.09, seniority: "entry" },
  "iot-engineer": { openings: 450, pay: [4.5, 8, 13, 20], yearChange: 0.08, seniority: "entry" },
  "it-support-engineer": { openings: 1800, pay: [2.2, 3.5, 5, 7], yearChange: -0.02, seniority: "entry" },
  "java-backend-developer": { openings: 1450, pay: [5, 10, 17, 26], yearChange: -0.06, seniority: "entry" },
  "mainframe-developer": { openings: 600, pay: [4, 7.5, 12, 18], yearChange: -0.07, seniority: "mid" },
  "manual-test-engineer": { openings: 750, pay: [2.8, 4.5, 7, 10], yearChange: -0.18, seniority: "entry" },
  "ml-engineer": { openings: 850, pay: [8, 15, 25, 38], yearChange: 0.28, seniority: "mid" },
  "mlops-engineer": { openings: 380, pay: [7, 13, 21, 32], yearChange: 0.2, seniority: "mid" },
  "network-engineer": { openings: 900, pay: [3, 5.5, 9, 14], yearChange: 0.01, seniority: "entry" },
  "network-security-engineer": { openings: 750, pay: [4.5, 8, 13, 20], yearChange: 0.1, seniority: "mid" },
  "nodejs-developer": { openings: 1300, pay: [4.5, 9, 15, 23], yearChange: 0.02, seniority: "entry" },
  "oracle-fusion-technical-consultant": { openings: 600, pay: [6, 10, 16, 24], yearChange: 0.07, seniority: "mid" },
  "ot-security-engineer": { openings: 150, pay: [6, 10, 16, 24], yearChange: 0.12, seniority: "mid" },
  "penetration-tester": { openings: 330, pay: [4.5, 8, 14, 22], yearChange: 0.05, seniority: "entry" },
  "performance-test-engineer": { openings: 350, pay: [4.5, 8, 13, 19], yearChange: 0.03, seniority: "mid" },
  "php-developer": { openings: 1100, pay: [3, 5.5, 9, 14], yearChange: -0.08, seniority: "entry" },
  "platform-engineer": { openings: 450, pay: [8, 15, 24, 35], yearChange: 0.15, seniority: "mid" },
  "power-platform-developer": { openings: 600, pay: [4.5, 8, 13, 19], yearChange: 0.1, seniority: "mid" },
  "privacy-analyst": { openings: 170, pay: [5, 9, 15, 24], yearChange: 0.13, seniority: "entry" },
  "product-manager": { openings: 700, pay: [10, 18, 28, 40], yearChange: 0.02, seniority: "mid" },
  "python-developer": { openings: 1400, pay: [4, 8, 14, 22], yearChange: 0.03, seniority: "entry" },
  "qa-automation-engineer": { openings: 1000, pay: [3.5, 7, 11, 18], yearChange: -0.14, seniority: "entry" },
  "qa-lead": { openings: 400, pay: [9, 14, 20, 28], yearChange: -0.05, seniority: "senior" },
  "robotics-engineer": { openings: 250, pay: [5, 9, 15, 23], yearChange: 0.12, seniority: "entry" },
  "rpa-developer": { openings: 700, pay: [4, 7.5, 12, 18], yearChange: -0.03, seniority: "entry" },
  "salesforce-developer": { openings: 1000, pay: [4.5, 8.5, 14, 21], yearChange: 0.05, seniority: "entry" },
  "sap-abap-developer": { openings: 850, pay: [4.5, 8, 13, 20], yearChange: 0.04, seniority: "entry" },
  "scrum-master": { openings: 500, pay: [8, 13, 19, 27], yearChange: -0.06, seniority: "mid" },
  "security-architect": { openings: 180, pay: [18, 28, 40, 55], yearChange: 0.09, seniority: "senior" },
  "senior-backend-engineer": { openings: 500, pay: [10, 16, 26, 38], yearChange: -0.03, seniority: "senior" },
  "senior-data-scientist": { openings: 300, pay: [12, 18, 28, 40], yearChange: 0.12, seniority: "senior" },
  "servicenow-developer": { openings: 700, pay: [5, 9, 15, 22], yearChange: 0.08, seniority: "mid" },
  "site-reliability-engineer": { openings: 550, pay: [7, 13, 22, 33], yearChange: 0.07, seniority: "mid" },
  "soc-analyst-l2": { openings: 360, pay: [4.5, 7.5, 11, 16], yearChange: 0.06, seniority: "mid" },
  "soc-lead": { openings: 120, pay: [8, 12, 19, 28], yearChange: 0.04, seniority: "senior" },
  "software-engineer": { openings: 1700, pay: [4.5, 8, 14, 22], yearChange: -0.02, seniority: "entry" },
  "solutions-architect": { openings: 420, pay: [16, 26, 38, 52], yearChange: 0.04, seniority: "senior" },
  "storage-backup-engineer": { openings: 550, pay: [4, 7, 11, 16], yearChange: -0.04, seniority: "mid" },
  "system-administrator": { openings: 800, pay: [3, 5, 8, 12], yearChange: -0.04, seniority: "entry" },
  "tech-lead": { openings: 900, pay: [14, 22, 32, 45], yearChange: 0.01, seniority: "senior" },
  "technical-support-engineer": { openings: 1200, pay: [3, 5, 8, 12], yearChange: 0.03, seniority: "entry" },
  "technical-writer": { openings: 400, pay: [3.5, 6.5, 11, 16], yearChange: -0.04, seniority: "entry" },
  "threat-intelligence-analyst": { openings: 200, pay: [5, 9, 15, 22], yearChange: 0.12, seniority: "mid" },
  "ui-ux-designer": { openings: 650, pay: [4, 8, 14, 22], yearChange: -0.01, seniority: "entry" },
  "vlsi-design-engineer": { openings: 650, pay: [6, 12, 20, 32], yearChange: 0.14, seniority: "entry" },
  "vulnerability-management-analyst": { openings: 300, pay: [4.5, 8, 13, 19], yearChange: 0.1, seniority: "mid" },
};
export const exampleRoleSlugs = Object.keys(ROLE_SEED);

/** Example seed per state: share of India's openings and a pay factor. Small states get none, so they read "Not enough data". */
const STATE_SEED: Record<StateCode, [share: number, pay: number]> = {
  KA: [0.22, 1.1], MH: [0.19, 1.05], TG: [0.14, 1.06], TN: [0.1, 0.97], HR: [0.08, 1.05], UP: [0.07, 0.96],
  DL: [0.06, 1.0], GJ: [0.035, 0.9], WB: [0.03, 0.88], KL: [0.03, 0.9], RJ: [0.02, 0.88], MP: [0.015, 0.87],
  PB: [0.012, 0.88], AP: [0.012, 0.88], OD: [0.01, 0.86], CH: [0.008, 0.92], GA: [0.004, 0.9], BR: [0.004, 0.82],
  UK: [0.004, 0.86], AS: [0.004, 0.84], CG: [0.003, 0.84], JH: [0.003, 0.84], JK: [0.003, 0.85], HP: [0.002, 0.85],
  PY: [0.002, 0.86], DH: [0.001, 0.86], ML: [0.001, 0.84], MN: [0.001, 0.84], TR: [0.001, 0.84], LA: [0, 0.85],
  SK: [0, 0.85], AR: [0, 0.85], NL: [0, 0.85], MZ: [0, 0.85], LD: [0, 0.85], AN: [0, 0.85],
};
const SHARE_TOTAL = Object.values(STATE_SEED).reduce((s, [share]) => s + share, 0);

/** How a state's openings split across its listed cities (the rest are elsewhere in the state). */
const CITY_SPLIT: Record<number, number[]> = { 1: [0.9], 2: [0.65, 0.25], 3: [0.55, 0.3, 0.1] };

/** A stable number in [0, 1) from a key (FNV-1a), so the example never changes between builds. */
function unit(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

const oneDecimal = (v: number) => Math.round(v * 10) / 10;
const pay = (median: number) => ({ payP25: oneDecimal(median * 0.8), payMedian: oneDecimal(median), payP75: oneDecimal(median * 1.25) });

/** Builds the example rows. Exported for the test that pins their shape; the screen reads `exampleMarketTable`. */
export function buildExampleRows(latest = EXAMPLE_LATEST_MONTH): MarketRow[] {
  const months = exampleMonths(latest);
  const rows: MarketRow[] = [];
  for (const [role, seed] of Object.entries(ROLE_SEED)) {
    const split = BAND_SPLIT[seed.seniority];
    const phase = unit(role) * 6;
    for (const state of marketStates) {
      const [share, payFactor] = STATE_SEED[state.code];
      const stateJitter = 0.85 + 0.3 * unit(role + state.code);
      months.forEach((month, i) => {
        // Grows (or shrinks) steadily toward the latest month, with a small seasonal wiggle.
        const time = Math.pow(1 + seed.yearChange, (i - 11) / 11) * (1 + 0.04 * Math.sin(i * 1.3 + phase));
        const stateOpenings = (seed.openings * share * stateJitter * time) / SHARE_TOTAL;
        MARKET_BANDS.forEach((band, b) => {
          const median = seed.pay[b]! * payFactor * (0.96 + 0.08 * unit(role + state.code + band));
          const openings = Math.round(stateOpenings * split[b]!);
          // A source has no row for a cell with no openings; the screen reads a missing row as "Not enough data".
          if (openings === 0) return;
          rows.push({ role, state: state.code, city: null, band, openings, ...pay(median), source: EXAMPLE_SOURCE, month });
          if (i !== 11) return;
          const weights = CITY_SPLIT[state.cities.length] ?? [];
          state.cities.forEach((city, c) => {
            const cityOpenings = Math.floor(openings * weights[c]!);
            const cityMedian = median * (c === 0 ? 1.03 : 0.95);
            if (cityOpenings > 0) rows.push({ role, state: state.code, city, band, openings: cityOpenings, ...pay(cityMedian), source: EXAMPLE_SOURCE, month });
          });
        });
      });
    }
  }
  return rows;
}

export const exampleMarketTable: MarketTable = { latestMonth: EXAMPLE_LATEST_MONTH, rows: buildExampleRows() };
