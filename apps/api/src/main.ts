import { createApp } from './bootstrap.js';
import { loadConfig } from './config/env.js';

const config = loadConfig(process.env);
const app = await createApp(config);
app.enableShutdownHooks();
await app.listen(config.api.port, config.api.host);
