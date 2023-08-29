#!/bin/bash -e

BUILD_DIR="$(dirname "$0")"
ROOT_DIR="$(dirname "$BUILD_DIR")"
ARCHIVE_NAME="logtail-aws-lambda.zip"

echo "Installing dependencies..."
(cd "$ROOT_DIR" && npm install)

echo
echo "Creating archive..."
rm -f "$BUILD_DIR/$ARCHIVE_NAME"
zip -rq "$BUILD_DIR/$ARCHIVE_NAME" "$ROOT_DIR/index.js" "$ROOT_DIR/src" "$ROOT_DIR/package.json" "$ROOT_DIR/node_modules" "$ROOT_DIR/README.md" "$ROOT_DIR/LICENSE"

echo
echo "ℹ️  Upload the ZIP archive '$BUILD_DIR/$ARCHIVE_NAME' to your AWS Lambda"
echo
