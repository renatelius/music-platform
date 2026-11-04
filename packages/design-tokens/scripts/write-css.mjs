// Generates dist/tokens.css from the compiled tokens (run after tsc).
import { writeFileSync } from 'node:fs';

import { tokensCss } from '../dist/index.js';

writeFileSync(new URL('../dist/tokens.css', import.meta.url), tokensCss());
