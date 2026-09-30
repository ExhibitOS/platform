#!/bin/sh
set -eu
npm ci
npm run check
npm run test:e2e
