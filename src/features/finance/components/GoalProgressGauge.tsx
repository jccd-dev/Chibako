"use client";

import { cn } from "cn";

export function GoalProgressGauge({
  percent,
  label,
  className,
}: {
  percent: number;
  label: string;
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  const radius = 19;
  const circumference = 2 * Math.PI * radius;
  const segmentLength = circumference / 8;
  return (
    <div
      className={cn("relative size-12 shrink-0", className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
    >
      <svg aria-hidden="true" viewBox="0 0 48 48" className="size-full">
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${segmentLength * 0.72} ${segmentLength * 0.28}`}
          transform="rotate(-90 24 24)"
        />
        {clamped > 0 && (
          <circle
            cx="24"
            cy="24"
            r={radius}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${circumference * (clamped / 100)} ${circumference}`}
            transform="rotate(-90 24 24)"
          />
        )}
        <text
          x="24"
          y="24.5"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="14"
          fontWeight="600"
          className="fill-foreground tabular-nums"
        >
          {clamped}%
        </text>
      </svg>
    </div>
  );
}
