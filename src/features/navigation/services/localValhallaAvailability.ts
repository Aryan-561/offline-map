type Listener = () => void;

let registered = false;

const listeners = new Set<Listener>();

export function setLocalValhallaRegistered(value: boolean): void {
  if (registered === value) {
    return;
  }

  registered = value;

  for (const listener of listeners) {
    listener();
  }
}

export function isLocalValhallaRegistered(): boolean {
  return registered;
}

export function subscribeLocalValhallaAvailability(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
