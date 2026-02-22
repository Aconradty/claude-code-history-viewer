import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/useAppStore";
import { sessionToMarkdown } from "@/utils/sessionToMarkdown";
import type { ClaudeMessage } from "@/types";

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_").slice(0, 80);
}

function buildFilename(
  projectPath: string,
  sessionName: string,
  date: string,
  index: number,
): string {
  const projectSlug = sanitizeFilename(
    projectPath.split(/[\\/]/).pop() ?? "project",
  );
  const dateSlug = date.slice(0, 10); // YYYY-MM-DD
  const nameSlug = sanitizeFilename(sessionName);
  const suffix = index > 0 ? `_${index + 1}` : "";
  return `${projectSlug}_${dateSlug}_${nameSlug}${suffix}.md`;
}

export function useExportSessions() {
  const { t } = useTranslation();
  const selectedExportSessions = useAppStore((s) => s.selectedExportSessions);
  const setIsExporting = useAppStore((s) => s.setIsExporting);
  const setExportProgress = useAppStore((s) => s.setExportProgress);

  const exportSessions = useCallback(async () => {
    const folder = await open({ directory: true });
    if (!folder || typeof folder !== "string") return;

    const entries = Array.from(selectedExportSessions.entries());
    const total = entries.length;

    setIsExporting(true);
    const toastId = toast.loading(
      t("session.export.progress", { current: 0, total }),
    );

    let exported = 0;
    let failed = 0;
    const usedFilenames = new Set<string>();

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      const [filePath, info] = entry;
      toast.loading(t("session.export.progress", { current: i + 1, total }), {
        id: toastId,
      });

      try {
        const messages: ClaudeMessage[] = await invoke("load_session_messages", {
          sessionPath: filePath,
        });

        if (messages.length === 0) {
          failed++;
          continue;
        }

        const firstDate = messages[0]?.timestamp ?? new Date().toISOString();
        let filename = buildFilename(info.projectPath, info.sessionName, firstDate, 0);
        let collision = 1;
        while (usedFilenames.has(filename)) {
          filename = buildFilename(
            info.projectPath,
            info.sessionName,
            firstDate,
            collision++,
          );
        }
        usedFilenames.add(filename);

        const markdown = sessionToMarkdown(messages, info);
        const outputPath = `${folder}/${filename}`;

        await invoke("write_text_file", { path: outputPath, content: markdown });
        exported++;
      } catch {
        failed++;
      }

      setExportProgress({ current: i + 1, total });
    }

    setIsExporting(false);
    setExportProgress(null);
    toast.dismiss(toastId);

    if (failed === 0) {
      toast.success(t("session.export.success", { count: exported }), {
        action: {
          label: t("session.export.successOpen"),
          onClick: () => void revealItemInDir(folder),
        },
      });
    } else {
      toast.error(
        t("session.export.failureSummary", { exported, failed }),
      );
    }
  }, [selectedExportSessions, setIsExporting, setExportProgress, t]);

  return { exportSessions };
}
