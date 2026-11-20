import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatBytes } from '@/features/offline-maps/services/regionService';
import { useTheme } from '@/hooks/use-theme';

import type { DatasetStatus } from '../types/offlineRegion.types';

const STATUS_COLORS: Record<DatasetStatus, string> = {
  pending: '#60646C',
  downloading: '#3c87f7',
  paused: '#B26A00',
  completed: '#2E7D32',
  failed: '#C62828',
};

type DownloadProgressProps = {
  label: string;
  status: DatasetStatus;
  progress: number;
  downloadedBytes: number;
  totalBytes: number | null;
  preparing?: boolean;
};

export function DownloadProgress({
  label,
  status,
  progress,
  downloadedBytes,
  totalBytes,
  preparing = false,
}: DownloadProgressProps) {
  const theme = useTheme();
  const clamped = Math.min(100, Math.max(0, progress));
  const color = STATUS_COLORS[status];
  const byteLabel =
    totalBytes !== null && totalBytes > 0
      ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
      : formatBytes(downloadedBytes);
  const valueLabel =
    preparing && status === 'downloading'
      ? 'Preparing…'
      : `${Math.round(clamped)}% · ${byteLabel}`;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {valueLabel}
        </ThemedText>
      </View>

      <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
        <View style={[styles.fill, { backgroundColor: color, width: `${clamped}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  track: {
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 4,
  },
});
