import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { formatBounds } from '../services/regionService';
import type {
  OfflineRegion,
  OfflineRegionStatus,
  OfflineVerificationResult,
} from '../types/offlineMap';
import { DownloadProgress } from './DownloadProgress';
import { PRIMARY_COLOR } from './DownloadRegionButton';

const STATUS_LABELS: Record<OfflineRegionStatus, string> = {
  pending: 'Queued',
  downloading: 'Downloading',
  paused: 'Paused',
  completed: 'Downloaded',
  failed: 'Failed',
  missing: 'Data missing',
};

const STATUS_COLORS: Record<OfflineRegionStatus, string> = {
  pending: '#60646C',
  downloading: '#3c87f7',
  paused: '#B26A00',
  completed: '#2E7D32',
  failed: '#C62828',
  missing: '#C62828',
};

type OfflineRegionCardProps = {
  region: OfflineRegion;
  onPause: () => Promise<unknown>;
  onResume: () => Promise<unknown>;
  onRetry: () => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  onVerify: () => Promise<OfflineVerificationResult | null>;
  onView?: () => void;
};

export function OfflineRegionCard({
  region,
  onPause,
  onResume,
  onRetry,
  onDelete,
  onVerify,
  onView,
}: OfflineRegionCardProps) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [verification, setVerification] = useState<OfflineVerificationResult | null>(null);

  const statusColor = STATUS_COLORS[region.status];

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete offline region?',
      `"${region.name}" and its downloaded map data will be removed from this device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void run(onDelete);
          },
        },
      ],
    );
  };

  const handleVerify = () => {
    void run(async () => {
      const result = await onVerify();
      setVerification(result);
    });
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <ThemedText type="default" style={styles.name} numberOfLines={2}>
            {region.name}
          </ThemedText>
          <View style={[styles.statusPill, { backgroundColor: statusColor }]}>
            <ThemedText type="small" style={styles.statusText}>
              {STATUS_LABELS[region.status]}
            </ThemedText>
          </View>
        </View>
        {busy && <ActivityIndicator color={theme.text} />}
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        {formatBounds(region.bounds)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Zoom {region.minZoom}–{region.maxZoom}
      </ThemedText>

      <DownloadProgress region={region} />

      {region.error && (
        <ThemedText type="small" style={styles.errorText}>
          {region.error}
        </ThemedText>
      )}

      {verification && (
        <ThemedText
          type="small"
          style={{ color: verification.ok ? STATUS_COLORS.completed : STATUS_COLORS.failed }}>
          {verification.message}
        </ThemedText>
      )}

      <View style={styles.actions}>
        {region.status === 'downloading' && (
          <ActionButton label="Pause" disabled={busy} onPress={() => void run(onPause)} />
        )}
        {region.status === 'paused' && (
          <ActionButton
            label="Resume"
            tone="primary"
            disabled={busy}
            onPress={() => void run(onResume)}
          />
        )}
        {(region.status === 'failed' || region.status === 'missing') && (
          <ActionButton
            label={region.status === 'missing' ? 'Download again' : 'Retry'}
            tone="primary"
            disabled={busy}
            onPress={() => void run(onRetry)}
          />
        )}
        {region.status === 'completed' && (
          <>
            {onView && <ActionButton label="View" tone="primary" onPress={onView} />}
            <ActionButton label="Verify" disabled={busy} onPress={handleVerify} />
          </>
        )}
        <ActionButton label="Delete" tone="danger" disabled={busy} onPress={handleDelete} />
      </View>
    </View>
  );
}

type ActionButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'danger';
};

function ActionButton({ label, onPress, disabled = false, tone = 'default' }: ActionButtonProps) {
  const theme = useTheme();

  const color =
    tone === 'danger' ? STATUS_COLORS.failed : tone === 'primary' ? PRIMARY_COLOR : theme.text;
  const backgroundColor =
    tone === 'primary' ? PRIMARY_COLOR : tone === 'danger' ? theme.background : theme.backgroundSelected;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        { backgroundColor, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
      ]}>
      <ThemedText type="small" style={{ color: tone === 'primary' ? '#ffffff' : color }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  titleRow: {
    flex: 1,
    gap: Spacing.one,
    alignItems: 'flex-start',
  },
  name: {
    fontWeight: '700',
  },
  statusPill: {
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
  },
  statusText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  errorText: {
    color: STATUS_COLORS.failed,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  actionButton: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    minHeight: 34,
    justifyContent: 'center',
  },
});
