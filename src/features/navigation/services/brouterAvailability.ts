import BrouterEngine from '@modules/brouter-engine';

import { Platform } from 'react-native';

type Listener = () => void;

const listeners = new Set<Listener>();

export function isBrouterRegistered(): boolean {
  return Platform.OS === 'android' && BrouterEngine !== null;
}

export function subscribeBrouterAvailability(
  listener: Listener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyBrouterAvailabilityChanged(): void {
  for (const listener of listeners) {
    listener();
  }
}
