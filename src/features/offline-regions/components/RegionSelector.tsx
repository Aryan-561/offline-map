import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import MapView from '@/components/map-view';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ChoiceChips } from '@/features/offline-maps/components/ChoiceChips';
import { DownloadRegionButton } from '@/features/offline-maps/components/DownloadRegionButton';
import { formatBytes } from '@/features/offline-maps/services/regionService';
import { formatBounds, zoomForRadius } from '../utils/calculateBounds';
import { useTheme } from '@/hooks/use-theme';

import type { OfflineRegionBounds, OfflineRegionCoordinate } from '../types/offlineRegion.types';

const PRESET_RADII = [5, 10, 15];
const CUSTOM_RADIUS = 0;

type RegionSelectorProps = {
  center: OfflineRegionCoordinate | null;
  name: string;
  onNameChange: (value: string) => void;
  radiusKm: number;
  onRadiusChange: (value: number) => void;
  bounds: OfflineRegionBounds | null;
  preview: { center: OfflineRegionCoordinate; radiusKm: number } | null;
  estimatedTiles: number | null;
  mapEstimateBytes: number | null;
  routingEstimateBytes: number | null;
  routingWillBuild: boolean;
  totalEstimateBytes: number | null;
  estimatingRouting: boolean;
  routingEstimateError: string | null;
  onRetryRoutingEstimate: () => void;
  styleError: string | null;
  loadingLocation: boolean;
  starting: boolean;
  error: string | null;
  onLocate: () => void;
  onStart: () => void;
  onClearError: () => void;
};

