"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
import { useFinanceAccounts } from "@/features/finance/use-finance-accounts";
import { useFinanceActivity } from "@/features/finance/use-finance-activity";
import {
  FinanceActivityList,
  FinanceTransactionEntry,
  FinanceTransactionDetails,
} from "./FinanceActivity";
import { FinanceReports, FinanceBudgets } from "./FinanceReports";
import { useFinanceBudget } from "@/features/finance/use-finance-budget";
import { FinancePlans } from "./FinancePlans";
import { FinanceGoals } from "./FinanceGoals";
import { useFinancePlanning } from "@/features/finance/use-finance-planning";
import { useFinanceReports } from "@/features/finance/use-finance-reports";
import { FinanceAccounts } from "./FinanceAccounts";
import { FinanceAccountPanel } from "./FinanceAccountPanel";
import { FinanceClassifications } from "./FinanceClassifications";
import { FinanceImportInspection } from "./FinanceImportInspection";
import { FinanceOverviewDashboard } from "./FinanceOverviewDashboard";
import type { FinanceAccount } from "@/features/finance/types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const tabs = [
  "overview",
  "activity",
  "planning",
  "accounts",
  "manage",
] as const;
type FinanceTab = (typeof tabs)[number];
const isTab = (value: string | undefined): value is FinanceTab =>
  tabs.some((tab) => tab === value);

