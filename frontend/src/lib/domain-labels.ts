export interface DomainLabels {
  primaryMetric: string;
  primaryUnit: string;
  primaryUnitPosition: "prefix" | "suffix";
  secondaryMetric: string;
  tertiaryMetric: string;
  timeUnit: string;
  chartTitle: string;
  outcomeLabel: string;
  secondaryChartTitle: string;
  formatPrimary: (v: number) => string;
  formatSecondary: (v: number) => string;
}

const DOMAIN_LABELS: Record<string, DomainLabels> = {
  startup: {
    primaryMetric: "Revenue",
    primaryUnit: "$",
    primaryUnitPosition: "prefix",
    secondaryMetric: "Customers",
    tertiaryMetric: "Market Share",
    timeUnit: "months",
    chartTitle: "Revenue Projection",
    outcomeLabel: "Revenue Distribution",
    secondaryChartTitle: "Market Share & Competition",
    formatPrimary: (v: number) => `$${(v / 1000).toFixed(0)}k`,
    formatSecondary: (v: number) => `${v.toFixed(0)}`,
  },
  pricing: {
    primaryMetric: "Revenue",
    primaryUnit: "$",
    primaryUnitPosition: "prefix",
    secondaryMetric: "Customers",
    tertiaryMetric: "Market Share",
    timeUnit: "months",
    chartTitle: "Revenue Impact",
    outcomeLabel: "Revenue Distribution",
    secondaryChartTitle: "Market Share & Competition",
    formatPrimary: (v: number) => `$${(v / 1000).toFixed(0)}k`,
    formatSecondary: (v: number) => `${v.toFixed(0)}`,
  },
  finance: {
    primaryMetric: "Portfolio PnL",
    primaryUnit: "$",
    primaryUnitPosition: "prefix",
    secondaryMetric: "Price Index",
    tertiaryMetric: "Return %",
    timeUnit: "months",
    chartTitle: "Portfolio Performance",
    outcomeLabel: "PnL Distribution",
    secondaryChartTitle: "Return % & Spread",
    formatPrimary: (v: number) => `$${(v / 1000).toFixed(1)}k`,
    formatSecondary: (v: number) => `${v.toFixed(1)}%`,
  },
  biology: {
    primaryMetric: "Binding Rate",
    primaryUnit: "%",
    primaryUnitPosition: "suffix",
    secondaryMetric: "Bound Molecules",
    tertiaryMetric: "Stability Score",
    timeUnit: "steps",
    chartTitle: "Binding Rate Over Time",
    outcomeLabel: "Binding Rate Distribution",
    secondaryChartTitle: "Bound Molecules & Enzyme Activity",
    formatPrimary: (v: number) => `${v.toFixed(1)}%`,
    formatSecondary: (v: number) => `${v.toFixed(0)}`,
  },
  trend: {
    primaryMetric: "Signal Strength",
    primaryUnit: "",
    primaryUnitPosition: "suffix",
    secondaryMetric: "Patterns Detected",
    tertiaryMetric: "Accuracy %",
    timeUnit: "periods",
    chartTitle: "Forecast Signal Strength",
    outcomeLabel: "Accuracy Distribution",
    secondaryChartTitle: "Pattern Detection & Noise",
    formatPrimary: (v: number) => `${v.toFixed(2)}`,
    formatSecondary: (v: number) => `${v.toFixed(0)}`,
  },
};

// Default labels for business-type categories
const BUSINESS_DEFAULT = DOMAIN_LABELS.startup;

export function getDomainLabels(category: string): DomainLabels {
  return DOMAIN_LABELS[category] || BUSINESS_DEFAULT;
}

export function formatMetricValue(value: number, category: string): string {
  const labels = getDomainLabels(category);
  return labels.formatPrimary(value);
}
