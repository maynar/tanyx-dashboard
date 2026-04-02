"use client";

type Props = {
  label: string;
  value: string;
};

export function KPICard({ label, value }: Props) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5">
      <div className="text-sm font-medium text-zinc-600">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

