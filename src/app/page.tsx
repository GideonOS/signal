"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Download } from "lucide-react";

import { ICPTabs } from "@/components/dashboard/icp-tabs";
import { TargetStats } from "@/components/dashboard/target-stats";
import {
  TargetCard,
  type TargetCompany,
} from "@/components/dashboard/target-card";
import { SignalActivityFeed } from "@/components/dashboard/signal-activity-feed";
import { Button } from "@/components/ui/button";
import {
  StatsRowSkeleton,
  ListRowsSkeleton,
} from "@/components/ui/skeleton-presets";

interface DashboardData {
  stats: {
    totalCompanies: number;
    qualified: number;
    readyToContact: number;
    avgScore: number;
  };
  targets: TargetCompany[];
  recentChanges: Array<{
    companyName: string;
    signalName: string;
    changeDescription: string;
    detectedAt: string;
  }>;
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-4 p-4 md:p-6">
            <StatsRowSkeleton count={4} />
            <ListRowsSkeleton count={3} />
          </div>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = searchParams.get("icp") || "qa";

  const [state, setState] = useState<{
    data: DashboardData | null;
    loading: boolean;
    error: string | null;
    key: number;
  }>({
    data: null,
    loading: true,
    error: null,
    key: 0,
  });
  const { data, loading, error } = state;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dashboard?preset=${activeTab}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled)
          setState((s) => ({ ...s, data: json, loading: false, error: null }));
      })
      .catch((err) => {
        if (!cancelled)
          setState((s) => ({
            ...s,
            loading: false,
            error: err instanceof Error ? err.message : "Unknown error",
          }));
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, state.key]);

  const handleTabChange = (slug: string) => {
    router.push(`/?icp=${slug}`);
  };

  const handleExport = () => {
    window.open(`/api/export-csv?preset=${activeTab}`, "_blank");
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-4 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Today&apos;s Targets
            </h1>
            <p className="text-muted-foreground text-sm">
              Companies with evidence of the problem we solve — ranked by signal
              strength.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-1.5 h-4 w-4" />
            Export to Smartlead
          </Button>
        </div>

        {/* ICP Tabs */}
        <ICPTabs activeTab={activeTab} onTabChange={handleTabChange} />

        {/* Stats */}
        {loading && !data ? (
          <StatsRowSkeleton count={4} />
        ) : data ? (
          <TargetStats stats={data.stats} />
        ) : null}

        {/* Error */}
        {error && !loading && (
          <div className="border-border rounded-lg border p-6 text-center">
            <p className="text-muted-foreground text-sm">
              Failed to load: {error}
            </p>
            <button
              type="button"
              onClick={() =>
                setState((s) => ({
                  ...s,
                  loading: true,
                  error: null,
                  key: s.key + 1,
                }))
              }
              className="bg-foreground/10 hover:bg-foreground/15 mt-2 rounded-md px-3 py-1.5 text-xs font-medium"
            >
              Retry
            </button>
          </div>
        )}

        {/* Target Cards */}
        {loading && !data ? (
          <ListRowsSkeleton count={3} />
        ) : data && data.targets.length > 0 ? (
          <div className="space-y-3">
            {data.targets.map((target) => (
              <TargetCard key={target.companyId} company={target} />
            ))}
          </div>
        ) : data ? (
          <div className="border-border rounded-lg border p-8 text-center">
            <p className="text-muted-foreground text-sm">
              No companies found for this ICP. Create a campaign with the{" "}
              <span className="font-medium">
                {activeTab === "qa"
                  ? "QA"
                  : activeTab === "complaints"
                    ? "Complaints"
                    : "Sales Compliance"}
              </span>{" "}
              preset and start discovering companies.
            </p>
          </div>
        ) : null}

        {/* Signal Activity Feed */}
        {data && <SignalActivityFeed changes={data.recentChanges} />}
      </div>
    </div>
  );
}