export function FinanceView({ initialTab }: { initialTab?: string }) {
  const router = useRouter();
  const finance = useFinanceAccounts();
  const activity = useFinanceActivity(finance.refresh);
  const reports = useFinanceReports(activity.notice);
  const budget = useFinanceBudget(reports.refresh);
  const refreshAfterPlan = useCallback(async () => {
    await Promise.all([
      finance.refresh(),
      activity.refreshHistory(),
      activity.refreshTotals(),
      reports.refresh(),
    ]);
  }, [
    finance.refresh,
    activity.refreshHistory,
    activity.refreshTotals,
    reports.refresh,
  ]);
  const planning = useFinancePlanning(activity.notice, refreshAfterPlan);
  useEffect(() => {
    window.dispatchEvent(new Event("finance-changed"));
  }, [activity.notice, finance.notice, planning.notice]);
  const [transactionOpen, setTransactionOpen] = useState(false);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [inspectionOpen, setInspectionOpen] = useState(false);
  useEffect(() => {
    if (finance.notice) void activity.refreshOptions();
  }, [finance.notice, activity.refreshOptions]);
  const [tab, setTab] = useState<FinanceTab>(
    isTab(initialTab) ? initialTab : "overview",
  );
  const [panel, setPanel] = useState<"create" | FinanceAccount | null>(null);
  useEffect(() => {
    setTab(isTab(initialTab) ? initialTab : "overview");
  }, [initialTab]);

  function changeTab(value: FinanceTab) {
    setTab(value);
    router.replace(`/app/finance?tab=${value}`, { scroll: false });
  }

  function open(account?: FinanceAccount) {
    finance.resetSave();
    activity.resetSave();
    setPanel(account ?? "create");
  }

  function openAccountHistory(id: string) {
    activity.applyFilters({
      q: "",
      date_from: "",
      date_to: "",
      account_id: id,
      category_id: "",
      type: "",
      hidden: "all",
      reverted: "all",
    });
    setPanel(null);
    changeTab("activity");
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Finance
          </h1>
          <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">
            Your accounts and activity, in PHP. Cash and assets stay separate.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => setTransactionOpen(true)}>
            <IconPlus aria-hidden="true" data-icon="inline-start" />
            Add transaction
          </Button>
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (isTab(value)) changeTab(value);
        }}
      >
        <div className="mb-4 overflow-x-auto border-b border-border/60 pb-2">
          <TabsList
            variant="line"
            className="h-auto w-full min-w-max gap-1 sm:w-fit"
            aria-label="Finance views"
          >
            {tabs.map((value) => (
              <TabsTrigger key={value} value={value}>
                {value === "activity"
                  ? "History"
                  : value[0].toUpperCase() + value.slice(1)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {finance.notice && (
          <p role="status" className="mb-4 text-sm">
            {finance.notice}
          </p>
        )}
        {activity.notice && (
          <p role="status" className="mb-4 text-sm">
            {activity.notice}
          </p>
        )}
        {finance.loadError && (
          <div
            role="alert"
            className="mb-5 rounded-md border border-border bg-muted p-4"
          >
            <p className="text-sm">{finance.loadError}</p>
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => void finance.refresh()}
            >
              Retry loading
            </Button>
          </div>
        )}

        <TabsContent value="overview">
          {finance.loading && !finance.summary ? (
            <div
              role="status"
              aria-label="Loading balances"
              className="grid gap-6 sm:grid-cols-2"
            >
              {[0, 1].map((item) => (
                <div key={item} className="h-36 rounded-lg bg-muted" />
              ))}
            </div>
          ) : (
            finance.summary && (
              <>
                <FinanceOverviewDashboard
                  finance={finance}
                  activity={activity}
                  reports={reports}
                  planning={planning}
                  onNavigateTab={changeTab}
                  onOpenAccount={open}
                  onInspectTransaction={setTransactionId}
                  onCategoryFilter={(id) => {
                    activity.applyFilters({
                      q: "",
                      date_from: reports.dates.date_from,
                      date_to: reports.dates.date_to,
                      category_id: id,
                      account_id: "",
                      type: "",
                      hidden: "all",
                      reverted: "false",
                    });
                    changeTab("activity");
                  }}
                />

                <details className="mt-4 border-t border-border pt-3">
                  <summary className="min-h-11 cursor-pointer font-heading text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
                    Detailed spending reports
                  </summary>
                  <div className="pt-4">
                    <FinanceReports
                      reports={reports}
                      onCategory={(id) => {
                        activity.applyFilters({
                          q: "",
                          date_from: reports.dates.date_from,
                          date_to: reports.dates.date_to,
                          category_id: id,
                          account_id: "",
                          type: "",
                          hidden: "all",
                          reverted: "false",
                        });
                        changeTab("activity");
                      }}
                    />
                  </div>
                </details>
              </>
            )
          )}
        </TabsContent>

        <TabsContent value="activity">
          <FinanceActivityList activity={activity} onInspect={setTransactionId} />
        </TabsContent>
        <TabsContent value="planning">
          <FinanceBudgets budget={budget} activity={activity} />
          <FinancePlans planning={planning} activity={activity} />
          <FinanceGoals />
        </TabsContent>
        <TabsContent value="accounts">
          <FinanceAccounts finance={finance} onOpen={open} />
        </TabsContent>
        <TabsContent value="manage">
          <FinanceClassifications activity={activity} />
          <section className="mt-8 border-t border-border pt-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">
                  Tarsi migration preview
                </h3>
                <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                  Choose a Tarsi backup and review its structure without writing
                  anything. Review reconciled balances, mappings, and
                  exclusions. Commit requires a recoverable backup and separate
                  confirmation.
                </p>
              </div>
              <Button variant="outline" onClick={() => setInspectionOpen(true)}>
                Inspect backup
              </Button>
            </div>
          </section>
          <FinanceImportInspection
            open={inspectionOpen}
            onClose={(committed) => {
              setInspectionOpen(false);
              if (committed) {
                void Promise.all([
                  refreshAfterPlan(),
                  activity.refreshOptions(),
                  planning.refresh(),
                ]);
                window.dispatchEvent(new Event("finance-changed"));
              }
            }}
          />
        </TabsContent>
      </Tabs>

      <FinanceTransactionDetails
        key={transactionId ?? "closed"}
        activity={activity}
        inspectionId={transactionId}
        onClose={() => setTransactionId(null)}
      />
      <FinanceTransactionEntry
        activity={activity}
        open={transactionOpen}
        onClose={() => setTransactionOpen(false)}
      />
      {panel !== null && (
        <FinanceAccountPanel
          key={panel === "create" ? "create" : panel.id}
          selected={panel}
          finance={finance}
          activity={activity}
          onClose={() => setPanel(null)}
          onHistory={openAccountHistory}
          onInspectTransaction={setTransactionId}
        />
      )}
    </div>
  );
}
