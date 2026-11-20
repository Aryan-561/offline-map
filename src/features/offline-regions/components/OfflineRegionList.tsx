import { View } from 'react-native';

import type { OfflineRegion } from '../types/offlineRegion.types';
import { RegionDownloadCard } from './RegionDownloadCard';

type OfflineRegionListProps = {
  regions: OfflineRegion[];
  isLocalEngineAvailable: boolean;
  onPause: (id: string) => Promise<unknown>;
  onResume: (id: string) => Promise<unknown>;
  onRetry: (id: string) => Promise<unknown>;
  onCancel: (id: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onVerify: (id: string) => Promise<unknown>;
  onNavigateOffline: (region: OfflineRegion) => Promise<void> | void;
};

export function OfflineRegionList({
  regions,
  isLocalEngineAvailable,
  onPause,
  onResume,
  onRetry,
  onCancel,
  onDelete,
  onVerify,
  onNavigateOffline,
}: OfflineRegionListProps) {
  return (
    <View style={{ gap: 8 }}>
      {regions.map((region) => (
        <RegionDownloadCard
          key={region.id}
          region={region}
          isLocalEngineAvailable={isLocalEngineAvailable}
          onPause={() => onPause(region.id)}
          onResume={() => onResume(region.id)}
          onRetry={() => onRetry(region.id)}
          onCancel={() => onCancel(region.id)}
          onDelete={() => onDelete(region.id)}
          onVerify={() => onVerify(region.id)}
          onNavigateOffline={() => onNavigateOffline(region)}
        />
      ))}
    </View>
  );
}
