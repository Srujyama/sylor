import { Upload, FileSpreadsheet, Table, ArrowRight } from "lucide-react";
import Link from "next/link";

const formats = [
  { ext: ".csv", label: "CSV files" },
  { ext: ".xlsx", label: "Excel workbooks" },
  { ext: ".xls", label: "Legacy Excel" },
];

const mockColumns = [
  { name: "date", type: "datetime", sample: "2024-01-15" },
  { name: "price", type: "float64", sample: "142.50" },
  { name: "volume", type: "int64", sample: "3,241,000" },
  { name: "sentiment", type: "float64", sample: "0.73" },
];

export function DataUpload() {
  return (
    <section className="py-24 border-t border-white/[0.05]">
      <div className="max-w-[1440px] mx-auto px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-white/[0.05]">
          {/* Left — copy */}
          <div className="bg-[#0a0a0a] p-8 lg:p-12 flex flex-col justify-center">
            <span className="tag mb-4 inline-flex w-fit">data-powered simulations</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4 leading-tight">
              upload your data,<br />
              simulate with precision
            </h2>
            <p className="text-sm text-white/35 leading-relaxed mb-8 max-w-md">
              Import CSV or Excel files to ground your simulations in real data.
              Sylor auto-detects columns, maps them to simulation variables, and
              calibrates agents based on your actual numbers.
            </p>

            {/* Supported formats */}
            <div className="flex flex-wrap gap-2 mb-8">
              {formats.map((f) => (
                <div key={f.ext} className="flex items-center gap-2 surface px-3 py-1.5">
                  <FileSpreadsheet className="w-3 h-3 text-white/30" />
                  <span className="text-xs text-white/50">{f.ext}</span>
                </div>
              ))}
              <div className="surface px-3 py-1.5">
                <span className="text-xs text-white/30">max 10MB</span>
              </div>
            </div>

            {/* Features */}
            <div className="space-y-2 mb-8">
              {[
                "auto-detect column types and statistics",
                "map columns to simulation variables",
                "calibrate agent behavior from real patterns",
                "preview data before running simulations",
              ].map((f) => (
                <div key={f} className="flex items-center gap-2 text-xs text-white/45">
                  <div className="w-1 h-1 bg-white/20 shrink-0" />
                  <span>{f}</span>
                </div>
              ))}
            </div>

            <Link
              href="/signup"
              className="btn-primary inline-flex items-center gap-2 w-fit"
            >
              try data upload
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Right — mockup */}
          <div className="bg-[#0a0a0a] p-6 lg:p-8">
            {/* Drop zone mockup */}
            <div className="border border-dashed border-white/[0.15] p-8 mb-6 flex flex-col items-center justify-center text-center hover:border-white/[0.25] transition-colors">
              <Upload className="w-6 h-6 text-white/20 mb-3" />
              <p className="text-xs text-white/40 mb-1">drop your file here or click to browse</p>
              <p className="text-[10px] text-white/20">CSV, XLSX, XLS up to 10MB</p>
            </div>

            {/* File loaded state */}
            <div className="surface mb-4">
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.06]">
                <FileSpreadsheet className="w-3.5 h-3.5 text-white/30" />
                <span className="text-xs text-white/60">market_data_2024.csv</span>
                <span className="text-[10px] text-white/20 ml-auto">2.4 MB · 1,240 rows</span>
              </div>
              <div className="px-4 py-2 flex items-center gap-4">
                <span className="text-[10px] text-emerald-400/70">✓ parsed</span>
                <span className="text-[10px] text-white/20">4 columns detected</span>
              </div>
            </div>

            {/* Column preview */}
            <div className="surface">
              <div className="px-4 py-2 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <Table className="w-3 h-3 text-white/25" />
                  <span className="text-[10px] text-white/25 tracking-widest uppercase">column preview</span>
                </div>
              </div>

              {/* Header row */}
              <div className="grid grid-cols-4 gap-px bg-white/[0.04]">
                {["column", "type", "sample", "action"].map((h) => (
                  <div key={h} className="bg-[#0a0a0a] px-3 py-1.5">
                    <span className="text-[10px] text-white/20 tracking-widest uppercase">{h}</span>
                  </div>
                ))}
              </div>

              {/* Data rows */}
              {mockColumns.map((col, i) => (
                <div
                  key={col.name}
                  className={`grid grid-cols-4 gap-px bg-white/[0.04] ${i < mockColumns.length - 1 ? "" : ""}`}
                >
                  <div className="bg-[#0a0a0a] px-3 py-2">
                    <span className="text-xs text-white/60 font-mono">{col.name}</span>
                  </div>
                  <div className="bg-[#0a0a0a] px-3 py-2">
                    <span className="tag text-[10px]">{col.type}</span>
                  </div>
                  <div className="bg-[#0a0a0a] px-3 py-2">
                    <span className="text-xs text-white/35 font-mono">{col.sample}</span>
                  </div>
                  <div className="bg-[#0a0a0a] px-3 py-2">
                    <span className="text-[10px] text-white/30">→ map to var</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
