#!/bin/sh
set -e
echo "Applying database migrations..."
node /app/packages/db/dist/migrate.js
echo "Starting API..."
exec node /app/apps/api/dist/index.js
