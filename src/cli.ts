#!/usr/bin/env node

const oldTitle = process.title;
process.title = 'clean-tsc';

import { tscClean } from '.';

tscClean().finally(() => {
  process.title = oldTitle;
});
