export type ValhallaInitializeOptions = {
  regionId: string;
  tilePath: string;
  configPath: string | null;
  dataVersion: string;
  engineVersion: string;
};

export type ValhallaRouteRequest = Record<string, unknown>;
