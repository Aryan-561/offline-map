import { registerWebModule, NativeModule } from 'expo';

// BrouterEngineModule is not available on the web platform.
class BrouterEngineModule extends NativeModule<{}> {}

export default registerWebModule(BrouterEngineModule, 'BrouterEngine');
