import { registerWebModule, NativeModule } from 'expo';

// ValhallaEngineModule is not available on the web platform.
class ValhallaEngineModule extends NativeModule<{}> {}

export default registerWebModule(ValhallaEngineModule, 'ValhallaEngineModule');
