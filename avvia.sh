#!/bin/sh
cd "$(dirname "$0")"
[ -d node_modules ] || { echo "Installo le dipendenze..."; npm install; }
npm start
