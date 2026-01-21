import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ExternalLink, Download, AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UseGitHubUpdaterReturn } from '@/hooks/useGitHubUpdater';
import { skipVersion, postponeUpdate } from '@/utils/updateSettings';
import { layout } from "@/components/renderers";

interface SimpleUpdateModalProps {
  updater: UseGitHubUpdaterReturn;
  isVisible: boolean;
  onClose: () => void;
}

export function SimpleUpdateModal({ updater, isVisible, onClose }: SimpleUpdateModalProps) {
  const { t } = useTranslation('components');
  const [showDetails, setShowDetails] = useState(false);

  if (!updater.state.releaseInfo || !updater.state.hasUpdate) return null;

  const release = updater.state.releaseInfo;
  const currentVersion = updater.state.currentVersion;
  const newVersion = release.tag_name.replace('v', '');
  
  const isImportant = release.body.toLowerCase().includes('security') || 
                     release.body.toLowerCase().includes('critical');

  const handleDownload = () => {
    updater.downloadAndInstall();
  };

  const handleSkip = () => {
    skipVersion(newVersion);
    updater.dismissUpdate();
    onClose();
  };

  const handlePostpone = () => {
    postponeUpdate();
    updater.dismissUpdate();
    onClose();
  };

  return (
    <Dialog open={isVisible} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t('simpleUpdateModal.newUpdateAvailable')}
            {isImportant && (
              <span className={`px-2 py-1 ${layout.smallText} bg-red-100 text-red-700 rounded`}>
                <AlertTriangle className="w-3 h-3 inline mr-1" />
                {t('simpleUpdateModal.important')}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Version info */}
          <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <div>
              <div className={`${layout.bodyText} text-gray-600 dark:text-gray-400`}>{t('simpleUpdateModal.currentVersion')}</div>
              <div className="font-medium dark:text-white">{currentVersion}</div>
            </div>
            <div className="text-2xl text-gray-400 dark:text-gray-500">→</div>
            <div>
              <div className={`${layout.bodyText} text-gray-600 dark:text-gray-400`}>{t('simpleUpdateModal.newVersion')}</div>
              <div className="font-medium text-blue-600 dark:text-blue-400">{newVersion}</div>
            </div>
          </div>

          {/* Download progress */}
          {updater.state.isDownloading && (
            <div className="space-y-2">
              <div className={`flex items-center gap-2 ${layout.bodyText}`}>
                <Download className="w-4 h-4 animate-bounce" />
                <span className="dark:text-gray-300">{t('simpleUpdateModal.downloading', { progress: updater.state.downloadProgress })}</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${updater.state.downloadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Installing */}
          {updater.state.isInstalling && (
            <div className={`flex items-center gap-2 ${layout.bodyText} p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg`}>
              <div className="animate-spin w-4 h-4 border-2 border-yellow-500 border-t-transparent rounded-full" />
              <span className="dark:text-gray-300">{t('simpleUpdateModal.installing')}</span>
            </div>
          )}

          {/* Error display */}
          {updater.state.error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className={`flex items-center gap-2 ${layout.bodyText} text-red-700 dark:text-red-400`}>
                <AlertTriangle className="w-4 h-4" />
                <span>{t('simpleUpdateModal.errorOccurred', { error: updater.state.error })}</span>
              </div>
            </div>
          )}

          {/* Details */}
          <div>
            <button
              onClick={() => setShowDetails(!showDetails)}
              className={`${layout.bodyText} text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline`}
            >
              {showDetails ? t('simpleUpdateModal.hideDetails') : t('simpleUpdateModal.showDetails')}
            </button>

            {showDetails && (
              <div className={`mt-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg ${layout.bodyText}`}>
                <div className="mb-2">
                  <strong className="dark:text-gray-200">{t('simpleUpdateModal.releaseName')}</strong> <span className="dark:text-gray-300">{release.name}</span>
                </div>
                <div className="mb-2">
                  <strong className="dark:text-gray-200">{t('simpleUpdateModal.changes')}</strong>
                  <pre className={`mt-1 ${layout.smallText} bg-white dark:bg-gray-900 dark:text-gray-300 p-2 rounded border dark:border-gray-600 max-h-32 overflow-auto`}>
                    {release.body}
                  </pre>
                </div>
                <a
                  href={release.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t('simpleUpdateModal.viewOnGitHub')}
                </a>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <div className="flex flex-wrap gap-2 w-full">
            <button
              onClick={handleDownload}
              disabled={updater.state.isDownloading || updater.state.isInstalling}
              className="flex-1 px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updater.state.isDownloading ? (
                <>
                  <Download className="w-4 h-4 inline mr-2 animate-bounce" />
                  {t('simpleUpdateModal.downloadingShort')}
                </>
              ) : updater.state.isInstalling ? (
                t('simpleUpdateModal.installingShort')
              ) : (
                <>
                  <Download className="w-4 h-4 inline mr-2" />
                  {t('simpleUpdateModal.downloadAndInstall')}
                </>
              )}
            </button>

            <div className="flex gap-2 w-full">
              <button
                onClick={handlePostpone}
                disabled={updater.state.isDownloading || updater.state.isInstalling}
                className={`flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 ${layout.bodyText}`}
              >
                {t('simpleUpdateModal.remindLater')}
              </button>
              <button
                onClick={handleSkip}
                disabled={updater.state.isDownloading || updater.state.isInstalling}
                className={`flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 ${layout.bodyText}`}
              >
                {t('simpleUpdateModal.skipVersion')}
              </button>
              <button
                onClick={onClose}
                disabled={updater.state.isDownloading || updater.state.isInstalling}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}