export function RegionSelector({
  center,
  name,
  onNameChange,
  radiusKm,
  onRadiusChange,
  bounds,
  preview,
  estimatedTiles,
  mapEstimateBytes,
  routingEstimateBytes,
  routingWillBuild,
  totalEstimateBytes,
  estimatingRouting,
  routingEstimateError,
  onRetryRoutingEstimate,
  styleError,
  loadingLocation,
  starting,
  error,
  onLocate,
  onStart,
  onClearError,
}: RegionSelectorProps) {
  const theme = useTheme();
  const [customMode, setCustomMode] = useState(
    () => !PRESET_RADII.includes(radiusKm),
  );
  const [customText, setCustomText] = useState(String(radiusKm));

  const selectedRadius = customMode ? CUSTOM_RADIUS : radiusKm;

  const handleRadiusPreset = (value: number) => {
    if (value === CUSTOM_RADIUS) {
      setCustomMode(true);
      setCustomText(String(radiusKm || 5));
      return;
    }

    setCustomMode(false);
    setCustomText(String(value));
    onRadiusChange(value);
  };

  const handleCustomRadius = (value: string) => {
    setCustomText(value);
    const parsed = Number(value.replace(',', '.'));

    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 500) {
      onRadiusChange(parsed);
    } else {
      onRadiusChange(0);
    }
  };

  const customInvalid =
    customMode &&
    (customText.trim().length === 0 ||
      !Number.isFinite(Number(customText.replace(',', '.'))) ||
      Number(customText.replace(',', '.')) <= 0 ||
      Number(customText.replace(',', '.')) > 500);

  return (
    <View style={styles.card}>
      <View style={styles.fieldGroup}>
        <ThemedText type="small" themeColor="textSecondary">
          Region name
        </ThemedText>
        <TextInput
          value={name}
          onChangeText={onNameChange}
          placeholder="e.g. Home area"
          placeholderTextColor={theme.textSecondary}
          maxLength={80}
          style={[
            styles.textInput,
            {
              backgroundColor: theme.background,
              borderColor: theme.backgroundSelected,
              color: theme.text,
            },
          ]}
        />
      </View>

      <View style={styles.fieldGroup}>
        <ThemedText type="small" themeColor="textSecondary">
          Center
        </ThemedText>
        <ThemedText type="default">
          {center
            ? `${center.latitude.toFixed(5)}, ${center.longitude.toFixed(5)}`
            : 'No location selected'}
        </ThemedText>
        <ThemedText
          type="smallBold"
          onPress={loadingLocation ? undefined : onLocate}
          style={{ color: theme.text }}>
          {loadingLocation
            ? 'Getting current location…'
            : center
              ? 'Refresh current location'
              : 'Use current location'}
        </ThemedText>
      </View>

      <View style={styles.fieldGroup}>
        <ThemedText type="small" themeColor="textSecondary">
          Download radius
        </ThemedText>
        <ChoiceChips
          options={[
            ...PRESET_RADII.map((value) => ({ label: `${value} km`, value })),
            { label: 'Custom', value: CUSTOM_RADIUS },
          ]}
          value={selectedRadius}
          onChange={handleRadiusPreset}
        />

        {customMode && (
          <>
            <TextInput
              value={customText}
              onChangeText={handleCustomRadius}
              placeholder="Radius in km"
              placeholderTextColor={theme.textSecondary}
              keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
              style={[
                styles.textInput,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.backgroundSelected,
                  color: theme.text,
                },
              ]}
            />
            {customInvalid && (
              <ThemedText type="small" style={styles.errorText}>
                Enter a radius between 1 and 500 km.
              </ThemedText>
            )}
          </>
        )}
      </View>

      {preview && (
        <View style={[styles.preview, { borderColor: theme.backgroundSelected }]}>
          <MapView
            focus={{
              center: [preview.center.longitude, preview.center.latitude],
              zoom: zoomForRadius(preview.radiusKm),
            }}
            showControls={false}
            contentBottomInset={0}
            locationSource="external"
            regionPreview={preview}
          />
        </View>
      )}

      <View style={styles.fieldGroup}>
        <ThemedText type="small" themeColor="textSecondary">
          Download boundary
        </ThemedText>
        <ThemedText type="small">
          {bounds ? formatBounds(bounds) : 'Choose a location and a valid radius.'}
        </ThemedText>
        {bounds && (
          <ThemedText type="small" themeColor="textSecondary">
            Map zoom range is validated before download
            {estimatedTiles !== null
              ? ` · ~${estimatedTiles.toLocaleString()} map tiles`
              : ''}
          </ThemedText>
        )}
      </View>

      <View style={[styles.estimateCard, { backgroundColor: theme.background }]}>
        <EstimateRow
          label="Map data (estimate)"
          value={mapEstimateBytes === null ? 'Unavailable' : `~${formatBytes(mapEstimateBytes)}`}
        />
        <EstimateRow
          label="Routing data"
          value={
            estimatingRouting
              ? 'Checking service…'
              : routingEstimateBytes !== null
                ? formatBytes(routingEstimateBytes)
                : routingWillBuild
                  ? 'Builds on download'
                  : 'Unavailable'
          }
        />
        <EstimateRow
          label="Total storage required"
          value={
            totalEstimateBytes === null
              ? 'Unavailable'
              : routingWillBuild && mapEstimateBytes !== null
                ? `~${formatBytes(mapEstimateBytes)} + routing`
                : `~${formatBytes(totalEstimateBytes)}`
          }
          emphasis
        />
        <ThemedText type="small" themeColor="textSecondary">
          Map size is estimated from tile count. Routing size comes from the configured
          data service and is re-checked against the package manifest before download.
        </ThemedText>
        {routingEstimateError && (
          <View style={styles.errorRow}>
            <ThemedText type="small" style={styles.warningText}>
              {routingEstimateError}
            </ThemedText>
            {!estimatingRouting && (
              <ThemedText type="smallBold" onPress={onRetryRoutingEstimate}>
                Retry
              </ThemedText>
            )}
          </View>
        )}
      </View>

      {styleError && (
        <ThemedText type="small" style={styles.errorText}>
          {styleError}
        </ThemedText>
      )}

      {error && (
        <View style={styles.errorRow}>
          <ThemedText type="small" style={styles.errorText}>
            {error}
          </ThemedText>
          <ThemedText type="smallBold" onPress={onClearError}>
            Dismiss
          </ThemedText>
        </View>
      )}

      <DownloadRegionButton
        label={starting ? 'Starting both downloads…' : 'Download region'}
        onPress={onStart}
        loading={starting}
        disabled={!preview || customInvalid || Boolean(styleError)}
      />
    </View>
  );
}

function EstimateRow({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <View style={styles.estimateRow}>
      <ThemedText type={emphasis ? 'smallBold' : 'small'} themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type={emphasis ? 'smallBold' : 'small'}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  fieldGroup: {
    gap: Spacing.two,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    minHeight: 44,
  },
  preview: {
    height: 220,
    borderRadius: Spacing.three,
    borderWidth: 1,
    overflow: 'hidden',
  },
  estimateCard: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  estimateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  errorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  errorText: {
    color: '#C62828',
  },
  warningText: {
    color: '#B26A00',
  },
});
