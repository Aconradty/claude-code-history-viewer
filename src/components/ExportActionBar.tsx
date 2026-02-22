import { Download, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/useAppStore";
import { useExportSessions } from "@/hooks/useExportSessions";
import { Button } from "@/components/ui/button";

export function ExportActionBar() {
  const { t } = useTranslation();
  const selectedExportSessions = useAppStore((s) => s.selectedExportSessions);
  const clearExportSelection = useAppStore((s) => s.clearExportSelection);
  const { exportSessions } = useExportSessions();

  if (selectedExportSessions.size === 0) return null;

  const count = selectedExportSessions.size;
  const projectCount = new Set(
    Array.from(selectedExportSessions.values()).map((v) => v.projectPath),
  ).size;

  const label =
    count === 1
      ? t("session.export.actionBarSingular", { count })
      : t("session.export.actionBar", { count, projects: projectCount });

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t bg-background/95 backdrop-blur">
      <span className="flex-1 text-xs text-muted-foreground truncate">
        {label}
      </span>
      <Button
        size="sm"
        variant="default"
        className="h-7 text-xs gap-1"
        onClick={() => void exportSessions()}
        aria-label={t("session.export.exportButton")}
      >
        <Download className="w-3 h-3" />
        {t("session.export.exportButton")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs"
        onClick={clearExportSelection}
        aria-label={t("session.export.clearButton")}
      >
        <X className="w-3 h-3" />
        {t("session.export.clearButton")}
      </Button>
    </div>
  );
}
